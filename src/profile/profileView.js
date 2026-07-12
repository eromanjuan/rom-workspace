// The Profile page: user/owner details, previous posts, and personal widgets.
import { el, clear, icon, escapeHtml, timeAgo } from '../ui/dom.js';
import { displayNameOf } from '../auth/auth.js';
import { isMaster, roleLabel } from '../workspaces/roles.js';
import { getUserProfile, listMyPosts, listMyWorkspaces } from '../workspaces/data.js';
import { renderWidgetsPanel } from '../feed/widgets.js';
import { avatarNode, applyAvatar, pickAndEditAvatar, removeAvatar } from './avatar.js';

// Returns an unsubscribe function (for the live widgets listener).
export function renderProfile(host, user) {
  clear(host);
  const name = displayNameOf(user);

  // --- details (editable avatar) ---
  const avatar = avatarNode(name, null, 'profile-avatar');
  const editAvatarBtn = el('button', { class: 'avatar-edit-btn', title: 'Change photo', 'aria-label': 'Change photo' }, icon('camera'));
  editAvatarBtn.addEventListener('click', () => pickAndEditAvatar(user, (url) => applyAvatar(avatar, name, url)));
  const removeAvatarBtn = el('button', { class: 'avatar-remove-btn', title: 'Remove photo', style: 'display:none' }, icon('trash'));
  removeAvatarBtn.addEventListener('click', () => removeAvatar(user, () => { applyAvatar(avatar, name, null); removeAvatarBtn.style.display = 'none'; }));
  const avatarWrap = el('div', { class: 'profile-avatar-wrap' }, [avatar, editAvatarBtn, removeAvatarBtn]);

  const details = el('div', { class: 'profile-head card' }, [
    avatarWrap,
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

  // --- widgets (same personal panel as the Feed) ---
  const widgetHost = el('aside', { class: 'feed-widgets' });

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
        el('section', {}, [widgetHost]),
      ]),
    ]),
  );

  // load workspaces the user owns / is a member of (re-runs on changes)
  function loadWorkspaces() {
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
  }
  loadWorkspaces();
  const onWsChange = () => loadWorkspaces();
  window.addEventListener('rom-workspaces-changed', onWsChange);

  // fill username + "member since" + current photo
  getUserProfile(user.uid).then((p) => {
    if (p?.username) document.getElementById('profile-username').textContent = `@${p.username}`;
    const since = p?.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : null;
    if (since) document.getElementById('profile-since').textContent = `Member since ${since}`;
    if (p?.photoURL) { applyAvatar(avatar, name, p.photoURL); removeAvatarBtn.style.display = ''; }
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

  // Mount the personal widgets panel (shared with the Feed).
  const widgetsCleanup = renderWidgetsPanel(widgetHost, user);
  return () => { widgetsCleanup(); window.removeEventListener('rom-workspaces-changed', onWsChange); };
}
