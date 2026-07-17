// Push registration — one API, two very different engines underneath.
//
//   • Browser  → Firebase Cloud Messaging for Web (service worker + VAPID key).
//   • ROMIO Android app → the native Capacitor plugin. The webview CANNOT do web
//     push, so the native path is not optional — without it, an installed app
//     would silently never receive an alert.
//
// Both end up POSTing a device token to /api/push/register with the platform
// tagged, because FCM needs a different message shape per platform (see
// backend/api/_lib/push.js).
//
// Everything degrades quietly: no VAPID key, no backend, or an unsupported
// browser simply means no push, and the in-app reminder engine still works.
import { Capacitor } from '@capacitor/core';
import { apiReady, apiFetch } from './api.js';

const VAPID_KEY = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '');
let cached = { token: '', platform: '' };
let nativeWired = false;

export const isNative = () => { try { return Capacitor?.isNativePlatform?.() === true; } catch { return false; } };

// Web push needs a VAPID key; native push doesn't (it uses google-services.json).
export const pushConfigured = () => apiReady() && (isNative() || !!VAPID_KEY);

export async function pushSupported() {
  if (!apiReady()) return false;
  if (isNative()) return true;
  if (!VAPID_KEY || !('serviceWorker' in navigator)) return false;
  try {
    const { isSupported } = await import('firebase/messaging');
    return await isSupported();
  } catch { return false; }
}

export function pushPermission() {
  try { return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'; }
  catch { return 'unsupported'; }
}

async function saveToken(token, platform) {
  if (!token) return { ok: false, reason: 'no-token' };
  if (cached.token === token && cached.platform === platform) return { ok: true, cached: true };
  await apiFetch('/api/push/register', { body: { token, platform } });
  cached = { token, platform };
  return { ok: true, token };
}

// --- native (Capacitor / Android) ---
async function registerNative({ prompt }) {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') {
    if (!prompt) return { ok: false, reason: 'not-granted' };
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== 'granted') return { ok: false, reason: 'denied' };

  // Attach listeners once — register() may be called again on later sign-ins.
  const first = !nativeWired;
  const done = new Promise((resolve) => {
    if (!first) return resolve({ ok: true, cached: true });
    nativeWired = true;
    PushNotifications.addListener('registration', (t) => {
      saveToken(t.value, 'android').then(resolve).catch((e) => resolve({ ok: false, reason: e.message }));
    });
    PushNotifications.addListener('registrationError', (e) => resolve({ ok: false, reason: String(e?.error || 'registration failed') }));
    // Tapping a notification should land on the right screen.
    PushNotifications.addListener('pushNotificationActionPerformed', (ev) => {
      const url = ev?.notification?.data?.url;
      if (url) { try { window.location.assign(new URL(url).pathname + new URL(url).search); } catch { /* ignore */ } }
    });
  });

  await PushNotifications.register();
  return done;
}

// --- web (browser) ---
async function registerWeb({ prompt }) {
  let perm = pushPermission();
  if (perm === 'default' && prompt) perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'not-granted' };

  const { getMessaging, getToken } = await import('firebase/messaging');
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' });
  const token = await getToken(getMessaging(), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  return saveToken(token, 'web');
}

// Register this device for push and store the token server-side.
// Pass { prompt: true } from a click to ask permission; otherwise it only
// proceeds when permission was already granted (never prompts on page load).
export async function registerPush({ prompt = false } = {}) {
  if (!await pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    return isNative() ? await registerNative({ prompt }) : await registerWeb({ prompt });
  } catch (e) {
    console.warn('push registration failed', e);
    return { ok: false, reason: e.message };
  }
}

// Forget this device on sign-out, so the next person here doesn't get the
// previous user's reminders.
export async function unregisterPush() {
  try {
    if (!cached.token) return;
    await apiFetch('/api/push/register', { body: { token: cached.token, remove: true } }).catch(() => {});
    if (isNative()) {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      await PushNotifications.unregister().catch(() => {});
    } else {
      const { getMessaging, deleteToken } = await import('firebase/messaging');
      await deleteToken(getMessaging()).catch(() => {});
    }
    cached = { token: '', platform: '' };
  } catch { /* ignore */ }
}
