// Theme: light/dark plus a fully customizable color palette.
// The palette overrides are applied as inline CSS variables on <html>, so they
// win over the base theme in both dark and light modes. Persisted in localStorage.
const KEY = 'rom-theme';
const PKEY = 'rom-palette';

// The customizable palette variables (label + which CSS var + sensible defaults per theme).
export const PALETTE_VARS = [
  { var: '--primary', label: 'Accent', def: { dark: '#5b8cff', light: '#3f6fff' } },
  { var: '--bg', label: 'Background', def: { dark: '#0f1115', light: '#f4f6fa' } },
  { var: '--surface', label: 'Surface / cards', def: { dark: '#1a1d24', light: '#ffffff' } },
  { var: '--text', label: 'Text', def: { dark: '#e7e9ee', light: '#1c2230' } },
  { var: '--danger', label: 'Danger', def: { dark: '#ff6b6b', light: '#e5484d' } },
];

export function getTheme() {
  return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY, theme);
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  return next;
}

// --- custom palette ---

export function getPalette() {
  try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; }
}

export function applyPalette() {
  const p = getPalette();
  for (const { var: v } of PALETTE_VARS) {
    if (p[v]) document.documentElement.style.setProperty(v, p[v]);
    else document.documentElement.style.removeProperty(v);
  }
}

export function setPaletteVar(cssVar, value) {
  const p = getPalette();
  p[cssVar] = value;
  localStorage.setItem(PKEY, JSON.stringify(p));
  document.documentElement.style.setProperty(cssVar, value);
}

export function resetPalette() {
  localStorage.removeItem(PKEY);
  for (const { var: v } of PALETTE_VARS) document.documentElement.style.removeProperty(v);
}

// The effective current value of a palette var (custom override, else theme default).
export function currentPaletteValue(entry) {
  const p = getPalette();
  if (p[entry.var]) return p[entry.var];
  return entry.def[getTheme()];
}

export function initTheme() {
  applyTheme(getTheme());
  applyPalette();
}
