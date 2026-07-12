// Public profile of another user: identity plus whatever they've chosen to make
// visible (posts, member-since, verified badge, email, owned workspaces). The
// visibility flags live on users/{uid}.visibility; hidden sections are omitted.
import { el, clear, icon } from '../ui/dom.js';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../firebase.js';
import { getUserProfile } from '../workspaces/data.js';
import { postCard } from '../feed/feed.js';
import { avatarNode } from './avatar.js';

const VISIBILITY_DEFAULTS = { posts: true, ownedWorkspaces: true, memberSince: true, verified: true, email: false };

export function renderUserProfile(host, targetUid, currentUser, { onBack, onOpenUser }) {
  clear(host);

  const head = el('div', { class: 'profile-head card' }, el('p', { class: 'muted' }, 'Loading profile…'));
  const sections = el('div', { class: 'profile-sections' });

  host.append(el('div', { class: 'profile' }, [
    el('button', { class: 'btn btn--ghost btn--sm search-back', onclick: onBack }, [icon('arrow-left'), ' Back']),
    el('h2', { class: 'section__title' }, 'Profile'),
    head,
    sections,
  ]));

  let unsub = null;

  getUserProfile(targetUid).then((p) => {
    const vis = { ...VISIBILITY_DEFAULTS, ...(p?.visibility || {}) };
    const name = p?.displayName || 'User';
    const since = p?.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : null;

    clear(head).append(
      avatarNode(name, p?.photoURL, 'profile-avatar'),
      el('div', {}, [
        el('div', { class: 'profile-name' }, name),
        p?.username ? el('div', { class: 'muted profile-username' }, `@${p.username}`) : null,
        vis.email && p?.email ? el('div', { class: 'muted profile-email' }, p.email) : null,
        vis.verified && p?.emailVerified ? el('span', { class: 'pill pill--editor profile-verified' }, [icon('circle-check'), ' Verified']) : null,
        vis.memberSince && since ? el('div', { class: 'muted profile-since' }, `Member since ${since}`) : null,
      ]),
    );

    clear(sections);

    // Owned workspaces (workspace docs are readable; memberships are private).
    if (vis.ownedWorkspaces) {
      const wsBox = el('div', { class: 'profile-ws-list' }, el('p', { class: 'muted' }, 'Loading…'));
      sections.append(el('section', {}, [
        el('h3', { class: 'profile-subtitle' }, [icon('layout-dashboard'), ' Workspaces']),
        wsBox,
      ]));
      getDocs(query(collection(db, 'workspaces'), where('ownerId', '==', targetUid))).then((snap) => {
        clear(wsBox);
        if (snap.empty) { wsBox.append(el('p', { class: 'muted' }, 'No public workspaces.')); return; }
        snap.docs.forEach((d) => {
          const w = d.data();
          wsBox.append(el('div', { class: 'profile-ws-item card' }, [
            el('div', { class: 'profile-ws-ic', style: `background:${w.color || '#5b8cff'}` }, icon(w.icon || 'layout-dashboard')),
            el('div', {}, [el('div', { class: 'profile-ws-name' }, w.name || 'Workspace'), w.description ? el('div', { class: 'muted' }, w.description) : null]),
          ]));
        });
      }).catch(() => { clear(wsBox).append(el('p', { class: 'muted' }, 'Could not load workspaces.')); });
    }

    // Posts.
    if (vis.posts) {
      const postsBox = el('div', { class: 'profile-posts' }, el('p', { class: 'muted' }, 'Loading posts…'));
      sections.append(el('section', {}, [
        el('h3', { class: 'profile-subtitle' }, [icon('news'), ' Posts']),
        postsBox,
      ]));
      const expanded = new Set();
      const drafts = new Map();
      let lastDocs = [];
      const paint = () => {
        clear(postsBox);
        const list = lastDocs
          .filter((d) => d.data().hidden !== true)
          .sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
        if (!list.length) { postsBox.append(el('p', { class: 'muted' }, 'No posts to show.')); return; }
        for (const d of list) postsBox.append(postCard(d, currentUser, { expanded, drafts, paint, onOpenUser }));
      };
      unsub = onSnapshot(query(collection(db, 'posts'), where('authorId', '==', targetUid)), (snap) => { lastDocs = snap.docs; paint(); }, () => {
        clear(postsBox); postsBox.append(el('p', { class: 'error-text' }, 'Could not load posts.'));
      });
    } else {
      sections.append(el('p', { class: 'muted profile-private' }, 'This user keeps their posts private.'));
    }
  }).catch(() => { clear(head).append(el('p', { class: 'error-text' }, 'Could not load this profile.')); });

  return () => { if (unsub) unsub(); };
}
