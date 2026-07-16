// GET/POST /api/cron/reminders?secret=CRON_SECRET
//
// Scans every user's upcoming calendar events and delivers any reminder that has
// come due — by EMAIL and PUSH. This is the half the browser can't do: it works
// while ROMIO is closed.
//
// DIVISION OF LABOUR (deliberate — avoids double alerts):
//   • This cron  → email + push notification.
//   • The in-app engine (src/tools/reminders.js) → bell notification + sound,
//     while ROMIO is open. It has its own localStorage de-dupe.
// So a reminder never fires twice through the same channel.
//
// Idempotency: before sending we `create()` a doc at reminderLog/{key}. If it
// already exists the create throws and we skip — atomic, so even overlapping
// cron runs can't double-send.
//
// Schedule it every ~10 minutes for punctual delivery (see backend/README.md).
import { getDb, FieldValue } from '../_lib/firebase.js';
import { checkSecret, json } from '../_lib/http.js';
import { wallTimeToUtcMs, formatInZone } from '../_lib/time.js';
import { sendEmail, reminderEmail, emailConfigured } from '../_lib/email.js';
import { pushToUser } from '../_lib/push.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// Fire a reminder that came due within this window. Generous so that even a
// coarse once-daily schedule still delivers rather than silently dropping it.
const GRACE_MS = 24 * 60 * 60 * 1000;

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

// Reminder days on an event (array form, or the legacy single `remind` value).
function reminderDays(ev) {
  if (Array.isArray(ev.reminders)) return ev.reminders.map(Number).filter((n) => !Number.isNaN(n));
  if (ev.remind != null && ev.remind !== '') {
    const n = Number(ev.remind);
    return Number.isNaN(n) ? [] : [n];
  }
  return [];
}

const label = (d) => (d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`);

export default async function handler(req, res) {
  if (!checkSecret(req)) return json(res, 403, { error: 'forbidden' });

  const now = Date.now();
  const appUrl = process.env.APP_URL || 'https://romio.web.app';
  const stats = { scanned: 0, due: 0, emailed: 0, pushed: 0, skipped: 0, errors: 0 };

  try {
    // Only look at events near enough to matter: reminders reach at most 7 days
    // ahead, and we honour a 1-day grace behind. Date strings are ISO, so a
    // lexical range works. Needs the collection-group index on events.date.
    const from = ymd(now - 2 * DAY_MS);
    const to = ymd(now + 9 * DAY_MS);
    const snap = await getDb().collectionGroup('events')
      .where('date', '>=', from).where('date', '<=', to).get();

    const userCache = new Map();
    const getUser = async (uid) => {
      if (userCache.has(uid)) return userCache.get(uid);
      const doc = await getDb().collection('users').doc(uid).get();
      const data = doc.exists ? doc.data() : null;
      userCache.set(uid, data);
      return data;
    };

    for (const docSnap of snap.docs) {
      stats.scanned++;
      const ev = { id: docSnap.id, ...docSnap.data() };
      // collectionGroup('events') also matches workspace calendars
      // (workspaces/{id}/events). Only personal events — users/{uid}/events —
      // carry reminders, so ignore anything not parented by /users.
      const owner = docSnap.ref.parent.parent;
      if (!owner || owner.parent?.id !== 'users') continue;
      const uid = owner.id;
      if (!uid || !ev.date) continue;

      const days = reminderDays(ev);
      if (!days.length) continue;

      const profile = await getUser(uid);
      if (!profile) continue;
      // Never bother suspended/deleted accounts.
      if (profile.deleted || profile.suspended) continue;

      const tz = profile.tz || 'UTC';
      const eventMs = wallTimeToUtcMs(ev.date, ev.time || '09:00', tz);
      if (Number.isNaN(eventMs)) continue;

      for (const d of days) {
        const when = eventMs - d * DAY_MS;
        if (now < when || now - when > GRACE_MS) continue;   // not due, or too old
        stats.due++;

        // Atomic claim — first runner wins, everyone else skips.
        const key = `${uid}_${ev.id}_${d}_${ev.date}_${(ev.time || '').replace(':', '')}`;
        try {
          await getDb().collection('reminderLog').doc(key).create({
            uid, eventId: ev.id, days: d, at: FieldValue.serverTimestamp(),
          });
        } catch { stats.skipped++; continue; }

        const title = ev.title || 'Event';
        const whenText = `${title} is ${d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`} — ${formatInZone(eventMs, tz)}.`;

        // Email (best-effort; a failure must not block push).
        if (emailConfigured() && profile.email) {
          try {
            const mail = reminderEmail({ title, whenLabel: label(d), whenText, appUrl });
            await sendEmail({ to: profile.email, ...mail });
            stats.emailed++;
          } catch (e) { stats.errors++; console.error('reminder email failed', uid, e.message); }
        }

        // Push — reaches them with ROMIO closed.
        try {
          const r = await pushToUser(uid, {
            title: `Reminder: ${title}`, body: whenText, link: '/?view=calendar', tag: `rem-${ev.id}-${d}`,
          });
          stats.pushed += r.sent || 0;
        } catch (e) { stats.errors++; console.error('reminder push failed', uid, e.message); }
      }
    }

    return json(res, 200, { ok: true, ranAt: new Date(now).toISOString(), ...stats });
  } catch (e) {
    console.error('reminders cron failed', e);
    return json(res, 500, { error: e.message, ...stats });
  }
}
