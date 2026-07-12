// Rich feed composer: text plus Photo / Video / File / Link / Question / Note /
// Poll. Firebase Storage isn't enabled, so images and small files are stored
// inline as data URLs (size-capped to stay under Firestore's 1 MB doc limit) and
// video is embedded by URL (YouTube / Vimeo / direct .mp4).
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { el, clear, icon, toast } from '../ui/dom.js';
import { displayNameOf } from '../auth/auth.js';
import { notify } from '../workspaces/data.js';
import { attachMentionAutocomplete, extractMentions } from './feedMentions.js';

const MAX_INLINE = 850 * 1024; // inline-media budget per post (~850 KB)
const approxBytes = (dataURL) => Math.ceil((dataURL.length - dataURL.indexOf(',') - 1) * 0.75);

function compressImage(file, maxDim = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        let q = quality;
        let out = c.toDataURL('image/jpeg', q);
        while (approxBytes(out) > MAX_INLINE && q > 0.4) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = reject;
      img.src = r.result;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function readDataURL(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
}

const TABS = [
  { id: 'post', label: 'Post', icon: 'message-2', ph: "What's on your mind? Use @ to mention someone." },
  { id: 'photo', label: 'Photo', icon: 'photo', ph: 'Say something about your photo(s)…' },
  { id: 'video', label: 'Video', icon: 'video', ph: 'Say something about your video…' },
  { id: 'file', label: 'File', icon: 'paperclip', ph: 'Describe your file…' },
  { id: 'link', label: 'Link', icon: 'link', ph: 'Say something about this link…' },
  { id: 'question', label: 'Question', icon: 'help-circle', ph: 'Ask a question…' },
  { id: 'note', label: 'Note', icon: 'notes', ph: 'Write a note…' },
  { id: 'poll', label: 'Poll', icon: 'chart-bar', ph: 'Ask your poll question…' },
];

// Build the composer element. getMentionUsers() supplies the @mention list.
export function renderComposer(user, getMentionUsers) {
  const state = { mode: 'post', images: [], file: null };

  const text = el('textarea', { class: 'composer__text', rows: '3', placeholder: TABS[0].ph });
  attachMentionAutocomplete(text, getMentionUsers);

  // --- Photo panel ---
  const photoInput = el('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
  const photoGrid = el('div', { class: 'composer-thumbs' });
  const photoBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, [icon('photo'), ' Choose images']);
  photoBtn.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', async () => {
    for (const f of [...photoInput.files].slice(0, 4)) {
      if (state.images.length >= 4) { toast('Up to 4 images per post.', 'info'); break; }
      try {
        const dataURL = await compressImage(f);
        const total = state.images.reduce((n, u) => n + approxBytes(u), 0) + approxBytes(dataURL);
        if (total > MAX_INLINE) { toast('Images are too large to attach (no cloud storage). Try fewer/smaller images.', 'error'); break; }
        state.images.push(dataURL);
      } catch { toast('Could not read that image.', 'error'); }
    }
    photoInput.value = '';
    drawThumbs();
  });
  function drawThumbs() {
    clear(photoGrid);
    state.images.forEach((u, i) => {
      const rm = el('button', { class: 'composer-thumb-x', type: 'button', title: 'Remove' }, icon('x'));
      rm.addEventListener('click', () => { state.images.splice(i, 1); drawThumbs(); });
      photoGrid.append(el('div', { class: 'composer-thumb' }, [el('img', { src: u, alt: '' }), rm]));
    });
  }
  const photoPanel = el('div', { class: 'composer-extra', 'data-mode': 'photo' }, [photoBtn, photoInput, photoGrid]);

  // --- Video panel (embed URL) ---
  const videoUrl = el('input', { class: 'input', type: 'url', placeholder: 'YouTube, Vimeo or .mp4 URL' });
  const videoPanel = el('div', { class: 'composer-extra', 'data-mode': 'video' }, [videoUrl]);

  // --- File panel (small inline attachment) ---
  const fileInput = el('input', { type: 'file', style: 'display:none' });
  const fileLabel = el('span', { class: 'muted' }, 'No file chosen');
  const fileBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, [icon('paperclip'), ' Choose file']);
  fileBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    if (f.size > MAX_INLINE) { toast('File is too large to attach without cloud storage. Share it as a Link instead.', 'error'); fileInput.value = ''; return; }
    try { state.file = { name: f.name, size: f.size, mime: f.type || 'application/octet-stream', dataURL: await readDataURL(f) }; fileLabel.textContent = `${f.name} (${Math.round(f.size / 1024)} KB)`; }
    catch { toast('Could not read that file.', 'error'); }
  });
  const filePanel = el('div', { class: 'composer-extra', 'data-mode': 'file' }, [fileBtn, fileInput, fileLabel]);

  // --- Link panel ---
  const linkUrl = el('input', { class: 'input', type: 'url', placeholder: 'https://example.com' });
  const linkTitle = el('input', { class: 'input', type: 'text', placeholder: 'Link title (optional)' });
  const linkPanel = el('div', { class: 'composer-extra', 'data-mode': 'link' }, [linkUrl, linkTitle]);

  // --- Poll panel ---
  const pollOpts = el('div', { class: 'composer-poll-opts' });
  const addOpt = (val = '') => {
    if (pollOpts.children.length >= 6) return;
    const inp = el('input', { class: 'input', type: 'text', placeholder: `Option ${pollOpts.children.length + 1}`, value: val });
    pollOpts.append(inp);
  };
  addOpt(); addOpt();
  const addOptBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, [icon('plus'), ' Add option']);
  addOptBtn.addEventListener('click', () => addOpt());
  const pollPanel = el('div', { class: 'composer-extra', 'data-mode': 'poll' }, [pollOpts, addOptBtn]);

  const panels = [photoPanel, videoPanel, filePanel, linkPanel, pollPanel];

  // --- Tabs ---
  const tabBtns = new Map();
  const tabsRow = el('div', { class: 'composer__tabs' }, TABS.map((t) => {
    const b = el('button', { class: `composer__tab ${t.id === 'post' ? 'is-active' : ''}`, type: 'button' }, [icon(t.icon), el('span', {}, t.label)]);
    b.addEventListener('click', () => setMode(t.id));
    tabBtns.set(t.id, b);
    return b;
  }));
  function setMode(id) {
    state.mode = id;
    for (const [k, b] of tabBtns) b.classList.toggle('is-active', k === id);
    const tab = TABS.find((t) => t.id === id);
    text.placeholder = tab.ph;
    text.style.display = id === 'poll' ? 'none' : '';
    for (const p of panels) p.style.display = p.dataset.mode === id ? '' : 'none';
  }

  const postBtn = el('button', { class: 'btn btn--primary' }, [icon('send'), ' Share']);
  const composer = el('div', { class: 'composer card' }, [
    tabsRow, text, ...panels, el('div', { class: 'composer__actions' }, [postBtn]),
  ]);
  setMode('post');

  function reset() {
    text.value = ''; state.images = []; state.file = null;
    videoUrl.value = ''; linkUrl.value = ''; linkTitle.value = '';
    fileLabel.textContent = 'No file chosen';
    clear(pollOpts); addOpt(); addOpt();
    drawThumbs(); setMode('post');
  }

  postBtn.addEventListener('click', async () => {
    const mentionUsers = getMentionUsers() || [];
    const caption = text.value.trim();
    const base = {
      authorId: user.uid, authorName: displayNameOf(user),
      type: state.mode, text: caption, mentions: extractMentions(caption, mentionUsers),
      likes: [], comments: [], hidden: false, createdAt: serverTimestamp(),
    };
    const payload = { ...base };

    if (state.mode === 'photo') {
      if (!state.images.length) return toast('Add at least one image.', 'error');
      payload.images = state.images;
    } else if (state.mode === 'video') {
      const url = videoUrl.value.trim();
      if (!url) return toast('Paste a video URL.', 'error');
      payload.media = { kind: 'video', url };
    } else if (state.mode === 'file') {
      if (!state.file) return toast('Choose a file to attach.', 'error');
      payload.file = state.file;
    } else if (state.mode === 'link') {
      const url = linkUrl.value.trim();
      if (!url) return toast('Paste a link URL.', 'error');
      payload.link = { url, title: linkTitle.value.trim() };
    } else if (state.mode === 'poll') {
      const q = caption;
      if (!q) return toast('Enter a poll question.', 'error');
      const options = [...pollOpts.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
      if (options.length < 2) return toast('Add at least two poll options.', 'error');
      payload.poll = { options: options.map((t, i) => ({ id: `o${i}`, text: t })), multi: false };
      payload.pollVotes = [];
    } else if (!caption) {
      return toast('Write something first.', 'error');
    }

    postBtn.disabled = true;
    try {
      await addDoc(collection(db, 'posts'), payload);
      payload.mentions.filter((m) => m.uid && m.uid !== user.uid).forEach((m) => notify(m.uid, {
        type: 'mention', title: `${displayNameOf(user)} mentioned you in a post`,
        body: caption.slice(0, 80), actorId: user.uid, actorName: displayNameOf(user), link: { view: 'feed' },
      }));
      reset();
    } catch (err) {
      const big = String(err?.message || '').toLowerCase().includes('longer than');
      toast(big ? 'That post is too large — try smaller images/file.' : (err.message || 'Could not post.'), 'error');
    } finally { postBtn.disabled = false; }
  });

  return composer;
}
