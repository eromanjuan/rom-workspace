// Push via Firebase Cloud Messaging (free — no Blaze plan needed).
//
// Devices register at users/{uid}/fcmTokens/{token} with a `platform` field. We
// fan a message out to all of a user's devices so the alert reaches whichever
// one they're on — even with ROMIO closed.
//
// WHY SPLIT BY PLATFORM: FCM needs a different message shape per platform, and
// one shape breaks the other.
//   • web     → data-only. Our service worker renders it, so we control the
//               click target. Adding a `notification` block here would make the
//               browser auto-display it AND fire our handler = duplicates.
//   • android → needs a real `notification` block, otherwise a data-only message
//               shows nothing while the app is backgrounded/closed.
// So each platform gets its own send.
//
// Tokens die (cleared data, reinstall, inactivity). FCM reports that, and we
// prune those so the list doesn't rot.
import { getDb, getMessaging } from './firebase.js';

const DEAD = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

// Send to one platform's tokens, pruning any FCM reports as permanently dead.
async function sendBatch(uid, tokens, message) {
  if (!tokens.length) return { sent: 0, failed: 0, pruned: 0 };
  const res = await getMessaging().sendEachForMulticast({ tokens, ...message });

  const stale = [];
  res.responses.forEach((r, i) => {
    if (!r.success && DEAD.has(r.error?.code)) stale.push(tokens[i]);
  });
  await Promise.all(stale.map((t) =>
    getDb().collection('users').doc(uid).collection('fcmTokens').doc(t).delete().catch(() => {})));

  return { sent: res.successCount, failed: res.failureCount, pruned: stale.length };
}

// Send one notification to every device a user has registered.
// Returns { sent, failed, pruned }.
export async function pushToUser(uid, { title, body, link, tag }) {
  const snap = await getDb().collection('users').doc(uid).collection('fcmTokens').get();
  if (snap.empty) return { sent: 0, failed: 0, pruned: 0, skipped: 'no tokens' };

  const web = [];
  const android = [];
  snap.docs.forEach((d) => {
    (d.data()?.platform === 'android' ? android : web).push(d.id);
  });

  const appUrl = process.env.APP_URL || 'https://romio.web.app';
  const url = `${appUrl}${link || ''}`;
  const t = String(title || 'ROMIO');
  const b = String(body || '');
  const tg = String(tag || 'romio');

  const results = await Promise.all([
    sendBatch(uid, web, {
      data: { title: t, body: b, url, tag: tg },
      webpush: { headers: { Urgency: 'high', TTL: '86400' }, fcmOptions: { link: url } },
    }),
    sendBatch(uid, android, {
      notification: { title: t, body: b },
      // The app reads `url` on tap (pushNotificationActionPerformed).
      data: { url, tag: tg },
      android: {
        priority: 'high',
        ttl: 86400 * 1000,
        notification: { tag: tg, defaultSound: true, priority: 'high' },
      },
    }),
  ]);

  return results.reduce((a, r) => ({
    sent: a.sent + r.sent, failed: a.failed + r.failed, pruned: a.pruned + r.pruned,
  }), { sent: 0, failed: 0, pruned: 0 });
}
