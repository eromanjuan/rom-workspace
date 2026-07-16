// Calendar reminder engine. While ROMIO is open, it watches the signed-in user's
// events and, when a reminder is due, alerts them three ways:
//   • a bell notification (persisted to Firestore),
//   • a desktop "PC alarm" via the browser Notification API, and
//   • a short alarm sound.
// It can't send email (that needs a server) and can't fire while ROMIO is fully
// closed (that needs push + a service worker). Reminders are de-duped per browser.
import { subscribeUserDocs, addSelfNotification } from '../workspaces/data.js';
import { primeAudio, playSound } from '../ui/sounds.js';

const FIRED_KEY = 'romio-reminders-fired';
const GRACE_MS = 24 * 60 * 60 * 1000;   // don't fire reminders more than a day late
const DAY_MS = 24 * 60 * 60 * 1000;

function loadFired() { try { return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) || '[]')); } catch { return new Set(); } }
function saveFired(set) { try { localStorage.setItem(FIRED_KEY, JSON.stringify([...set].slice(-800))); } catch { /* ignore */ } }

// Ask for desktop-notification permission (needs a user gesture — call from a click).
export function requestReminderPermission() {
  try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); } catch { /* ignore */ }
}

// Unlock audio for later (browsers block autoplay until a user gesture).
export function primeReminderAudio() { primeAudio(); }

function desktopAlarm(title, body) {
  // The reminder bell notification plays the configured "reminder" sound; also
  // play the "alarm" sound here for the louder PC-alarm feel.
  playSound('alarm');
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: '/romio-mark.png', tag: 'romio-reminder', requireInteraction: true });
      n.onclick = () => { try { window.focus(); n.close(); } catch { /* ignore */ } };
    }
  } catch { /* ignore */ }
}

// The reminder days set on an event (supports the array or legacy single value).
function eventReminderDays(ev) {
  if (Array.isArray(ev.reminders)) return ev.reminders.map(Number).filter((n) => !Number.isNaN(n));
  if (ev.remind != null && ev.remind !== '') return [Number(ev.remind)];
  return [];
}

// Start watching this user's events. Returns a stop() to tear everything down.
export function startReminders(user) {
  if (!user || !user.uid) return () => {};
  let events = [];
  const fired = loadFired();

  const fire = (ev, days) => {
    const label = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
    const title = `Reminder: ${ev.title || 'Event'}`;
    const body = `${ev.title || 'Your event'} is ${label}${ev.time ? ' at ' + ev.time : ''}.`;
    addSelfNotification(user.uid, { title, body, link: { view: 'calendar' } }).catch(() => {});
    desktopAlarm(title, body);
  };

  const check = () => {
    const now = Date.now();
    let changed = false;
    for (const ev of events) {
      if (!ev.date) continue;
      const days = eventReminderDays(ev);
      if (!days.length) continue;
      const base = new Date(`${ev.date}T${ev.time || '09:00'}`);
      const baseMs = base.getTime();
      if (Number.isNaN(baseMs)) continue;
      for (const d of days) {
        const when = baseMs - d * DAY_MS;
        const key = `${ev.id}|${d}|${ev.date}|${ev.time || ''}`;
        if (fired.has(key)) continue;
        if (now >= when && now - when <= GRACE_MS) {          // due now (within grace) → alert once
          fired.add(key); changed = true; fire(ev, d);
        } else if (when < now - GRACE_MS) {                   // long overdue → suppress silently
          fired.add(key); changed = true;
        }
      }
    }
    if (changed) saveFired(fired);
  };

  const unsub = subscribeUserDocs(user.uid, 'events', (list) => { events = list; check(); }, () => {});
  const timer = setInterval(check, 60 * 1000);
  check();
  return () => { try { unsub && unsub(); } catch { /* ignore */ } clearInterval(timer); };
}
