// The Profile page: user/owner details, previous posts, and customizable widgets.
import { el, clear, icon, escapeHtml, timeAgo, toast } from '../ui/dom.js';
import { displayNameOf } from '../auth/auth.js';
import { isMaster, roleLabel } from '../workspaces/roles.js';
import {
  getUserProfile, listMyPosts, listMyWorkspaces,
  addWidget, subscribeWidgets, updateWidget, deleteWidget,
} from '../workspaces/data.js';

function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

// Returns an unsubscribe function (for the live widgets listener).
export function renderProfile(host, user) {
  clear(host);
  const name = displayNameOf(user);

  // --- details ---
  const details = el('div', { class: 'profile-head card' }, [
    el('div', { class: 'profile-avatar' }, initials(name)),
    el('div', {}, [
      el('div', { class: 'profile-name' }, name),
      el('div', { class: 'muted profile-username', id: 'profile-username' }, ''),
      el('div', { class: 'muted' }, user.email),
      el('div', { class: 'profile-badges' }, [
        el('span', { class: `pill ${isMaster(user) ? 'pill--owner' : 'pill--viewer'}` },
          isMaster(user) ? 'Master · full access' : 'Member'),
        user.emailVerified ? el('span', { class: 'pill pill--editor' }, [icon('circle-check'), ' Verified']) : null,
      ]),
      el('div', { class: 'muted profile-since', id: 'profile-since' }, ''),
    ]),
  ]);

  // --- previous posts ---
  const posts = el('div', { class: 'profile-posts' }, el('p', { class: 'muted' }, 'Loading your posts…'));

  // --- widgets ---
  const widgets = el('div', { class: 'profile-widgets' }, el('p', { class: 'muted' }, 'Loading widgets…'));
  const addWidgetBtn = el('button', { class: 'btn btn--ghost btn--sm', onclick: () => openWidgetForm() },
    [icon('plus'), ' Add widget']);

  const workspacesBox = el('div', { class: 'profile-ws-lists' }, el('p', { class: 'muted' }, 'Loading workspaces…'));

  host.append(
    el('div', { class: 'profile' }, [
      el('h2', { class: 'section__title' }, 'My Profile'),
      details,
      el('section', { class: 'profile-ws' }, [
        el('h3', { class: 'profile-subtitle' }, [icon('layout-dashboard'), ' My workspaces']),
        workspacesBox,
      ]),
      el('div', { class: 'profile-grid' }, [
        el('section', {}, [
          el('h3', { class: 'profile-subtitle' }, [icon('news'), ' Previous posts']),
          posts,
        ]),
        el('section', {}, [
          el('div', { class: 'profile-widgets-head' }, [
            el('h3', { class: 'profile-subtitle' }, [icon('layout-grid'), ' Widgets']),
            addWidgetBtn,
          ]),
          widgets,
        ]),
      ]),
    ]),
  );

  // load workspaces the user owns / is a member of
  listMyWorkspaces(user.uid).then((spaces) => {
    clear(workspacesBox);
    const owned = spaces.filter((w) => w.myRole === 'owner');
    const member = spaces.filter((w) => w.myRole !== 'owner');
    const wsCard = (w) => el('div', { class: 'profile-ws-card card' }, [
      w.imageUrl
        ? el('div', { class: 'ws-avatar ws-avatar--img' }, el('img', { src: w.imageUrl, alt: w.name }))
        : el('div', { class: 'ws-avatar', style: `background:${w.color || '#5b8cff'}` }, icon(w.icon || 'layout-dashboard')),
      el('div', { class: 'profile-ws-meta' }, [
        el('div', { class: 'profile-ws-name' }, w.name),
        el('div', { class: 'muted' }, roleLabel(w.myRole)),
      ]),
    ]);
    const group = (title, items) => el('div', { class: 'profile-ws-group' }, [
      el('div', { class: 'profile-ws-grouptitle muted' }, `${title} (${items.length})`),
      items.length ? el('div', { class: 'profile-ws-grid' }, items.map(wsCard)) : el('p', { class: 'muted' }, 'None yet.'),
    ]);
    workspacesBox.append(group('Owned by me', owned), group('Member of', member));
  }).catch((err) => { clear(workspacesBox); workspacesBox.append(el('p', { class: 'error-text' }, err.message)); });

  // fill username + "member since"
  getUserProfile(user.uid).then((p) => {
    if (p?.username) document.getElementById('profile-username').textContent = `@${p.username}`;
    const since = p?.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : null;
    if (since) document.getElementById('profile-since').textContent = `Member since ${since}`;
  }).catch(() => {});

  // load previous posts
  listMyPosts(user.uid).then((list) => {
    clear(posts);
    if (!list.length) { posts.append(el('p', { class: 'muted' }, 'You have not posted anything yet.')); return; }
    for (const p of list) {
      const when = p.createdAt?.toDate ? timeAgo(p.createdAt.toDate()) : '';
      posts.append(el('div', { class: 'profile-post card' }, [
        el('div', { class: 'profile-post-body', html: escapeHtml(p.text).replace(/\n/g, '<br>') }),
        el('div', { class: 'profile-post-time muted' }, when),
      ]));
    }
  }).catch((err) => { clear(posts); posts.append(el('p', { class: 'error-text' }, err.message)); });

  // widget form
  function openWidgetForm() {
    const title = el('input', { class: 'input', placeholder: 'Widget title (e.g. Links)' });
    const body = el('textarea', { class: 'input', rows: '3', placeholder: 'Widget content…' });
    const save = el('button', { class: 'btn btn--primary btn--sm' }, 'Add');
    const form = el('div', { class: 'widget-form card' }, [title, body, el('div', { class: 'row' }, [save])]);
    save.addEventListener('click', async () => {
      if (!title.value.trim() && !body.value.trim()) return;
      save.disabled = true;
      try { await addWidget(user.uid, { title: title.value.trim(), body: body.value.trim() }); form.remove(); }
      catch (err) { toast(err.message, 'error'); save.disabled = false; }
    });
    widgets.parentElement.insertBefore(form, widgets);
  }

  // live widgets
  return subscribeWidgets(user.uid, (list) => {
    clear(widgets);
    if (!list.length) { widgets.append(el('p', { class: 'muted' }, 'No widgets yet. Add one to customize your profile.')); return; }
    for (const w of list) {
      const bodyEl = el('div', { class: 'widget-body', html: escapeHtml(w.body || '').replace(/\n/g, '<br>') });
      widgets.append(el('div', { class: 'widget card' }, [
        el('div', { class: 'widget-head' }, [
          el('span', { class: 'widget-title' }, w.title || 'Note'),
          el('button', {
            class: 'wb-tile-add', title: 'Remove',
            onclick: async () => { try { await deleteWidget(user.uid, w.id); } catch (err) { toast(err.message, 'error'); } },
          }, icon('x')),
        ]),
        bodyEl,
        el('button', {
          class: 'link', onclick: () => {
            const ta = el('textarea', { class: 'input', rows: '3' }); ta.value = w.body || '';
            const s = el('button', { class: 'btn btn--primary btn--sm', onclick: async () => {
              try { await updateWidget(user.uid, w.id, { body: ta.value }); } catch (err) { toast(err.message, 'error'); }
            } }, 'Save');
            clear(bodyEl).append(ta, s);
          },
        }, 'Edit'),
      ]));
    }
  }, () => {});
}
