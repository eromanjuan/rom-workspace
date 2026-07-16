// GET /api/health — a quick "is the backend wired up correctly?" probe.
// Reports which integrations are configured and whether Firestore is reachable,
// without leaking any secret values.
import { getDb } from './_lib/firebase.js';
import { cors, json } from './_lib/http.js';
import { emailConfigured } from './_lib/email.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;

  const out = {
    ok: true,
    time: new Date().toISOString(),
    firestore: 'unknown',
    configured: {
      serviceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      email: emailConfigured(),
      emailProvider: process.env.RESEND_API_KEY ? 'resend' : (process.env.SMTP_HOST ? 'smtp' : null),
      cronSecret: !!process.env.CRON_SECRET,
      gumroadToken: !!process.env.GUMROAD_PING_TOKEN,
      appUrl: process.env.APP_URL || 'https://romio.web.app',
    },
  };

  try {
    await getDb().collection('users').limit(1).get();
    out.firestore = 'connected';
  } catch (e) {
    out.ok = false;
    out.firestore = `error: ${e.message}`;
  }

  return json(res, out.ok ? 200 : 500, out);
}
