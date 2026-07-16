// Sound preferences + playback. Preset sounds are SYNTHESIZED with the Web Audio
// API (no audio files to bundle); a custom sound is a user-uploaded audio clip
// stored inline as a data URL. Settings are per event type, kept in localStorage.

const KEY = 'romio-sounds';
export const MAX_SOUND_BYTES = 400 * 1024; // ~400 KB cap for uploaded clips

// The events that can play a sound, with their default preset.
export const SOUND_EVENTS = [
  { id: 'message', label: 'New chat message', icon: 'message', def: 'ding' },
  { id: 'send', label: 'Message sent', icon: 'send', def: 'pop' },
  { id: 'notification', label: 'Notification', icon: 'bell', def: 'chime' },
  { id: 'reminder', label: 'Reminder', icon: 'alarm', def: 'bell' },
  { id: 'alarm', label: 'Alarm', icon: 'alarm', def: 'alarm' },
];
// Preset ids + labels shown in the picker.
export const SOUND_PRESETS = [
  ['ding', 'Ding'], ['chime', 'Chime'], ['pop', 'Pop'], ['bell', 'Bell'],
  ['alarm', 'Alarm'], ['beep', 'Beep'], ['marimba', 'Marimba'], ['none', 'Silent'],
];

function loadCfg() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } }
function saveCfg(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* quota */ } }

export function getSoundConfig() {
  const c = loadCfg();
  const out = {};
  for (const e of SOUND_EVENTS) {
    const s = c[e.id] || {};
    out[e.id] = { enabled: s.enabled !== false, preset: s.preset || e.def, custom: s.custom || '' };
  }
  return out;
}
export function setSoundConfig(id, patch) {
  const c = loadCfg();
  c[id] = { ...(c[id] || {}), ...patch };
  saveCfg(c);
}

let ctx = null;
function audio() {
  try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  catch { return null; }
}
// Call from a user gesture to unlock audio for later (browsers block autoplay).
export function primeAudio() { audio(); }

function tone(ac, freq, start, dur, type = 'sine', vol = 0.2) {
  const o = ac.createOscillator(); const g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
  o.type = type; o.frequency.value = freq;
  const t = ac.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t); o.stop(t + dur + 0.03);
}
function playPreset(name) {
  const ac = audio(); if (!ac) return;
  switch (name) {
    case 'ding': tone(ac, 1318, 0, 0.42, 'sine', 0.28); break;
    case 'chime': [523, 659, 784].forEach((f, i) => tone(ac, f, i * 0.09, 0.4, 'sine', 0.2)); break;
    case 'pop': tone(ac, 420, 0, 0.09, 'triangle', 0.28); break;
    case 'bell': tone(ac, 880, 0, 0.6, 'sine', 0.24); tone(ac, 1760, 0, 0.6, 'sine', 0.09); break;
    case 'alarm': [880, 660, 880, 660].forEach((f, i) => tone(ac, f, i * 0.18, 0.15, 'square', 0.2)); break;
    case 'beep': tone(ac, 1000, 0, 0.16, 'square', 0.22); break;
    case 'marimba': [523, 784, 1047].forEach((f, i) => tone(ac, f, i * 0.07, 0.3, 'triangle', 0.2)); break;
    default: break; // 'none'
  }
}
function playCustom(dataUrl) {
  try { const a = new Audio(dataUrl); a.volume = 0.8; a.play().catch(() => {}); } catch { /* ignore */ }
}

// Play the sound for an event, honouring enabled + custom/preset choice.
export function playSound(id) {
  const cfg = getSoundConfig()[id];
  if (!cfg || !cfg.enabled) return;
  if (cfg.custom) playCustom(cfg.custom); else if (cfg.preset !== 'none') playPreset(cfg.preset);
}
// Preview ignores the enabled flag (so you can hear it while configuring).
export function previewSound(id, overridePreset) {
  const cfg = getSoundConfig()[id] || {};
  if (overridePreset) { if (overridePreset !== 'none') playPreset(overridePreset); return; }
  if (cfg.custom) playCustom(cfg.custom); else if (cfg.preset !== 'none') playPreset(cfg.preset);
}
