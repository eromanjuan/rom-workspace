// Web push registration (Firebase Cloud Messaging).
//
// This is the piece that lets reminders reach the user with ROMIO closed. The
// browser hands us a device token; we store it on the backend against the user,
// and the reminders cron sends to it.
//
// Needs two things to be configured, and no-ops harmlessly without them:
//   • VITE_FIREBASE_VAPID_KEY — Firebase console → Project settings → Cloud
//     Messaging → "Web Push certificates" → Generate key pair.
//   • VITE_API_BASE — the deployed backend URL.
import { getMessaging, getToken, deleteToken, isSupported } from 'firebase/messaging';
import { apiReady, apiFetch } from './api.js';

const VAPID_KEY = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '');
let cachedToken = '';

export const pushConfigured = () => !!(VAPID_KEY && apiReady());

// Can this browser do web push at all? (Safari <16.4, some in-app browsers, and
// non-secure origins can't.)
export async function pushSupported() {
  try { return pushConfigured() && 'serviceWorker' in navigator && await isSupported(); }
  catch { return false; }
}

export function pushPermission() {
  try { return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'; }
  catch { return 'unsupported'; }
}

async function swRegistration() {
  return navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
}

// Register this browser for push and store the token server-side.
// Pass { prompt: true } from a click to ask for permission; otherwise it only
// proceeds when permission was already granted (never prompts on page load).
export async function registerPush({ prompt = false } = {}) {
  if (!await pushSupported()) return { ok: false, reason: 'unsupported' };

  let perm = pushPermission();
  if (perm === 'default' && prompt) perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'not-granted' };

  try {
    const registration = await swRegistration();
    const token = await getToken(getMessaging(), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return { ok: false, reason: 'no-token' };
    if (token === cachedToken) return { ok: true, cached: true };
    await apiFetch('/api/push/register', { body: { token } });
    cachedToken = token;
    return { ok: true, token };
  } catch (e) {
    console.warn('push registration failed', e);
    return { ok: false, reason: e.message };
  }
}

// Forget this browser on sign-out, so the next person on this machine doesn't
// receive the previous user's reminders.
export async function unregisterPush() {
  try {
    if (!cachedToken) return;
    await apiFetch('/api/push/register', { body: { token: cachedToken, remove: true } }).catch(() => {});
    await deleteToken(getMessaging()).catch(() => {});
    cachedToken = '';
  } catch { /* ignore */ }
}
