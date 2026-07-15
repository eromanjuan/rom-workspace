// The application shell: a persistent left sidebar + top bar.
// Views render into the returned `content` element.
import { el, clear, icon } from './dom.js';
import { displayNameOf, logOut } from '../auth/auth.js';
import { applyAvatar } from '../profile/avatar.js';
import { isMaster } from '../workspaces/roles.js';

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
      { id: 'messages', label: 'Messages', icon: 'message' },
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
      { id: 'tabulation', label: 'Tabulation', icon: 'table', newTab: true, href: '/tabulation', masterOnly: true },
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
export function buildShell(user, { onNavigate, onSearch }) {
  const navButtons = new Map();

  const collapseBtn = el('button', { class: 'sb-collapse', title: 'Collapse sidebar' }, icon('menu-2'));
  const brand = el('div', { class: 'sb-brand' }, [
    el('img', { class: 'sb-brand-mark', src: '/romio-mark.png', alt: '', width: '34', height: '34' }),
    el('div', { class: 'sb-brand-txt' }, [
      el('span', { class: 'brand-word sb-brand-word', role: 'img', 'aria-label': 'ROMIO' }),
    ]),
    collapseBtn,
  ]);

  // (account card removed — the user's identity/role is shown on the Profile page)

  const nav = el('nav', { class: 'sb-nav' });
  const navBadges = new Map();
  let wsSubnav = null;      // collapsible list of the current workspace's apps
  let onOpenWsApp = null;   // set via setWorkspaceApps
  for (const group of NAV_GROUPS) {
    nav.append(el('div', { class: 'sb-group' }, group.title));
    for (const item of group.items) {
      if (item.masterOnly && !isMaster(user)) continue; // e.g. Tabulation admin
      const badge = el('span', { class: 'sb-badge', style: 'display:none' });
      navBadges.set(item.id, badge);
      // New-tab items are real anchors (reliable across browsers + no popup block).
      const btn = item.newTab
        ? el('a', { class: 'sb-item', href: item.href, target: '_blank', rel: 'noopener' }, [
            icon(item.icon),
            el('span', { class: 'sb-item-label' }, item.label),
            el('span', { class: 'sb-ext' }, icon('external-link')),
          ])
        : el('button', {
            class: `sb-item${item.soon ? ' sb-item--soon' : ''}`,
            onclick: () => onNavigate(item.id, item),
          }, [
            icon(item.icon),
            el('span', { class: 'sb-item-label' }, item.label),
            item.soon ? el('span', { class: 'sb-soon' }, 'soon') : badge,
          ]);
      navButtons.set(item.id, btn);
      nav.append(btn);

      // The Workspace item expands to list the current workspace's apps.
      if (item.id === 'workspace') {
        const caret = el('button', { class: 'sb-caret', title: 'Show apps', 'aria-label': 'Show workspace apps' }, icon('chevron-right'));
        btn.append(caret);
        wsSubnav = el('div', { class: 'sb-subnav', style: 'display:none' });
        nav.append(wsSubnav);
        caret.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = wsSubnav.style.display === 'none';
          wsSubnav.style.display = open ? '' : 'none';
          caret.classList.toggle('open', open);
        });
      }
    }
  }
  // Populate the Workspace sub-list with the current workspace's apps.
  const setWorkspaceApps = (apps, onOpen) => {
    if (!wsSubnav) return;
    onOpenWsApp = onOpen || onOpenWsApp;
    clear(wsSubnav);
    if (!apps || !apps.length) {
      wsSubnav.append(el('div', { class: 'sb-subempty muted' }, 'No apps in this workspace yet'));
      return;
    }
    for (const app of apps) {
      const b = el('button', { class: 'sb-subitem', title: app.name }, [
        el('span', { class: 'sb-subdot', style: `background:${app.color || '#e0552d'}` }),
        el('span', { class: 'sb-subitem-label' }, app.name),
      ]);
      b.addEventListener('click', () => { if (onOpenWsApp) onOpenWsApp(app); });
      wsSubnav.append(b);
    }
  };
  // Update a nav item's activity badge (0 hides it).
  const setNavBadge = (id, count) => {
    const b = navBadges.get(id);
    if (!b) return;
    b.textContent = count > 9 ? '9+' : String(count);
    b.style.display = count > 0 ? '' : 'none';
  };

  const footAvatar = el('div', { class: 'sb-avatar sb-avatar--sm' }, initials(displayNameOf(user)));
  // The avatar + name double as a shortcut to your own profile.
  const footMe = el('button', { class: 'sb-foot-me', type: 'button', title: 'View your profile', onclick: () => { if (onNavigate) onNavigate('profile'); } }, [
    footAvatar,
    el('div', { class: 'sb-foot-name' }, displayNameOf(user)),
  ]);
  const foot = el('div', { class: 'sb-foot' }, [
    footMe,
    el('button', { class: 'sb-logout', title: 'Log out', onclick: () => logOut() }, icon('logout')),
  ]);

  const sidebar = el('aside', { class: 'sidebar' }, [brand, nav, foot]);

  // Mobile hamburger (opens the sidebar drawer); hidden on desktop via CSS.
  const menuBtn = el('button', { class: 'topbar-menu', title: 'Menu', 'aria-label': 'Open menu' }, icon('menu-2'));
  // Notification bell (badge + panel wired by mountNotifications in main).
  const bell = el('button', { class: 'topbar-icon notif-bell', title: 'Notifications', 'aria-label': 'Notifications' }, icon('bell'));
  // Topbar badge shows the CURRENT workspace's icon/image (set via setWorkspaceBadge).
  const topAvatar = el('div', { class: 'topbar-avatar topbar-ws-badge', title: 'Workspace' }, icon('layout-dashboard'));
  const topbar = el('header', { class: 'topbar' }, [
    menuBtn,
    (() => {
      const searchInput = el('input', { class: 'topbar-search-input', placeholder: 'Search ROMIO', type: 'search' });
      searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && onSearch) onSearch(searchInput.value.trim()); });
      return el('form', { class: 'topbar-search', onsubmit: (e) => { e.preventDefault(); if (onSearch) onSearch(searchInput.value.trim()); } }, [icon('search'), searchInput]);
    })(),
    el('button', { class: 'topbar-icon', title: 'Refresh', onclick: () => location.reload() }, icon('refresh')),
    bell,
    topAvatar,
  ]);

  const content = el('main', { class: 'content' });
  // Persistent host for the embedded Workspace iframe — it stays mounted (just
  // hidden) so the heavy module loads only once, not on every visit.
  const wsHost = el('div', { class: 'ws-host' });
  const scrim = el('div', { class: 'sidebar-scrim' });
  const root = el('div', { class: 'app-shell' }, [
    sidebar,
    el('div', { class: 'app-main' }, [topbar, content, wsHost]),
    scrim,
  ]);

  // Mobile drawer: hamburger opens the sidebar over a scrim; tapping the scrim
  // or any nav item closes it.
  const openDrawer = (o) => { root.classList.toggle('drawer-open', o); };
  menuBtn.addEventListener('click', () => openDrawer(!root.classList.contains('drawer-open')));
  scrim.addEventListener('click', () => openDrawer(false));
  sidebar.addEventListener('click', (e) => { if (e.target.closest('.sb-item, .sb-logout')) openDrawer(false); });

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

  // Reflect a chosen profile photo in the sidebar avatar (the topbar now shows
  // the current workspace's icon, not the user's photo).
  const setAvatar = (photoURL) => {
    applyAvatar(footAvatar, displayNameOf(user), photoURL);
  };

  // Show the current workspace's icon/image in the topbar badge.
  const setWorkspaceBadge = (ws) => {
    clear(topAvatar);
    topAvatar.classList.remove('has-photo');
    topAvatar.removeAttribute('style');
    if (!ws) { topAvatar.title = 'Workspace'; topAvatar.append(icon('layout-dashboard')); return; }
    topAvatar.title = ws.name || 'Workspace';
    if (ws.imageUrl) { topAvatar.classList.add('has-photo'); topAvatar.append(el('img', { src: ws.imageUrl, alt: ws.name || '' })); return; }
    topAvatar.style.background = ws.color || '#5b8cff';
    topAvatar.append(icon(ws.icon || 'layout-dashboard'));
  };

  return { root, content, wsHost, setActive, bell, setAvatar, setWorkspaceBadge, setNavBadge, setWorkspaceApps };
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
