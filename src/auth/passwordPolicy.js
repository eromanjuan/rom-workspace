// Password strength policy for ROM sign-up.
// Requirements: at least 8 characters, 1 uppercase letter, 1 number, 1 special character.

export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'upper', label: '1 uppercase letter (A–Z)', test: (p) => /[A-Z]/.test(p) },
  { id: 'number', label: '1 number (0–9)', test: (p) => /[0-9]/.test(p) },
  { id: 'special', label: '1 special character (!@#$…)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

// Returns { valid, results: [{id,label,ok}], firstError }
export function checkPassword(password) {
  const pw = password || '';
  const results = PASSWORD_RULES.map((r) => ({ id: r.id, label: r.label, ok: r.test(pw) }));
  const valid = results.every((r) => r.ok);
  const firstError = results.find((r) => !r.ok);
  return { valid, results, firstError: firstError ? firstError.label : null };
}

// A coarse strength estimate for the meter: weak / medium / strong.
// Scores length + character variety; independent of the pass/fail policy above.
export function passwordStrength(password) {
  const p = password || '';
  if (!p) return { level: 'none', label: '', pct: 0 };
  let score = 0;
  if (p.length >= 8) score += 1;
  if (p.length >= 12) score += 1;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score += 1;
  if (/[0-9]/.test(p)) score += 1;
  if (/[^A-Za-z0-9]/.test(p)) score += 1;
  if (score <= 2) return { level: 'weak', label: 'Weak', pct: 33 };
  if (score <= 3) return { level: 'medium', label: 'Medium', pct: 66 };
  return { level: 'strong', label: 'Strong', pct: 100 };
}
