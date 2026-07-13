// The global feed dashboard: every signed-in user can post, like, comment on,
// and see everyone's posts. Likes + comments are arrays on the post document,
// so a single query listener keeps counts and threads live.
//
// Each post has a 3-dot menu (top-right, above the time): Edit / Delete / Hide,
// all owner-only. "Hide" sets a `hidden` flag ON THE POST — a hidden post is
// visible only to its author; every other viewer's feed filters it out.
import {
  collection, query, orderBy, limit, onSnapshot,
  serverTimestamp, doc, deleteDoc, updateDoc, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { el, clear, escapeHtml, timeAgo, toast, icon, confirmModal } from '../ui/dom.js';
import { displayNameOf } from '../auth/auth.js';
import { isMaster } from '../workspaces/roles.js';
import { notify } from '../workspaces/data.js';
import { renderWidgetsPanel } from './widgets.js';
import { loadMentionUsers, renderBodyWithMentions, attachMentionAutocomplete, extractMentions } from './feedMentions.js';
import { renderComposer } from './composer.js';
import { renderPostExtras } from './postMedia.js';

export function renderFeed(root, user, opts = {}) {
  clear(root);
  const onOpenUser = opts.onOpenUser || null;

  // Rich composer (Post / Photo / Video / File / Link / Question / Note / Poll)
  // with @mention typeahead over all users.
  let mentionUsers = [];
  loadMentionUsers().then((u) => { mentionUsers = u; });
  const composer = renderComposer(user, () => mentionUsers);

  const list = el('div', { class: 'feed__list' }, el('p', { class: 'muted' }, 'Loading feed…'));

  const widgetsAside = el('aside', { class: 'feed-widgets' });
  root.append(
    el('div', { class: 'feed-layout' }, [
      el('div', { class: 'feed' }, [
        el('h2', { class: 'section__title' }, 'Feed'),
        composer,
        list,
      ]),
      widgetsAside,
    ]),
  );
  const widgetsCleanup = renderWidgetsPanel(widgetsAside, user);

  // UI state kept across the live re-renders so typing/expanding survives updates.
  const expanded = new Set();       // post ids with the comment thread open
  const drafts = new Map();         // post id -> in-progress comment text
  const cards = new Map();          // post id -> { el, sig } for in-place reconciliation

  // A signature of the fields that affect a card's rendering. If it's unchanged
  // between snapshots we keep the exact same DOM node — so opening a comment
  // thread, typing, and scroll position are NOT reset when other posts update.
  const postSig = (d) => {
    const p = d.data();
    return JSON.stringify([
      p.text || '', p.editedAt || 0, p.hidden === true, p.type || '',
      (p.likes || []).length, (p.likes || []).includes(user.uid),
      (p.comments || []).map((c) => `${c.id || ''}:${c.text || ''}`),
      (p.images || []).length, p.media?.url || '', p.link?.url || '',
      p.poll ? (p.pollVotes || []).length : 0,
    ]);
  };

  const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
  const unsub = onSnapshot(q, (snap) => {
    // A hidden post is visible only to its author. Everyone else filters it out.
    const visible = snap.docs.filter((d) => {
      const p = d.data();
      return p.hidden !== true || p.authorId === user.uid;
    });
    if (!visible.length) {
      clear(list); cards.clear();
      list.append(el('p', { class: 'muted' }, 'No posts yet. Be the first!'));
      return;
    }
    // Clear an empty-state / error placeholder the first time posts appear.
    if (!cards.size && list.firstChild) clear(list);
    const seen = new Set();
    let prev = null; // previous card element, used to keep newest-first order
    for (const d of visible) {
      seen.add(d.id);
      const sig = postSig(d);
      let entry = cards.get(d.id);
      if (!entry) {
        const elCard = postCard(d, user, { expanded, drafts, onOpenUser });
        entry = { el: elCard, sig }; cards.set(d.id, entry);
        if (prev) prev.after(elCard); else list.prepend(elCard);
      } else if (entry.sig !== sig) {
        // Only the changed post's card is rebuilt — the rest stay put.
        const elCard = postCard(d, user, { expanded, drafts, onOpenUser });
        entry.el.replaceWith(elCard); entry.el = elCard; entry.sig = sig;
      } else if (prev ? prev.nextSibling !== entry.el : list.firstChild !== entry.el) {
        // Unchanged content — just fix ordering if a newer post moved above it.
        if (prev) prev.after(entry.el); else list.prepend(entry.el);
      }
      prev = entry.el;
    }
    for (const [id, entry] of cards) { if (!seen.has(id)) { entry.el.remove(); cards.delete(id); } }
  }, (err) => {
    clear(list); cards.clear();
    list.append(el('p', { class: 'error-text' }, `Feed error: ${err.message}`));
  });

  return () => { unsub(); widgetsCleanup(); };
}

// Close any open post menu when clicking elsewhere.
function closeAllMenus() { document.querySelectorAll('.post__menu.open').forEach((m) => m.classList.remove('open')); }
document.addEventListener('click', (e) => { if (!e.target.closest('.post__menu-wrap')) closeAllMenus(); });

export function postCard(d, user, ui) {
  const p = d.data();
  const ref = doc(db, 'posts', d.id);
  const when = p.createdAt?.toDate ? timeAgo(p.createdAt.toDate()) : '';
  const mine = p.authorId === user.uid;
  const canModerate = isMaster(user); // master can moderate any post/comment
  const isHidden = p.hidden === true;
  const likes = Array.isArray(p.likes) ? p.likes : [];
  const comments = Array.isArray(p.comments) ? p.comments : [];
  const liked = likes.includes(user.uid);

  // Candidate users for @mentions in comments (cached list; empty until loaded).
  let cmtUsers = (ui.getMentionUsers && ui.getMentionUsers()) || [];
  if (!cmtUsers.length) loadMentionUsers().then((u) => { cmtUsers = u; });

  const openUser = ui.onOpenUser || null;
  const authorEl = (openUser && p.authorId)
    ? el('button', { class: 'post__author post__author--link', onclick: () => openUser(p.authorId) }, p.authorName || 'Someone')
    : el('span', { class: 'post__author' }, p.authorName || 'Someone');

  const body = el('div', { class: 'post__body', html: p.text ? renderBodyWithMentions(p.text, p.mentions) : '' });
  if (!p.text) body.style.display = 'none';
  // Clicking a highlighted @mention opens that user's profile.
  if (openUser) body.addEventListener('click', (e) => {
    const a = e.target.closest('.mention-link[data-uid]');
    if (a) { e.preventDefault(); openUser(a.dataset.uid); }
  });

  // Type badge (question/note) + type-specific content (images/video/file/link/poll).
  const typeBadge = p.type === 'question'
    ? el('div', { class: 'post-typebadge' }, [icon('help-circle'), ' Question'])
    : p.type === 'note' ? el('div', { class: 'post-typebadge' }, [icon('notes'), ' Note']) : null;
  const extras = renderPostExtras(p, ref, user);

  const startEdit = () => {
    const ta = el('textarea', { class: 'composer__text', rows: '3' });
    ta.value = p.text || '';
    const save = el('button', { class: 'btn btn--primary btn--sm' }, 'Save');
    const cancel = el('button', { class: 'btn btn--ghost btn--sm' }, 'Cancel');
    const editor = el('div', { class: 'post__editor' }, [ta, el('div', { class: 'composer__actions' }, [cancel, save])]);
    body.replaceWith(editor);
    ta.focus();
    const restore = () => editor.replaceWith(body);
    cancel.addEventListener('click', restore);
    save.addEventListener('click', async () => {
      const text = ta.value.trim();
      if (!text) { toast('Post cannot be empty.', 'error'); return; }
      if (text === p.text) { restore(); return; }
      save.disabled = true;
      try { await updateDoc(ref, { text, editedAt: serverTimestamp() }); }
      catch (err) { toast(err.message, 'error'); save.disabled = false; }
    });
  };

  // --- 3-dot options menu: Edit / Hide (author) + Delete. The master can
  // moderate ANY post (the Firestore rules already permit master deletes). ---
  const menu = el('div', { class: 'post__menu' });
  const menuItem = (iconName, label, danger, onClick) => {
    const b = el('button', { class: `post__menu-item ${danger ? 'is-danger' : ''}` }, [icon(iconName), label]);
    b.addEventListener('click', () => { closeAllMenus(); onClick(); });
    return b;
  };
  let menuWrap = null;
  if (mine || canModerate) {
    if (mine) {
      menu.append(menuItem('pencil', 'Edit', false, startEdit));
      menu.append(menuItem(isHidden ? 'eye' : 'eye-off', isHidden ? 'Unhide' : 'Hide', false, async () => {
        try {
          await updateDoc(ref, { hidden: !isHidden });
          toast(isHidden ? 'Post is visible to everyone again.' : 'Post hidden — only you can see it now.', 'info');
        } catch (err) { toast(err.message, 'error'); }
      }));
    }
    menu.append(menuItem('trash', mine ? 'Delete' : 'Delete post', true, async () => {
      const message = mine
        ? 'This permanently removes your post for everyone.'
        : `This permanently removes ${p.authorName || 'this user'}'s post for everyone.`;
      if (!(await confirmModal({ title: mine ? 'Delete post?' : 'Delete this post?', message, confirmLabel: 'Delete', danger: true }))) return;
      try { await deleteDoc(ref); if (!mine) toast('Post removed.', 'info'); }
      catch (err) { toast(err.message, 'error'); }
    }));
    const kebab = el('button', { class: 'post__kebab', title: canModerate && !mine ? 'Moderate' : 'Options', 'aria-label': 'Post options' }, icon('dots'));
    kebab.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = menu.classList.contains('open');
      closeAllMenus();
      if (!wasOpen) menu.classList.add('open');
    });
    menuWrap = el('div', { class: 'post__menu-wrap' }, [kebab, menu]);
  }

  // --- like + comment bar ---
  const likeBtn = el('button', { class: `post__bar-btn ${liked ? 'is-on' : ''}` }, [
    icon(liked ? 'heart-filled' : 'heart'), ` ${likes.length || ''} Like`,
  ]);
  likeBtn.addEventListener('click', async () => {
    try {
      await updateDoc(ref, { likes: liked ? arrayRemove(user.uid) : arrayUnion(user.uid) });
      // Notify the author when someone else likes their post (not on unlike/self).
      if (!liked && p.authorId && p.authorId !== user.uid) {
        notify(p.authorId, {
          type: 'like', title: `${displayNameOf(user)} liked your post`,
          body: (p.text || '').slice(0, 80), actorId: user.uid, actorName: displayNameOf(user),
          link: { view: 'feed' },
        });
      }
    } catch (err) { toast(err.message, 'error'); }
  });

  const commentBtn = el('button', { class: 'post__bar-btn' }, [
    icon('message-circle'), ` ${comments.length || ''} Comment`,
  ]);

  const thread = el('div', { class: 'post__comments' });
  // Clicking an @mention inside a comment opens that user's profile (delegated
  // once on the thread, which survives the per-render clear of its children).
  if (openUser) thread.addEventListener('click', (e) => {
    const a = e.target.closest('.mention-link[data-uid]');
    if (a) { e.preventDefault(); openUser(a.dataset.uid); }
  });
  const renderThread = () => {
    clear(thread);
    if (!ui.expanded.has(d.id)) { thread.style.display = 'none'; return; }
    thread.style.display = '';
    for (const c of comments) {
      const cMine = c.authorId === user.uid;
      thread.append(el('div', { class: 'comment' }, [
        el('div', { class: 'comment__main' }, [
          (openUser && c.authorId)
            ? el('button', { class: 'comment__author comment__author--link', onclick: () => openUser(c.authorId) }, c.authorName || 'Someone')
            : el('span', { class: 'comment__author' }, c.authorName || 'Someone'),
          el('span', { class: 'comment__text', html: renderBodyWithMentions(c.text || '', c.mentions) }),
        ]),
        (cMine || canModerate)
          ? el('button', {
              class: 'comment__del', title: cMine ? 'Delete comment' : 'Remove comment (moderate)',
              onclick: async () => {
                if (!cMine && !(await confirmModal({ title: 'Remove this comment?', message: `This permanently removes ${c.authorName || 'this user'}'s comment.`, confirmLabel: 'Remove', danger: true }))) return;
                try { await updateDoc(ref, { comments: arrayRemove(c) }); }
                catch (err) { toast(err.message, 'error'); }
              },
            }, icon('x'))
          : null,
      ]));
    }
    const input = el('input', { class: 'input input--sm', placeholder: 'Write a comment… (@ to mention)' });
    input.value = ui.drafts.get(d.id) || '';
    input.addEventListener('input', () => ui.drafts.set(d.id, input.value));
    attachMentionAutocomplete(input, () => cmtUsers);
    const send = el('button', { class: 'btn btn--primary btn--sm' }, icon('send'));
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        const users = cmtUsers.length ? cmtUsers : await loadMentionUsers();
        const mentions = extractMentions(text, users);
        await updateDoc(ref, {
          comments: arrayUnion({
            id: (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
            authorId: user.uid,
            authorName: displayNameOf(user),
            text,
            mentions,
            ts: new Date().toISOString(),
          }),
        });
        ui.drafts.delete(d.id);
        // Notify @mentioned users first, then the post author + thread (minus
        // anyone already notified via a mention, so nobody gets two pings).
        const mentioned = new Set(mentions.map((m) => m.uid).filter((uid) => uid && uid !== user.uid));
        mentioned.forEach((uid) => notify(uid, {
          type: 'mention',
          title: `${displayNameOf(user)} mentioned you in a comment`,
          body: text.slice(0, 80), actorId: user.uid, actorName: displayNameOf(user),
          link: { view: 'feed' },
        }));
        const recipients = new Set();
        if (p.authorId && p.authorId !== user.uid) recipients.add(p.authorId);
        for (const c of comments) { if (c.authorId && c.authorId !== user.uid) recipients.add(c.authorId); }
        mentioned.forEach((uid) => recipients.delete(uid));
        recipients.forEach((uid) => notify(uid, {
          type: 'comment',
          title: `${displayNameOf(user)} commented on ${uid === p.authorId ? 'your' : 'a'} post`,
          body: text.slice(0, 80), actorId: user.uid, actorName: displayNameOf(user),
          link: { view: 'feed' },
        }));
      } catch (err) { toast(err.message, 'error'); send.disabled = false; }
    };
    send.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    thread.append(el('form', { class: 'comment-add', onsubmit: (e) => { e.preventDefault(); submit(); } }, [input, send]));
  };
  commentBtn.addEventListener('click', () => {
    if (ui.expanded.has(d.id)) ui.expanded.delete(d.id); else ui.expanded.add(d.id);
    renderThread();
  });

  const card = el('div', { class: `post card ${isHidden ? 'is-hidden' : ''}` }, [
    el('div', { class: 'post__head' }, [
      authorEl,
      el('div', { class: 'post__head-right' }, [
        menuWrap,
        el('span', { class: 'post__time muted' }, `${when}${p.editedAt ? ' · edited' : ''}`),
      ]),
    ]),
    isHidden ? el('div', { class: 'post__hidden-tag' }, [icon('eye-off'), ' Hidden · only you can see this']) : null,
    typeBadge,
    body,
    extras,
    el('div', { class: 'post__bar' }, [likeBtn, commentBtn]),
    thread,
  ]);

  renderThread();
  return card;
}
