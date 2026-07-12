// Theme: light/dark plus a fully customizable color palette.
// The palette overrides are applied as inline CSS variables on <html>, so they
// win over the base theme in both dark and light modes. Persisted in localStorage.
const KEY = 'rom-theme';
const PKEY = 'rom-palette';
const AKEY = 'rom-appearance';

// Preset background patterns (theme-aware, pure CSS — no external assets).
export const BG_PATTERNS = [
  { id: 'dots', label: 'Dots', image: 'radial-gradient(color-mix(in srgb, var(--text) 16%, transparent) 1px, transparent 1.6px)', size: '16px 16px', repeat: 'repeat' },
  { id: 'grid', label: 'Grid', image: 'linear-gradient(color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1px)', size: '24px 24px', repeat: 'repeat' },
  { id: 'diagonal', label: 'Diagonal', image: 'repeating-linear-gradient(45deg, color-mix(in srgb, var(--text) 7%, transparent) 0 1px, transparent 1px 13px)', size: 'auto', repeat: 'repeat' },
  { id: 'glow', label: 'Glow', image: 'radial-gradient(at 18% 18%, color-mix(in srgb, var(--primary) 24%, transparent), transparent 42%), radial-gradient(at 82% 62%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 46%)', size: 'cover', repeat: 'no-repeat' },
  { id: 'mesh', label: 'Mesh', image: 'radial-gradient(at 0% 0%, color-mix(in srgb, var(--primary) 26%, transparent), transparent 40%), radial-gradient(at 100% 0%, color-mix(in srgb, var(--danger) 20%, transparent), transparent 42%), radial-gradient(at 60% 100%, color-mix(in srgb, var(--primary) 20%, transparent), transparent 44%)', size: 'cover', repeat: 'no-repeat' },
];

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

// --- appearance (card glass/blur + background image/pattern) ---
// Defaults to the plain current look when nothing is set.
export function getAppearance() {
  try { return JSON.parse(localStorage.getItem(AKEY)) || {}; } catch { return {}; }
}
export function setAppearance(patch) {
  const a = { ...getAppearance(), ...patch };
  localStorage.setItem(AKEY, JSON.stringify(a));
  applyAppearance();
  return a;
}
export function resetAppearance() {
  localStorage.removeItem(AKEY);
  applyAppearance();
}
function clearAppBg(root) {
  root.removeAttribute('data-appbg');
  root.style.removeProperty('--app-bg-image');
  root.style.removeProperty('--app-bg-size');
  root.style.removeProperty('--app-bg-repeat');
}
export function applyAppearance() {
  const a = getAppearance();
  const root = document.documentElement;
  // Cards: solid (default) or frosted glass with a blur level + opacity.
  if (a.cardStyle === 'glass') {
    root.setAttribute('data-cards', 'glass');
    root.style.setProperty('--card-blur', `${a.cardBlur != null ? a.cardBlur : 10}px`);
    root.style.setProperty('--card-opacity', `${a.cardOpacity != null ? a.cardOpacity : 65}%`);
  } else {
    root.removeAttribute('data-cards');
    root.style.removeProperty('--card-blur');
    root.style.removeProperty('--card-opacity');
  }
  // Background: uploaded image or a preset pattern (else the plain default bg).
  if (a.bgType === 'image' && a.bgImage) {
    root.setAttribute('data-appbg', 'image');
    root.style.setProperty('--app-bg-image', `url("${a.bgImage}")`);
    root.style.setProperty('--app-bg-size', 'cover');
    root.style.setProperty('--app-bg-repeat', 'no-repeat');
  } else if (a.bgType === 'pattern' && a.bgPattern) {
    const pat = BG_PATTERNS.find((p) => p.id === a.bgPattern);
    if (pat) {
      root.setAttribute('data-appbg', 'pattern');
      root.style.setProperty('--app-bg-image', pat.image);
      root.style.setProperty('--app-bg-size', pat.size || 'auto');
      root.style.setProperty('--app-bg-repeat', pat.repeat || 'repeat');
    } else clearAppBg(root);
  } else clearAppBg(root);
}

export function initTheme() {
  applyTheme(getTheme());
  applyPalette();
  applyAppearance();
}
