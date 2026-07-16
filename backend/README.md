# ROMIO backend

Server-side code for ROMIO, deployed as Vercel serverless functions. It does the
things a browser can't:

| Endpoint | What it does |
| --- | --- |
| `GET /api/health` | Reports what's configured + whether Firestore is reachable. Start here. |
| `GET /api/cron/reminders?secret=…` | Scans upcoming events and sends **email + push** for reminders that are due. |
| `POST /api/push/register` | Stores a browser's FCM token against the signed-in user. |
| `POST /api/gumroad-ping?token=…` | Grants **Pro automatically** when someone pays on Gumroad. |

Firebase (Auth, Firestore, rules, Storage) remains the main backend — this only
adds the server-only logic. It talks to Firestore with the Admin SDK, which
bypasses security rules, so **every endpoint verifies its caller** (a Firebase ID
token for user calls, a shared secret for machine calls).

## Who does what (no double alerts)

- **This cron** → email + push (works with ROMIO closed).
- **`src/tools/reminders.js`** (in-app) → bell notification + sound, while open.

Each de-dupes independently, so a reminder never fires twice on the same channel.

## Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**.

| Var | Required | What it is |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | ✅ | Whole JSON of a service-account key. Firebase console → Project settings → **Service accounts** → *Generate new private key*. Paste the file contents (base64 also accepted). |
| `CRON_SECRET` | ✅ | Any long random string. Guards the reminders cron. |
| `APP_URL` | – | Defaults to `https://romio.web.app`. Used in emails/push links. |
| `GUMROAD_PING_TOKEN` | – | Random string; enables auto-Pro. Must match the `?token=` in the Gumroad Ping URL. |
| `PRO_PRODUCTS` | – | Comma-separated Gumroad permalinks that grant Pro. Default `parnex`. |
| `ALLOWED_ORIGINS` | – | Extra CORS origins (comma separated), e.g. a custom domain. |

**Email — pick one** (optional; without it reminders still send bell + push):

*Gmail SMTP (no domain needed, ~500/day):* requires 2FA, then an
[App Password](https://myaccount.google.com/apppasswords).
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=<16-char app password>
MAIL_FROM=ROMIO <you@gmail.com>
```

*Resend (nicer, needs a domain you control DNS for):*
```
RESEND_API_KEY=re_...
MAIL_FROM=ROMIO <noreply@yourdomain.com>
```

## Frontend variables

Set in the **root** `.env.local` (not here), then rebuild + redeploy the app:

```
VITE_API_BASE=https://<your-vercel-project>.vercel.app
VITE_FIREBASE_VAPID_KEY=<Firebase console → Cloud Messaging → Web Push certificates → Generate key pair>
```

Without them the app runs exactly as before: in-app reminders only, manual Pro.

## Scheduling the cron

Vercel's free Hobby plan only runs cron **once per day**, which is too coarse for
punctual reminders. `vercel.json` sets a daily run as a safety net; for real
timing use a free external pinger every ~10 minutes:

1. [cron-job.org](https://cron-job.org) → create a job (free, 1-minute resolution)
2. URL: `https://<your-project>.vercel.app/api/cron/reminders?secret=<CRON_SECRET>`
3. Every 10 minutes.

## Deploy

```bash
cd backend
npx vercel --prod
```

## Local check

```bash
curl "https://<your-project>.vercel.app/api/health"
curl "https://<your-project>.vercel.app/api/cron/reminders?secret=<CRON_SECRET>"
```

The cron returns a summary: `{ scanned, due, emailed, pushed, skipped, errors }`.
