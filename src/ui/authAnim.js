// Full-screen success animation played after a correct sign-in or a successful
// account creation. Appended to <body> so it survives the app re-render that
// onAuthStateChanged triggers underneath, then fades itself out.
import { el } from './dom.js';

const CHECK_SVG = '<svg viewBox="0 0 52 52" aria-hidden="true"><path class="auth-anim-check" d="M14 27 l8 8 l16 -18"/></svg>';

export function playAuthSuccess(type = 'signin') {
  const isSignup = type === 'signup';
  const badge = el('div', { class: 'auth-anim-badge' });
  badge.innerHTML = CHECK_SVG;
  if (isSignup) badge.append(el('div', { class: 'auth-anim-ring' }), el('div', { class: 'auth-anim-ring r2' }));
  const overlay = el('div', { class: 'auth-anim' }, el('div', { class: 'auth-anim-inner' }, [
    badge,
    el('div', { class: 'auth-anim-title' }, isSignup ? 'Account created!' : 'Welcome back'),
    el('div', { class: 'auth-anim-sub' }, isSignup ? 'Setting up your ROMIO…' : 'Loading your command center…'),
  ]));
  document.body.append(overlay);
  if (isSignup) spawnConfetti(overlay);
  const total = isSignup ? 2200 : 1400;
  setTimeout(() => { overlay.classList.add('out'); setTimeout(() => overlay.remove(), 500); }, total);
  return overlay;
}

function spawnConfetti(host) {
  const colors = ['#5b8cff', '#8a5bff', '#21d0c3', '#ff5b9a', '#f0b429'];
  for (let i = 0; i < 28; i += 1) {
    const c = el('div', { class: 'auth-confetti' });
    c.style.left = `${Math.random() * 100}%`;
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = `${Math.random() * 0.5}s`;
    host.append(c);
  }
}
