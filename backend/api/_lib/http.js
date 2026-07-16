// Small helpers shared by every endpoint: CORS, auth, and secret checks.
import { getAuth } from './firebase.js';

// Only these origins may call the API from a browser. ALLOWED_ORIGINS (comma
// separated) can extend it — e.g. to add a custom domain later.
const DEFAULT_ORIGINS = [
  'https://romio.web.app',
  'https://rom-database-0909.web.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function allowedOrigins() {
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}

// Apply CORS. Returns true if this was a preflight and the response is finished.
export function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// Verify the caller's Firebase ID token (sent as "Authorization: Bearer <token>").
// Returns the decoded token, or null if missing/invalid.
export async function requireUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  try { return await getAuth().verifyIdToken(token); } catch { return null; }
}

// Guard for machine-to-machine endpoints (cron pingers). Accepts the secret via
// "Authorization: Bearer <CRON_SECRET>" (what Vercel Cron sends) or ?secret=.
export function checkSecret(req, envName = 'CRON_SECRET') {
  const expected = process.env[envName];
  if (!expected) return false;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const given = bearer || req.query?.secret || '';
  return given === expected;
}

export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).send(JSON.stringify(body));
}
