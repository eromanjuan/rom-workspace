// POST /api/push/register  { token, platform }   → save this device's FCM token
// POST /api/push/register  { token, remove: true } → forget it (on sign-out)
//
// `platform` is 'web' (browser) or 'android' (the Capacitor app). It decides the
// message shape the sender uses — see _lib/push.js.
//
// Requires the caller's Firebase ID token, so a user can only ever register a
// token against their own uid.
import { getDb, FieldValue } from '../_lib/firebase.js';
import { cors, requireUser, json } from '../_lib/http.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });

  const user = await requireUser(req);
  if (!user) return json(res, 401, { error: 'sign in required' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const token = String(body.token || '').trim();
  if (!token || token.length > 4096) return json(res, 400, { error: 'missing token' });

  const ref = getDb().collection('users').doc(user.uid).collection('fcmTokens').doc(token);
  if (body.remove) {
    await ref.delete().catch(() => {});
    return json(res, 200, { ok: true, removed: true });
  }

  const platform = body.platform === 'android' ? 'android' : 'web';
  await ref.set({
    platform,
    createdAt: FieldValue.serverTimestamp(),
    ua: String(req.headers['user-agent'] || '').slice(0, 300),
  }, { merge: true });

  return json(res, 200, { ok: true });
}
