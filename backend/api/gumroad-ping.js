// POST /api/gumroad-ping?token=GUMROAD_PING_TOKEN
//
// Gumroad calls this on every sale / recurring charge. We match the buyer to a
// ROMIO account and grant Pro by writing a future `proUntil` — which isPro() in
// src/monetize.js already honours, so nothing else changes.
//
// Subscriptions: each monthly charge pings us and pushes proUntil forward. If a
// member cancels, the charges stop, proUntil lapses and Pro switches off on its
// own. Refunds / disputes / cancellations revoke immediately.
//
// Paste this URL into Gumroad → Settings → Advanced → "Ping".
import { getDb, FieldValue, Timestamp } from './_lib/firebase.js';
import { json } from './_lib/http.js';

const PRO_PRODUCTS = (process.env.PRO_PRODUCTS || 'parnex').split(',').map((s) => s.trim()).filter(Boolean);
const GRACE_DAYS = 33;   // a bit over a month so a late renewal never drops them
const DAY_MS = 24 * 60 * 60 * 1000;

const truthy = (v) => v === true || v === 'true' || v === '1' || v === 1;

// The ROMIO uid we attach to in-app checkout links (?uid=…). Gumroad echoes
// unknown URL params back as url_params[…] — handle both parsed shapes.
function extractUid(body) {
  if (!body) return null;
  if (body.url_params && typeof body.url_params === 'object' && body.url_params.uid) return String(body.url_params.uid);
  if (body['url_params[uid]']) return String(body['url_params[uid]']);
  return null;
}

async function findUid(body) {
  const uid = extractUid(body);
  if (uid && (await getDb().collection('users').doc(uid).get()).exists) return uid;
  const email = String(body.email || '').trim();
  if (!email) return null;
  for (const e of [email, email.toLowerCase()]) {
    const snap = await getDb().collection('users').where('email', '==', e).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  if (!process.env.GUMROAD_PING_TOKEN || req.query.token !== process.env.GUMROAD_PING_TOKEN) {
    return json(res, 403, { error: 'forbidden' });
  }

  try {
    const body = typeof req.body === 'string' ? Object.fromEntries(new URLSearchParams(req.body)) : (req.body || {});
    const permalink = body.product_permalink || body.permalink || '';
    if (permalink && PRO_PRODUCTS.length && !PRO_PRODUCTS.includes(permalink)) {
      return json(res, 200, { ok: true, ignored: 'other product' });
    }

    const uid = await findUid(body);
    if (!uid) {
      // Buyer used an email that matches no ROMIO account — log it so you can
      // reconcile by hand instead of losing the sale silently.
      await getDb().collection('gumroadUnmatched').add({
        email: body.email || '', saleId: body.sale_id || '', permalink,
        at: FieldValue.serverTimestamp(), raw: JSON.stringify(body).slice(0, 4000),
      }).catch(() => {});
      return json(res, 200, { ok: true, unmatched: true });
    }

    const ref = getDb().collection('users').doc(uid);
    const revoke = truthy(body.refunded) || truthy(body.disputed) || truthy(body.chargebacked)
      || truthy(body.cancelled) || !!body.subscription_ended_at || !!body.subscription_cancelled_at;

    if (revoke) {
      await ref.set({
        proUntil: Timestamp.fromMillis(Date.now()),
        proSource: 'gumroad', proNote: 'revoked (refund/dispute/cancel)',
        proUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return json(res, 200, { ok: true, revoked: true, uid });
    }

    await ref.set({
      proUntil: Timestamp.fromMillis(Date.now() + GRACE_DAYS * DAY_MS),
      proSource: 'gumroad',
      proEmail: body.email || '',
      proSaleId: body.sale_id || '',
      proRecurrence: body.recurrence || '',
      proUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return json(res, 200, { ok: true, granted: true, uid });
  } catch (e) {
    console.error('gumroad-ping failed', e);
    // 200 so Gumroad doesn't retry-storm; the error is logged for us.
    return json(res, 200, { ok: false, error: e.message });
  }
}
