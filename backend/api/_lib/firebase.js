// Firebase Admin, initialised lazily and once per warm serverless instance.
//
// Auth comes from the FIREBASE_SERVICE_ACCOUNT env var: the full JSON of a
// service-account key (Firebase console → Project settings → Service accounts →
// "Generate new private key"). Paste the whole file contents as the value.
// Base64 is also accepted, which avoids newline mangling in some dashboards.
//
// Init is LAZY on purpose. If it ran at import time, a missing/broken key would
// crash every endpoint on load — including /api/health, the one thing you need
// working to diagnose a missing/broken key. Instead the throw happens inside the
// call, where each endpoint can catch and report it.
import admin from 'firebase-admin';

function loadServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  let text = raw.trim();
  if (!text.startsWith('{')) text = Buffer.from(text, 'base64').toString('utf8');
  let sa;
  try { sa = JSON.parse(text); }
  catch { throw new Error('FIREBASE_SERVICE_ACCOUNT is not valid JSON'); }
  // Dashboards often turn real newlines in the private key into literal "\n".
  if (sa.private_key && sa.private_key.includes('\\n')) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  if (!sa.project_id || !sa.private_key || !sa.client_email) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing project_id/private_key/client_email');
  }
  return sa;
}

let ready = false;
function init() {
  if (ready) return;
  if (!admin.apps.length) {
    const sa = loadServiceAccount();
    admin.initializeApp({ credential: admin.credential.cert(sa), projectId: sa.project_id });
  }
  ready = true;
}

export function getDb() { init(); return admin.firestore(); }
export function getAuth() { init(); return admin.auth(); }
export function getMessaging() { init(); return admin.messaging(); }

// Static namespaces — safe to touch without credentials.
export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;
export { admin };
