// The notification bell: a live unread badge plus a dropdown panel of recent
// notifications. Clicking a notification marks it read and navigates to where it
// was triggered. Everything is driven by the notifications/{uid}/items feed.
import { el, clear, icon, timeAgo } from '../ui/dom.js';
import { listenNotifications, markNotificationRead, markAllNotificationsRead } from '../workspaces/data.js';

const TYPE_ICON = {
  invite: 'mail', joinRequest: 'user-plus', joinApproved: 'check', joinDeclined: 'x',
  memberAdded: 'users', like: 'heart', comment: 'message-circle', newPost: 'note', mention: 'at',
  message: 'message',
};

// Wire up the bell element: badge + click-to-open panel. Returns a cleanup fn.
export function mountNotifications(bell, user, { onNavigate, onCounts } = {}) {
  const badge = el('span', { class: 'notif-badge', style: 'display:none' });
  bell.append(badge);
  let items = [];
  let panel = null;

  const unsub = listenNotifications(user.uid, (list) => {
    items = list;
    const unreadItems = list.filter((n) => !n.read);
    const unread = unreadItems.length;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.style.display = unread ? '' : 'none';
    // Per-target-view counts for the sidebar nav badges.
    if (onCounts) {
      const byView = {};
      for (const n of unreadItems) { const v = n.link && n.link.view; if (v) byView[v] = (byView[v] || 0) + 1; }
      onCounts(byView);
    }
    if (panel) renderList();
  });

  // Mark all currently-unread notifications targeting a view as read (called
  // when the user navigates to that view, so its badge clears).
  const markViewRead = (view) => {
    const ids = items.filter((n) => !n.read && n.link && n.link.view === view).map((n) => n.id);
    if (ids.length) markAllNotificationsRead(user.uid, ids);
  };

  function onDocDown(e) {
    if (panel && !panel.contains(e.target) && !bell.contains(e.target)) closePanel();
  }
  function closePanel() {
    if (panel) { panel.remove(); panel = null; document.removeEventListener('mousedown', onDocDown); }
  }

  function renderList() {
    const listBox = panel && panel.querySelector('.notif-list');
    if (!listBox) return;
    clear(listBox);
    if (!items.length) { listBox.append(el('div', { class: 'notif-empty' }, 'No notifications yet.')); return; }
    for (const n of items) {
      const when = n.createdAt?.toDate ? timeAgo(n.createdAt.toDate()) : '';
      const row = el('button', { class: `notif-item ${n.read ? '' : 'is-unread'}` }, [
        el('span', { class: 'notif-ic' }, icon(TYPE_ICON[n.type] || 'bell')),
        el('div', { class: 'notif-main' }, [
          el('div', { class: 'notif-title' }, n.title || 'Notification'),
          n.body ? el('div', { class: 'notif-body' }, n.body) : null,
          el('div', { class: 'notif-time muted' }, when),
        ]),
        n.read ? null : el('span', { class: 'notif-dot' }),
      ]);
      row.addEventListener('click', () => {
        closePanel();
        if (!n.read) markNotificationRead(user.uid, n.id);
        const link = n.link || {};
        if (link.view && onNavigate) onNavigate(link.view, link.arg || null);
      });
      listBox.append(row);
    }
  }

  function openPanel() {
    if (panel) { closePanel(); return; }
    const r = bell.getBoundingClientRect();
    const readAll = el('button', { class: 'notif-readall' }, 'Mark all read');
    readAll.addEventListener('click', () => markAllNotificationsRead(user.uid, items.filter((n) => !n.read).map((n) => n.id)));
    panel = el('div', { class: 'notif-panel' }, [
      el('div', { class: 'notif-head' }, [el('strong', {}, 'Notifications'), readAll]),
      el('div', { class: 'notif-list' }),
    ]);
    panel.style.position = 'fixed';
    panel.style.top = `${Math.min(r.bottom + 8, window.innerHeight - 20)}px`;
    panel.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
    document.body.append(panel);
    renderList();
    setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
  }

  bell.addEventListener('click', (e) => { e.stopPropagation(); openPanel(); });

  return { cleanup: () => { unsub(); closePanel(); badge.remove(); }, markViewRead };
}
