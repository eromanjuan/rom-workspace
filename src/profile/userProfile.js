// Public profile of another user: their name, @username, and their posts
// (fully interactive — like/comment). Hidden posts are not shown to visitors.
import { el, clear, icon } from '../ui/dom.js';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { getUserProfile } from '../workspaces/data.js';
import { postCard } from '../feed/feed.js';

const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

export function renderUserProfile(host, targetUid, currentUser, { onBack, onOpenUser }) {
  clear(host);

  const head = el('div', { class: 'profile-head card' }, el('p', { class: 'muted' }, 'Loading profile…'));
  const postsBox = el('div', { class: 'profile-posts' }, el('p', { class: 'muted' }, 'Loading posts…'));

  host.append(el('div', { class: 'profile' }, [
    el('button', { class: 'btn btn--ghost btn--sm search-back', onclick: onBack }, [icon('arrow-left'), ' Back']),
    el('h2', { class: 'section__title' }, 'Profile'),
    head,
    el('section', {}, [
      el('h3', { class: 'profile-subtitle' }, [icon('news'), ' Posts']),
      postsBox,
    ]),
  ]));

  getUserProfile(targetUid).then((p) => {
    const name = p?.displayName || 'User';
    const since = p?.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : null;
    clear(head).append(
      el('div', { class: 'profile-avatar' }, initials(name)),
      el('div', {}, [
        el('div', { class: 'profile-name' }, name),
        p?.username ? el('div', { class: 'muted profile-username' }, `@${p.username}`) : null,
        since ? el('div', { class: 'muted profile-since' }, `Member since ${since}`) : null,
      ]),
    );
  }).catch(() => { clear(head).append(el('p', { class: 'error-text' }, 'Could not load this profile.')); });

  const expanded = new Set();
  const drafts = new Map();
  let lastDocs = [];
  function paint() {
    clear(postsBox);
    const vis = lastDocs
      .filter((d) => d.data().hidden !== true)
      .sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
    if (!vis.length) { postsBox.append(el('p', { class: 'muted' }, 'No posts to show.')); return; }
    for (const d of vis) postsBox.append(postCard(d, currentUser, { expanded, drafts, paint, onOpenUser }));
  }
  const unsub = onSnapshot(query(collection(db, 'posts'), where('authorId', '==', targetUid)), (snap) => { lastDocs = snap.docs; paint(); }, () => {
    clear(postsBox); postsBox.append(el('p', { class: 'error-text' }, 'Could not load posts.'));
  });

  return () => { if (unsub) unsub(); };
}
