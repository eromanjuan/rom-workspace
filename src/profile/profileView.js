// The Profile page: user/owner details, previous posts, and personal widgets.
import { el, clear, icon, toast } from '../ui/dom.js';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { displayNameOf } from '../auth/auth.js';
import { isMaster, roleLabel } from '../workspaces/roles.js';
import { getUserProfile, listMyWorkspaces, setCurrentWorkspace } from '../workspaces/data.js';
import { postCard } from '../feed/feed.js';
import { renderWidgetsPanel } from '../feed/widgets.js';
import { avatarNode, applyAvatar, pickAndEditAvatar, removeAvatar } from './avatar.js';

// Returns an unsubscribe function (for the live widgets listener).
export function renderProfile(host, user, { onOpenWorkspace, onOpenUser } = {}) {
  clear(host);
  const name = displayNameOf(user);

  // --- details (editable avatar) ---
  const avatar = avatarNode(name, null, 'profile-avatar');
  const editAvatarBtn = el('button', { class: 'avatar-edit-btn', title: 'Change photo', 'aria-label': 'Change photo' }, icon('camera'));
  editAvatarBtn.addEventListener('click', () => pickAndEditAvatar(user, (url) => applyAvatar(avatar, name, url)));
  const removeAvatarBtn = el('button', { class: 'avatar-remove-btn', title: 'Remove photo', style: 'display:none' }, icon('trash'));
  removeAvatarBtn.addEventListener('click', () => removeAvatar(user, () => { applyAvatar(avatar, name, null); removeAvatarBtn.style.display = 'none'; }));
  const avatarWrap = el('div', { class: 'profile-avatar-wrap' }, [avatar, editAvatarBtn, removeAvatarBtn]);

  const bioEl = el('p', { class: 'profile-bio', style: 'display:none' });
  const siteEl = el('a', { class: 'profile-website', target: '_blank', rel: 'noopener noreferrer', style: 'display:none' }, [icon('link'), el('span', {})]);
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
      bioEl,
      siteEl,
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
      const wsCard = (w) => {
        // Clicking a workspace you belong to switches to it and opens the dashboard.
        const card = el('button', { class: 'profile-ws-card card profile-ws-card--btn', title: `Open ${w.name}` }, [
          w.imageUrl
            ? el('div', { class: 'ws-avatar ws-avatar--img' }, el('img', { src: w.imageUrl, alt: w.name }))
            : el('div', { class: 'ws-avatar', style: `background:${w.color || '#5b8cff'}` }, icon(w.icon || 'layout-dashboard')),
          el('div', { class: 'profile-ws-meta' }, [
            el('div', { class: 'profile-ws-name' }, w.name),
            el('div', { class: 'muted' }, roleLabel(w.myRole)),
          ]),
          el('span', { class: 'profile-ws-open muted' }, icon('arrow-up-right')),
        ]);
        card.addEventListener('click', async () => {
          card.disabled = true;
          try { await setCurrentWorkspace(user.uid, w.id); (onOpenWorkspace || (() => {}))(); }
          catch (e) { toast(e.message, 'error'); card.disabled = false; }
        });
        return card;
      };
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
    if (p?.bio) { bioEl.textContent = p.bio; bioEl.style.display = ''; }
    if (p?.website && /^https?:\/\//i.test(p.website)) { siteEl.href = p.website; siteEl.querySelector('span').textContent = p.website.replace(/^https?:\/\//, ''); siteEl.style.display = ''; }
  }).catch(() => {});

  // Previous posts — rendered with the same card as the Feed (media, likes, comments).
  // Live listener so a like/comment made here (or in the Feed) shows up straight away.
  const expanded = new Set();   // comment threads left open across repaints
  const drafts = new Map();     // half-typed comments survive a repaint
  let lastDocs = [];
  const paintPosts = () => {
    clear(posts);
    const list = lastDocs.slice().sort(
      (a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0),
    );
    if (!list.length) { posts.append(el('p', { class: 'muted' }, 'You have not posted anything yet.')); return; }
    for (const d of list) {
      posts.append(postCard(d, user, { expanded, drafts, paint: paintPosts, onOpenUser }));
    }
  };
  const unsubPosts = onSnapshot(
    query(collection(db, 'posts'), where('authorId', '==', user.uid)),
    (snap) => { lastDocs = snap.docs; paintPosts(); },
    (err) => { clear(posts); posts.append(el('p', { class: 'error-text' }, err.message)); },
  );

  // Mount the personal widgets panel (shared with the Feed).
  const widgetsCleanup = renderWidgetsPanel(widgetHost, user);
  return () => {
    widgetsCleanup();
    unsubPosts();
    window.removeEventListener('rom-workspaces-changed', onWsChange);
  };
}
