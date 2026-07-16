// Web push via Firebase Cloud Messaging (free — no Blaze plan needed).
//
// Each browser that grants notification permission registers an FCM token at
// users/{uid}/fcmTokens/{token}. We fan a message out to all of a user's tokens
// so the alert reaches whichever device they're on — even with ROMIO closed,
// as long as the browser is running.
//
// Tokens die (cleared site data, reinstall, long inactivity). FCM tells us with
// a registration-token-not-registered error, and we prune those so the list
// doesn't rot.
import { getDb, getMessaging } from './firebase.js';

const DEAD = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

export async function userTokens(uid) {
  const snap = await getDb().collection('users').doc(uid).collection('fcmTokens').get();
  return snap.docs.map((d) => d.id);
}

// Send one notification to every device a user has registered.
// Returns { sent, failed, pruned }.
export async function pushToUser(uid, { title, body, link, tag }) {
  const tokens = await userTokens(uid);
  if (!tokens.length) return { sent: 0, failed: 0, pruned: 0, skipped: 'no tokens' };

  const appUrl = process.env.APP_URL || 'https://romio.web.app';
  const res = await getMessaging().sendEachForMulticast({
    tokens,
    // `data`-only: our service worker renders the notification itself, so the
    // click target and behaviour stay consistent across browsers.
    data: {
      title: String(title || 'ROMIO'),
      body: String(body || ''),
      url: `${appUrl}${link || ''}`,
      tag: String(tag || 'romio'),
    },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      fcmOptions: { link: `${appUrl}${link || ''}` },
    },
  });

  // Prune tokens FCM reports as permanently dead.
  const stale = [];
  res.responses.forEach((r, i) => {
    if (!r.success && DEAD.has(r.error?.code)) stale.push(tokens[i]);
  });
  await Promise.all(stale.map((t) =>
    getDb().collection('users').doc(uid).collection('fcmTokens').doc(t).delete().catch(() => {})));

  return { sent: res.successCount, failed: res.failureCount, pruned: stale.length };
}
