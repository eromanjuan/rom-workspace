// Talking to the ROMIO backend (the Vercel API).
//
// The backend is optional: point VITE_API_BASE elsewhere (or set it empty) and
// every caller degrades gracefully — the app behaves exactly as it did before
// (in-app reminders only, manual Pro).
//
// The default below is the deployed ROMIO API. It's a public URL, not a secret —
// the same pattern firebase.js uses for its public web config — so a build works
// with no extra env setup.
import { auth } from './firebase.js';

export const API_BASE = String(
  import.meta.env.VITE_API_BASE ?? 'https://romio-backend.vercel.app',
).replace(/\/$/, '');
export const apiReady = () => !!API_BASE;

// Call the backend as the signed-in user (sends a Firebase ID token, which the
// server verifies — so a user can only ever act on their own data).
export async function apiFetch(path, { method = 'POST', body, timeoutMs = 15000 } = {}) {
  if (!API_BASE) throw new Error('Backend not configured');
  const token = await auth?.currentUser?.getIdToken().catch(() => null);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return await res.json().catch(() => ({}));
  } finally { clearTimeout(timer); }
}
