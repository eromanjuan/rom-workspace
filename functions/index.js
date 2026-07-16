// ROMIO Cloud Functions — automatic Pro activation from Gumroad payments.
//
// HOW IT WORKS
//   Gumroad calls this endpoint (a "Ping") on every sale / recurring charge for
//   your products. We match the buyer to a ROMIO user and grant Pro by writing
//   a future `proUntil` on their user doc. src/monetize.js `isPro()` already
//   treats `proUntil > now` as Pro, so nothing else needs to change.
//
//   Because it's a subscription, Gumroad charges monthly and pings us each time,
//   which pushes `proUntil` forward by GRACE_DAYS. If the member cancels, the
//   charges (and pings) stop, so `proUntil` simply lapses — Pro turns off on its
//   own, no manual step. Refunds / disputes / cancellations revoke immediately.
//
// SETUP (one time — see the chat message for the full walkthrough):
//   1. Project must be on the Blaze plan (Cloud Functions require billing).
//   2. Deploy:  firebase deploy --only functions
//   3. Copy the printed URL and paste it (with ?token=...) into Gumroad:
//        Settings → Advanced → "Ping" endpoint.
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Shared secret required on the Ping URL (?token=...). Stops random POSTs from
// granting Pro. You can change it here — just update the Gumroad Ping URL too.
const PING_TOKEN = '387ce5659e679ee5639a07dd797f8d58509baee0ee246146';

// Only grant Pro for these product permalinks (the part after /l/ in the URL).
// Add more permalinks here if you sell other Pro tiers.
const PRO_PRODUCTS = ['parnex'];

// How long each successful charge keeps the buyer Pro. Slightly longer than a
// month so a late/retried renewal never briefly drops them.
const GRACE_DAYS = 33;
const DAY_MS = 24 * 60 * 60 * 1000;

// Truthy check for Gumroad's stringy booleans ("true", "1", true).
const truthy = (v) => v === true || v === 'true' || v === '1' || v === 1;

// Pull the ROMIO uid we attach to in-app checkout links (…?uid=…). Gumroad
// forwards unknown URL params back as url_params[...]. Handles both the nested
// object form and the flattened bracket-key form depending on body parsing.
function extractUid(body) {
  if (!body) return null;
  if (body.url_params && typeof body.url_params === 'object' && body.url_params.uid) return String(body.url_params.uid);
  if (body['url_params[uid]']) return String(body['url_params[uid]']);
  return null;
}

// Find the ROMIO user doc id for this sale: prefer the attached uid, else match
// by email (case-insensitively). Returns a uid string or null.
async function findUid(body) {
  const uid = extractUid(body);
  if (uid) {
    const doc = await db.collection('users').doc(uid).get();
    if (doc.exists) return uid;
  }
  const email = (body.email || '').trim();
  if (!email) return null;
  // Try exact, then lowercased (buyers usually type lowercase at checkout).
  for (const e of [email, email.toLowerCase()]) {
    const snap = await db.collection('users').where('email', '==', e).limit(1).get();
    if (!snap.empty) return snap.docs[0].id;
  }
  return null;
}

exports.gumroadPing = onRequest({ region: 'us-central1', cors: false }, async (req, res) => {
  try {
    if (req.method !== 'POST') { res.status(405).send('Use POST'); return; }
    if ((req.query.token || '') !== PING_TOKEN) { logger.warn('gumroadPing: bad token'); res.status(403).send('forbidden'); return; }

    const body = req.body || {};
    const permalink = body.product_permalink || body.permalink || '';
    if (permalink && PRO_PRODUCTS.length && !PRO_PRODUCTS.includes(permalink)) {
      // A sale for some other (non-Pro) product — acknowledge and ignore.
      res.status(200).send('ignored: other product'); return;
    }

    const uid = await findUid(body);
    if (!uid) {
      // No matching ROMIO account (buyer used a different email and no uid).
      // Record it so you can reconcile manually if needed.
      logger.warn('gumroadPing: no ROMIO user for sale', { email: body.email, sale_id: body.sale_id });
      await db.collection('gumroadUnmatched').add({
        email: body.email || '', saleId: body.sale_id || '', permalink,
        at: admin.firestore.FieldValue.serverTimestamp(), raw: JSON.stringify(body).slice(0, 4000),
      }).catch(() => {});
      res.status(200).send('ok: unmatched'); return;
    }

    const userRef = db.collection('users').doc(uid);
    const revoke = truthy(body.refunded) || truthy(body.disputed) || truthy(body.chargebacked)
      || truthy(body.cancelled) || !!body.subscription_ended_at || !!body.subscription_cancelled_at;

    if (revoke) {
      await userRef.set({
        proUntil: admin.firestore.Timestamp.fromMillis(Date.now()),
        proSource: 'gumroad',
        proUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
        proNote: 'revoked (refund/dispute/cancel)',
      }, { merge: true });
      logger.info('gumroadPing: revoked Pro', { uid, sale_id: body.sale_id });
      res.status(200).send('ok: revoked'); return;
    }

    const until = Date.now() + GRACE_DAYS * DAY_MS;
    await userRef.set({
      proUntil: admin.firestore.Timestamp.fromMillis(until),
      proSource: 'gumroad',
      proEmail: body.email || '',
      proSaleId: body.sale_id || '',
      proRecurrence: body.recurrence || '',
      proUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    logger.info('gumroadPing: granted Pro', { uid, until, sale_id: body.sale_id, test: body.test });
    res.status(200).send('ok: granted');
  } catch (err) {
    logger.error('gumroadPing: error', err);
    // Return 200 so Gumroad doesn't hammer retries; we've logged it.
    res.status(200).send('error logged');
  }
});
