// Profile bio clamped to 3 lines with a "Show more" reveal. Clicking the text or
// the toggle expands/collapses it; short bios that fit show no toggle.
import { el } from '../ui/dom.js';

export function bioNode(text) {
  const p = el('p', { class: 'profile-bio profile-bio--clamp' }, text);
  const toggle = el('button', { class: 'profile-bio-toggle', type: 'button', style: 'display:none' }, 'Show more');
  const setExpanded = (on) => { p.classList.toggle('is-expanded', on); toggle.textContent = on ? 'Show less' : 'Show more'; };
  const flip = () => setExpanded(!p.classList.contains('is-expanded'));
  toggle.addEventListener('click', flip);
  p.addEventListener('click', () => { if (toggle.style.display !== 'none') flip(); });
  // Reveal the toggle only once we know the text actually exceeds 3 lines.
  requestAnimationFrame(() => { if (p.scrollHeight - p.clientHeight > 2) toggle.style.display = ''; });
  return el('div', { class: 'profile-bio-wrap' }, [p, toggle]);
}
