// The application shell: a persistent left sidebar + top bar, modelled on the
// quest-hq command center. Views render into the returned `content` element.
import { el, clear, icon } from './dom.js';
import { displayNameOf, logOut } from '../auth/auth.js';

// Sidebar navigation.
const NAV_GROUPS = [
  {
    title: 'Profile',
    items: [
      { id: 'profile', label: 'My Profile', icon: 'user' },
    ],
  },
  {
    title: 'Work',
    items: [
      { id: 'feed', label: 'Feed', icon: 'home' },
      { id: 'workspace', label: 'Workspace', icon: 'layout-dashboard' },
      { id: 'files', label: 'Files', icon: 'folder' },
    ],
  },
  {
    title: 'Tools',
    items: [
      { id: 'calendar', label: 'Calendar', icon: 'calendar' },
      { id: 'checklist', label: 'Checklist', icon: 'checklist' },
      { id: 'notes', label: 'Notes', icon: 'notes' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { id: 'settings', label: 'Settings', icon: 'settings' },
    ],
  },
];

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

// Builds the shell. Returns { root, content, setActive(viewId) }.
export function buildShell(user, { onNavigate }) {
  const navButtons = new Map();

  const collapseBtn = el('button', { class: 'sb-collapse', title: 'Collapse sidebar' }, icon('menu-2'));
  const brand = el('div', { class: 'sb-brand' }, [
    el('div', { class: 'sb-brand-mark' }, icon('bolt')),
    el('div', { class: 'sb-brand-txt' }, [
      el('div', { class: 'sb-brand-name' }, 'ROM'),
      el('div', { class: 'sb-brand-sub' }, 'COMMAND CENTER'),
    ]),
    collapseBtn,
  ]);

  // (account card removed — the user's identity/role is shown on the Profile page)

  const nav = el('nav', { class: 'sb-nav' });
  for (const group of NAV_GROUPS) {
    nav.append(el('div', { class: 'sb-group' }, group.title));
    for (const item of group.items) {
      const btn = el('button', {
        class: `sb-item${item.soon ? ' sb-item--soon' : ''}`,
        onclick: () => onNavigate(item.id, item),
      }, [
        icon(item.icon),
        el('span', {}, item.label),
        item.soon ? el('span', { class: 'sb-soon' }, 'soon') : null,
      ]);
      navButtons.set(item.id, btn);
      nav.append(btn);
    }
  }

  const foot = el('div', { class: 'sb-foot' }, [
    el('div', { class: 'sb-avatar sb-avatar--sm' }, initials(displayNameOf(user))),
    el('div', { class: 'sb-foot-name' }, displayNameOf(user)),
    el('button', { class: 'sb-logout', title: 'Log out', onclick: () => logOut() }, icon('logout')),
  ]);

  const sidebar = el('aside', { class: 'sidebar' }, [brand, nav, foot]);

  const topbar = el('header', { class: 'topbar' }, [
    el('div', { class: 'topbar-search' }, [
      icon('search'),
      el('input', { class: 'topbar-search-input', placeholder: 'Search ROM', type: 'search' }),
    ]),
    el('button', { class: 'topbar-icon', title: 'Refresh', onclick: () => location.reload() }, icon('refresh')),
    el('button', { class: 'topbar-icon', title: 'Notifications' }, icon('bell')),
    el('div', { class: 'topbar-avatar', title: displayNameOf(user) }, initials(displayNameOf(user))),
  ]);

  const content = el('main', { class: 'content' });
  // Persistent host for the embedded Workspace iframe — it stays mounted (just
  // hidden) so the heavy module loads only once, not on every visit.
  const wsHost = el('div', { class: 'ws-host' });
  const root = el('div', { class: 'app-shell' }, [
    sidebar,
    el('div', { class: 'app-main' }, [topbar, content, wsHost]),
  ]);

  // Collapsible sidebar (icon-only when collapsed), persisted across sessions.
  const COLLAPSE_KEY = 'rom-sidebar-collapsed';
  function applyCollapsed(c) {
    root.classList.toggle('sidebar-collapsed', c);
    collapseBtn.title = c ? 'Expand sidebar' : 'Collapse sidebar';
  }
  applyCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
  collapseBtn.addEventListener('click', () => {
    const c = !root.classList.contains('sidebar-collapsed');
    localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0');
    applyCollapsed(c);
  });

  function setActive(viewId) {
    for (const [id, btn] of navButtons) btn.classList.toggle('sb-item--active', id === viewId);
  }

  return { root, content, wsHost, setActive };
}

// A simple "coming soon" panel for Phase 2 modules.
export function renderPlaceholder(host, title, desc) {
  clear(host);
  host.append(el('div', { class: 'placeholder' }, [
    el('div', { class: 'placeholder-icon' }, icon('tools')),
    el('h2', {}, title),
    el('p', { class: 'muted' }, desc),
  ]));
}
