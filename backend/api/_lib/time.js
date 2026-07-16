// Timezone math for reminders.
//
// ROMIO stores events as local wall-clock strings with no zone: date "2026-07-20"
// + time "09:00" means 9am WHERE THE USER IS. The browser got this right for free
// (it parses in the local zone). A server runs in UTC, so it must convert using
// the user's own zone, saved on their user doc as `tz` (an IANA name like
// "Asia/Manila"). Without this, reminders fire hours early or late.

// How far a zone sits from UTC at a given instant, in ms.
function offsetAt(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) if (part.type !== 'literal') p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second);
  return asUTC - date.getTime();
}

// Convert wall-clock "YYYY-MM-DD" + "HH:MM" in `tz` to a UTC epoch (ms).
// Two passes so DST transitions resolve correctly.
export function wallTimeToUtcMs(dateStr, timeStr, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!m) return NaN;
  const t = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '09:00').trim()) || ['', '9', '00'];
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const [h, mi] = [+t[1], +t[2]];
  const zone = isValidTz(tz) ? tz : 'UTC';
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  let utc = guess - offsetAt(new Date(guess), zone);
  utc = guess - offsetAt(new Date(utc), zone);
  return utc;
}

export function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// A friendly "Mon, Jul 20 at 9:00 AM" rendered in the user's own zone.
export function formatInZone(utcMs, tz) {
  const zone = isValidTz(tz) ? tz : 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone, weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(utcMs));
  } catch { return new Date(utcMs).toISOString(); }
}
