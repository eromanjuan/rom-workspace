// Public profile of another user: identity plus whatever they've chosen to make
// visible (posts, member-since, verified badge, email, owned workspaces). The
// visibility flags live on users/{uid}.visibility; hidden sections are omitted.
import { el, clear, icon, toast } from '../ui/dom.js';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../firebase.js';
import { getUserProfile, listMyWorkspaces, setCurrentWorkspace, requestToJoin, getMyJoinRequest, cancelJoinRequest, listenUser } from '../workspaces/data.js';
import { roleLabel, isMaster } from '../workspaces/roles.js';
import { postCard } from '../feed/feed.js';
import { avatarNode } from './avatar.js';
import { profileLinksNode } from './links.js';
import { bioNode } from './bio.js';
import { applyFrame } from './frames.js';
import { isOnline, presenceText, presenceExact } from '../auth/presence.js';
import { getThemeBundle, previewThemeBundle } from '../ui/theme.js';

// Defaults must match settingsView.js VISIBILITY_DEFAULTS. A field missing from a
// user's saved visibility falls back here, so bio/links default to shown.
const VISIBILITY_DEFAULTS = { bio: true, links: true, posts: true, ownedWorkspaces: true, memberSince: true, verified: true, email: false, phone: false };

export function renderUserProfile(host, targetUid, currentUser, { onBack, onOpenUser, onMessage, onOpenWorkspace }) {
  clear(host);

  const isSelf = targetUid && currentUser && targetUid === currentUser.uid;
  const head = el('div', { class: 'profile-head profile-head--visit card' }, el('p', { class: 'muted' }, 'Loading profile…'));
  const sections = el('div', { class: 'profile-sections' });

  // When previewing your own profile, show a clear banner + an exit action.
  const previewBanner = isSelf ? el('div', { class: 'profile-preview-banner' }, [
    el('span', { class: 'profile-preview-tag' }, [icon('eye'), ' Visitor preview']),
    el('span', { class: 'muted' }, "This is how your profile looks to others."),
    el('button', { class: 'btn btn--primary btn--sm', onclick: onBack }, [icon('arrow-left'), ' Back to my profile']),
  ]) : null;

  host.append(el('div', { class: 'profile' }, [
    previewBanner,
    isSelf ? null : el('button', { class: 'btn btn--ghost btn--sm search-back', onclick: onBack }, [icon('arrow-left'), ' Back']),
    isSelf ? null : el('h2', { class: 'section__title' }, 'Profile'),
    head,
    sections,
  ]));

  let unsub = null;
  let presenceUnsub = null;
  let presenceTick = null;
  // Remember the visitor's own theme so we can restore it when leaving; while on
  // this page we preview the profile owner's theme (if they've set one).
  const ownThemeBundle = getThemeBundle();
  let themedToOther = false;

  getUserProfile(targetUid).then((p) => {
    if (p?.theme) { previewThemeBundle(p.theme); themedToOther = true; }
    const vis = { ...VISIBILITY_DEFAULTS, ...(p?.visibility || {}) };
    const name = p?.displayName || 'User';
    const since = p?.createdAt?.toDate ? p.createdAt.toDate().toLocaleDateString() : null;

    const notSelf = targetUid && currentUser && targetUid !== currentUser.uid;
    // Live online/offline + last-active line (only when viewing someone else).
    const presenceEl = notSelf ? el('div', { class: 'profile-presence muted' }) : null;
    let lastProf = p;
    const paintPresence = () => {
      if (!presenceEl) return;
      const online = isOnline(lastProf);
      clear(presenceEl);
      presenceEl.classList.toggle('is-online', online);
      presenceEl.title = presenceExact(lastProf);
      presenceEl.append(el('span', { class: `msg-presence-dot ${online ? 'is-online' : ''}` }), presenceText(lastProf));
    };
    if (presenceEl) {
      paintPresence();
      presenceUnsub = listenUser(targetUid, (prof) => { if (prof) { lastProf = prof; paintPresence(); } });
      // Re-evaluate on a timer so "online" ages into "Last seen…" without a write.
      presenceTick = setInterval(paintPresence, 30000);
    }
    const msgBtn = (notSelf && onMessage)
      ? el('button', { class: 'btn btn--primary btn--sm profile-msg-btn', onclick: () => onMessage(targetUid, name) }, [icon('message'), ' Message'])
      : null;
    const avWrap = el('div', { class: 'profile-avatar-wrap' }, avatarNode(name, p?.photoURL, 'profile-avatar profile-avatar--lg'));
    applyFrame(avWrap, { frame: p?.avatarFrame, custom: p?.avatarFrameCustom, thickness: p?.avatarFrameThickness });
    clear(head).append(
      avWrap,
      el('div', { class: 'profile-head-main' }, [
        el('div', { class: 'profile-name' }, name),
        p?.username ? el('div', { class: 'muted profile-username' }, `@${p.username}`) : null,
        presenceEl,
        vis.email && p?.email ? el('div', { class: 'muted profile-email' }, p.email) : null,
        vis.phone && p?.phone ? el('div', { class: 'muted profile-phone' }, [icon('phone'), el('span', {}, p.phone)]) : null,
        vis.verified && p?.emailVerified ? el('span', { class: 'pill pill--editor profile-verified' }, [icon('circle-check'), ' Verified']) : null,
        vis.bio && p?.bio ? bioNode(p.bio) : null,
        vis.links ? profileLinksNode(p) : null,
        vis.memberSince && since ? el('div', { class: 'muted profile-since' }, `Member since ${since}`) : null,
        msgBtn,
      ]),
    );

    clear(sections);

    // Owned workspaces (workspace docs are readable; memberships are private).
    if (vis.ownedWorkspaces) {
      const wsBox = el('div', { class: 'profile-ws-grid' }, el('p', { class: 'muted' }, 'Loading…'));
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
        // Small workspace icon (image or coloured glyph) — matches My Profile.
        const wsAvatar = (w) => w.imageUrl
          ? el('div', { class: 'ws-avatar ws-avatar--img' }, el('img', { src: w.imageUrl, alt: w.name || '' }))
          : el('div', { class: 'ws-avatar', style: `background:${w.color || '#5b8cff'}` }, icon(w.icon || 'layout-dashboard'));
        snap.docs.forEach((d) => {
          const w = d.data();
          const wsId = d.id;
          const myRole = myRoleFor.get(wsId);
          // Members (and the master) open directly — a clickable compact tile.
          if (myRole || isMaster(currentUser)) {
            const card = el('button', { class: 'profile-ws-card card profile-ws-card--btn', title: `Open ${w.name || 'workspace'}` }, [
              wsAvatar(w),
              el('div', { class: 'profile-ws-meta' }, [
                el('div', { class: 'profile-ws-name' }, w.name || 'Workspace'),
                el('div', { class: 'muted' }, myRole ? roleLabel(myRole) : 'Master'),
              ]),
              el('span', { class: 'profile-ws-open muted' }, icon('arrow-up-right')),
            ]);
            card.addEventListener('click', async () => {
              card.disabled = true;
              try { await setCurrentWorkspace(currentUser.uid, wsId); (onOpenWorkspace || (() => {}))(); }
              catch (e) { toast(e.message, 'error'); card.disabled = false; }
            });
            wsBox.append(card);
          } else {
            // Not a member — a compact tile with a Request-access action.
            const action = el('div', { class: 'profile-ws-req' });
            const joinBtn = el('button', { class: 'btn btn--primary btn--sm', type: 'button' }, [icon('user-plus'), ' Request access']);
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
            wsBox.append(el('div', { class: 'profile-ws-card card' }, [
              wsAvatar(w),
              el('div', { class: 'profile-ws-meta' }, [
                el('div', { class: 'profile-ws-name' }, w.name || 'Workspace'),
                action,
              ]),
            ]));
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

  return () => {
    if (unsub) unsub();
    if (presenceUnsub) presenceUnsub();
    if (presenceTick) clearInterval(presenceTick);
    // Restore the visitor's own theme on the way out.
    if (themedToOther) previewThemeBundle(ownThemeBundle);
  };
}
