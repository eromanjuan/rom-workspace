// Renders a user's profile links. Supports the new `links` array
// ([{ label?, url }]) and falls back to the legacy single `website` string.
import { el, icon } from '../ui/dom.js';

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
// Only http/https are safe as clickable hrefs (blocks javascript:/data: URLs).
const safeHttp = (url) => { try { const u = new URL(url); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };

// Returns a container with one anchor per link, or null when there are none.
export function profileLinksNode(profile) {
  const raw = Array.isArray(profile?.links) && profile.links.length
    ? profile.links
    : (profile?.website ? [{ url: profile.website }] : []);
  const items = raw.map((l) => ({ label: (l && l.label) || '', url: safeHttp(l && l.url) })).filter((l) => l.url);
  if (!items.length) return null;
  return el('div', { class: 'profile-links' }, items.map((l) =>
    el('a', { class: 'profile-website', href: l.url, target: '_blank', rel: 'noopener noreferrer' },
      [icon('link'), el('span', {}, l.label || hostOf(l.url))]),
  ));
}
