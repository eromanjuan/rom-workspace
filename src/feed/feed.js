// The global feed dashboard: every signed-in user can post, like, comment on,
// and see everyone's posts. Likes + comments are arrays on the post document,
// so a single query listener keeps counts and threads live.
//
// Each post has a 3-dot menu (top-right, above the time): Edit / Delete / Hide,
// all owner-only. "Hide" sets a `hidden` flag ON THE POST — a hidden post is
// visible only to its author; every other viewer's feed filters it out.
import {
  collection, addDoc, query, orderBy, limit, onSnapshot,
  serverTimestamp, doc, deleteDoc, updateDoc, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase.js';
import { el, clear, escapeHtml, timeAgo, toast, icon } from '../ui/dom.js';
import { displayNameOf } from '../auth/auth.js';

export function renderFeed(root, user) {
  clear(root);

  const composerText = el('textarea', {
    class: 'composer__text', rows: '3',
    placeholder: `What's on your mind, ${displayNameOf(user)}?`,
  });

  const postBtn = el('button', { class: 'btn btn--primary' }, 'Post');
  const composer = el('div', { class: 'composer card' }, [
    composerText,
    el('div', { class: 'composer__actions' }, [postBtn]),
  ]);

  postBtn.addEventListener('click', async () => {
    const text = composerText.value.trim();
    if (!text) return;
    postBtn.disabled = true;
    try {
      await addDoc(collection(db, 'posts'), {
        authorId: user.uid,
        authorName: displayNameOf(user),
        text,
        likes: [],
        comments: [],
        hidden: false,
        createdAt: serverTimestamp(),
      });
      composerText.value = '';
    } catch (err) {
      toast(err.message || 'Could not post.', 'error');
    } finally {
      postBtn.disabled = false;
    }
  });

  const list = el('div', { class: 'feed__list' }, el('p', { class: 'muted' }, 'Loading feed…'));

  root.append(
    el('div', { class: 'feed' }, [
      el('h2', { class: 'section__title' }, 'Feed'),
      composer,
      list,
    ]),
  );

  // UI state kept across the live re-renders so typing/expanding survives updates.
  const expanded = new Set();       // post ids with the comment thread open
  const drafts = new Map();         // post id -> in-progress comment text

  const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
  const unsub = onSnapshot(q, (snap) => {
    clear(list);
    // A hidden post is visible only to its author. Everyone else filters it out.
    const visible = snap.docs.filter((d) => {
      const p = d.data();
      return p.hidden !== true || p.authorId === user.uid;
    });
    if (!visible.length) {
      list.append(el('p', { class: 'muted' }, 'No posts yet. Be the first!'));
      return;
    }
    for (const d of visible) list.append(postCard(d, user, { expanded, drafts }));
  }, (err) => {
    clear(list);
    list.append(el('p', { class: 'error-text' }, `Feed error: ${err.message}`));
  });

  return unsub;
}

// Close any open post menu when clicking elsewhere.
function closeAllMenus() { document.querySelectorAll('.post__menu.open').forEach((m) => m.classList.remove('open')); }
document.addEventListener('click', (e) => { if (!e.target.closest('.post__menu-wrap')) closeAllMenus(); });

function postCard(d, user, ui) {
  const p = d.data();
  const ref = doc(db, 'posts', d.id);
  const when = p.createdAt?.toDate ? timeAgo(p.createdAt.toDate()) : '';
  const mine = p.authorId === user.uid;
  const isHidden = p.hidden === true;
  const likes = Array.isArray(p.likes) ? p.likes : [];
  const comments = Array.isArray(p.comments) ? p.comments : [];
  const liked = likes.includes(user.uid);

  const body = el('div', { class: 'post__body', html: escapeHtml(p.text).replace(/\n/g, '<br>') });

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

  // --- 3-dot options menu (owner-only): Edit / Delete / Hide-Unhide ---
  const menu = el('div', { class: 'post__menu' });
  const menuItem = (iconName, label, danger, onClick) => {
    const b = el('button', { class: `post__menu-item ${danger ? 'is-danger' : ''}` }, [icon(iconName), label]);
    b.addEventListener('click', () => { closeAllMenus(); onClick(); });
    return b;
  };
  let menuWrap = null;
  if (mine) {
    menu.append(menuItem('pencil', 'Edit', false, startEdit));
    menu.append(menuItem(isHidden ? 'eye' : 'eye-off', isHidden ? 'Unhide' : 'Hide', false, async () => {
      try {
        await updateDoc(ref, { hidden: !isHidden });
        toast(isHidden ? 'Post is visible to everyone again.' : 'Post hidden — only you can see it now.', 'info');
      } catch (err) { toast(err.message, 'error'); }
    }));
    menu.append(menuItem('trash', 'Delete', true, async () => {
      if (!confirm('Delete this post?')) return;
      try { await deleteDoc(ref); } catch (err) { toast(err.message, 'error'); }
    }));
    const kebab = el('button', { class: 'post__kebab', title: 'Options', 'aria-label': 'Post options' }, icon('dots'));
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
    try { await updateDoc(ref, { likes: liked ? arrayRemove(user.uid) : arrayUnion(user.uid) }); }
    catch (err) { toast(err.message, 'error'); }
  });

  const commentBtn = el('button', { class: 'post__bar-btn' }, [
    icon('message-circle'), ` ${comments.length || ''} Comment`,
  ]);

  const thread = el('div', { class: 'post__comments' });
  const renderThread = () => {
    clear(thread);
    if (!ui.expanded.has(d.id)) { thread.style.display = 'none'; return; }
    thread.style.display = '';
    for (const c of comments) {
      const cMine = c.authorId === user.uid;
      thread.append(el('div', { class: 'comment' }, [
        el('div', { class: 'comment__main' }, [
          el('span', { class: 'comment__author' }, c.authorName || 'Someone'),
          el('span', { class: 'comment__text' }, c.text || ''),
        ]),
        cMine
          ? el('button', {
              class: 'comment__del', title: 'Delete comment',
              onclick: async () => {
                try { await updateDoc(ref, { comments: arrayRemove(c) }); }
                catch (err) { toast(err.message, 'error'); }
              },
            }, icon('x'))
          : null,
      ]));
    }
    const input = el('input', { class: 'input input--sm', placeholder: 'Write a comment…' });
    input.value = ui.drafts.get(d.id) || '';
    input.addEventListener('input', () => ui.drafts.set(d.id, input.value));
    const send = el('button', { class: 'btn btn--primary btn--sm' }, icon('send'));
    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        await updateDoc(ref, {
          comments: arrayUnion({
            id: (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now())),
            authorId: user.uid,
            authorName: displayNameOf(user),
            text,
            ts: new Date().toISOString(),
          }),
        });
        ui.drafts.delete(d.id);
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
      el('span', { class: 'post__author' }, p.authorName || 'Someone'),
      el('div', { class: 'post__head-right' }, [
        menuWrap,
        el('span', { class: 'post__time muted' }, `${when}${p.editedAt ? ' · edited' : ''}`),
      ]),
    ]),
    isHidden ? el('div', { class: 'post__hidden-tag' }, [icon('eye-off'), ' Hidden · only you can see this']) : null,
    body,
    el('div', { class: 'post__bar' }, [likeBtn, commentBtn]),
    thread,
  ]);

  renderThread();
  return card;
}
