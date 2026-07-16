// Sending email. Two providers, picked by whichever env vars you set:
//
//  A) SMTP (works today, no domain needed) — e.g. Gmail with an App Password:
//       SMTP_HOST=smtp.gmail.com  SMTP_PORT=587
//       SMTP_USER=you@gmail.com   SMTP_PASS=<16-char app password>
//       MAIL_FROM="ROMIO <you@gmail.com>"
//     Gmail allows ~500 sends/day. Requires 2FA on the account, then create the
//     App Password at https://myaccount.google.com/apppasswords
//
//  B) Resend (nicer, needs a domain you control DNS for):
//       RESEND_API_KEY=re_...
//       MAIL_FROM="ROMIO <noreply@yourdomain.com>"
//
// If neither is configured, sendEmail() no-ops and reports skipped — reminders
// still deliver via the bell + push, so email is strictly additive.
import nodemailer from 'nodemailer';

let transport = null;
function smtpTransport() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transport;
}

export function emailConfigured() {
  return !!(process.env.RESEND_API_KEY || (process.env.SMTP_HOST && process.env.SMTP_USER));
}

export async function sendEmail({ to, subject, text, html }) {
  if (!to) return { ok: false, skipped: 'no recipient' };
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'ROMIO <noreply@romio.app>';

  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text, html }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
    return { ok: true, via: 'resend' };
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    await smtpTransport().sendMail({ from, to, subject, text, html });
    return { ok: true, via: 'smtp' };
  }

  return { ok: false, skipped: 'email not configured' };
}

// The reminder email body. Plain, readable, and safe against HTML injection.
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export function reminderEmail({ title, whenLabel, whenText, appUrl }) {
  const subject = `Reminder: ${title}`;
  const text = `${title}\n\n${whenLabel} — ${whenText}\n\nOpen ROMIO: ${appUrl}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
  <table role="presentation" style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.06)">
    <tr><td style="background:linear-gradient(135deg,#5b8cff,#8a5bff);padding:18px 22px;color:#fff;font-weight:700;font-size:18px">ROMIO</td></tr>
    <tr><td style="padding:22px">
      <p style="margin:0 0 6px;color:#6b7280;font-size:13px">${esc(whenLabel)}</p>
      <h1 style="margin:0 0 10px;font-size:20px;color:#111827">${esc(title)}</h1>
      <p style="margin:0 0 20px;color:#374151;font-size:15px">${esc(whenText)}</p>
      <a href="${esc(appUrl)}" style="display:inline-block;background:#5b8cff;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">Open ROMIO</a>
    </td></tr>
    <tr><td style="padding:14px 22px;background:#fafafa;color:#9ca3af;font-size:12px">You're getting this because you set a reminder in ROMIO.</td></tr>
  </table></body></html>`;
  return { subject, text, html };
}
