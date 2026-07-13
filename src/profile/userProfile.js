// Public profile of another user: identity plus whatever they've chosen to make
// visible (posts, member-since, verified badge, email, owned workspaces). The
// visibility flags live on users/{uid}.visibility; hidden sections are omitted.
import { el, clear, icon, toast } from '../ui/dom.js';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../firebase.js';
import { getUserProfile, listMyWorkspaces, setCurrentWorkspace, requestToJoin, getMyJoinRequest, cancelJoinRequest } from '../workspaces/data.js';
import { roleLabel } from '../workspaces/roles.js';
import { postCard } from '../feed/feed.js';
import { avatarNode } from './avatar.js';

const VISIBILITY_DEFAULTS = { posts: true, ownedWorkspaces: true, memberSince: true, verified: true, email: false };

export function renderUserProfile(host, targetUid, currentUser, { onBack, onOpenUser, onMessage, onOpenWorkspace }) {
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

    const notSelf = targetUid && currentUser && targetUid !== currentUser.uid;
    const msgBtn = (notSelf && onMessage)
      ? el('button', { class: 'btn btn--primary btn--sm profile-msg-btn', onclick: () => onMessage(targetUid, name) }, [icon('message'), ' Message'])
      : null;
    clear(head).append(
      avatarNode(name, p?.photoURL, 'profile-avatar'),
      el('div', { class: 'profile-head-main' }, [
        el('div', { class: 'profile-name' }, name),
        p?.username ? el('div', { class: 'muted profile-username' }, `@${p.username}`) : null,
        vis.email && p?.email ? el('div', { class: 'muted profile-email' }, p.email) : null,
        vis.verified && p?.emailVerified ? el('span', { class: 'pill pill--editor profile-verified' }, [icon('circle-check'), ' Verified']) : null,
        p?.bio ? el('p', { class: 'profile-bio' }, p.bio) : null,
        (p?.website && /^https?:\/\//i.test(p.website))
          ? el('a', { class: 'profile-website', href: p.website, target: '_blank', rel: 'noopener noreferrer' }, [icon('link'), el('span', {}, p.website.replace(/^https?:\/\//, ''))])
          : null,
        vis.memberSince && since ? el('div', { class: 'muted profile-since' }, `Member since ${since}`) : null,
        msgBtn,
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
      // Load the viewer's own memberships so we know which of this user's
      // workspaces they can open vs. need to request access to.
      Promise.all([
        getDocs(query(collection(db, 'workspaces'), where('ownerId', '==', targetUid))),
        listMyWorkspaces(currentUser.uid).catch(() => []),
      ]).then(([snap, myWs]) => {
        clear(wsBox);
        if (snap.empty) { wsBox.append(el('p', { class: 'muted' }, 'No public workspaces.')); return; }
        const myRoleFor = new Map((myWs || []).map((w) => [w.id, w.myRole]));
        snap.docs.forEach((d) => {
          const w = d.data();
          const wsId = d.id;
          const action = el('div', { class: 'profile-ws-action' });
          wsBox.append(el('div', { class: 'profile-ws-item card' }, [
            el('div', { class: 'profile-ws-ic', style: `background:${w.color || '#5b8cff'}` }, icon(w.icon || 'layout-dashboard')),
            el('div', { class: 'profile-ws-item-main' }, [el('div', { class: 'profile-ws-name' }, w.name || 'Workspace'), w.description ? el('div', { class: 'muted' }, w.description) : null]),
            action,
          ]));

          const myRole = myRoleFor.get(wsId);
          if (myRole) {
            // Already a member — open it directly.
            const open = el('button', { class: 'btn btn--ghost btn--sm', title: `Open ${w.name || 'workspace'}` }, [icon('arrow-up-right'), ' Open']);
            open.addEventListener('click', async () => {
              open.disabled = true;
              try { await setCurrentWorkspace(currentUser.uid, wsId); (onOpenWorkspace || (() => {}))(); }
              catch (e) { toast(e.message, 'error'); open.disabled = false; }
            });
            action.append(el('span', { class: 'pill pill--editor' }, roleLabel(myRole)), open);
          } else {
            // Not a member — let them request access.
            const joinBtn = el('button', { class: 'btn btn--primary btn--sm' }, [icon('user-plus'), ' Request access']);
            const setRequested = () => clear(action).append(
              el('span', { class: 'pill pill--viewer' }, 'Requested'),
              el('button', { class: 'link-danger', title: 'Cancel request', onclick: async () => { try { await cancelJoinRequest(wsId, currentUser.uid); clear(action).append(joinBtn); } catch (e) { toast(e.message, 'error'); } } }, icon('x')),
            );
            joinBtn.addEventListener('click', async () => {
              joinBtn.disabled = true;
              try { await requestToJoin(wsId, currentUser); setRequested(); toast('Access request sent to the owner.', 'success'); }
              catch (e) { toast(e.message, 'error'); joinBtn.disabled = false; }
            });
            action.append(joinBtn);
            getMyJoinRequest(wsId, currentUser.uid).then((r) => { if (r) setRequested(); }).catch(() => {});
          }
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
