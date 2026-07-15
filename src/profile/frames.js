// Preset + custom decorative frames for the profile avatar. Stored on the user's
// profile as: avatarFrame (preset id | 'custom' | ''), avatarFrameThickness (px),
// and avatarFrameCustom ({ mode:'solid'|'gradient', c1, c2, angle }). Rendered by
// setting data-frame (+ inline --frm/padding for custom) on the avatar wrapper.
export const AVATAR_FRAMES = [
  { id: '', label: 'None' },
  { id: 'gold', label: 'Gold' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'neon', label: 'Neon' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'fire', label: 'Fire' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'mono', label: 'Mono' },
];

export const DEFAULT_THICKNESS = 5;
export const DEFAULT_CUSTOM = { mode: 'gradient', c1: '#5b8cff', c2: '#8a5bff', angle: 135 };

const VALID = new Set([...AVATAR_FRAMES.map((f) => f.id), 'custom']);
export const cleanFrame = (id) => (VALID.has(id || '') ? (id || '') : '');

// The CSS value for a custom frame's --frm (solid color or gradient). Presets
// define their own --frm in styles.css, so this returns null for them.
export function customFrameCss(custom) {
  const c = { ...DEFAULT_CUSTOM, ...(custom || {}) };
  if (c.mode === 'solid') return c.c1 || DEFAULT_CUSTOM.c1;
  return `linear-gradient(${Number(c.angle) || 135}deg, ${c.c1 || DEFAULT_CUSTOM.c1}, ${c.c2 || DEFAULT_CUSTOM.c2})`;
}

// Apply a frame (preset or custom) to an avatar wrapper element.
export function applyFrame(wrap, { frame, custom, thickness } = {}) {
  if (!wrap) return;
  wrap.style.removeProperty('--frm');
  wrap.style.removeProperty('padding');
  const f = cleanFrame(frame);
  if (!f) { delete wrap.dataset.frame; return; }
  wrap.dataset.frame = f;
  if (f === 'custom') wrap.style.setProperty('--frm', customFrameCss(custom));
  const t = Number(thickness);
  if (Number.isFinite(t) && t >= 0) wrap.style.padding = `${t}px`;
}
