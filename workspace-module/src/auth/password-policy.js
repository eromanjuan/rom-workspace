export const PASSWORD_MIN_LENGTH = 12;

export function passwordRequirements() {
  return [
    `At least ${PASSWORD_MIN_LENGTH} characters`,
    'One uppercase letter',
    'One lowercase letter',
    'One number',
  ];
}

export function passwordPolicy(value) {
  const password = String(value || '');
  const checks = [
    [password.length >= PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`],
    [/[A-Z]/.test(password), 'Add an uppercase letter.'],
    [/[a-z]/.test(password), 'Add a lowercase letter.'],
    [/\d/.test(password), 'Add a number.'],
  ];
  const issues = checks.filter(([valid]) => !valid).map(([, message]) => message);
  return { valid: issues.length === 0, issues };
}
