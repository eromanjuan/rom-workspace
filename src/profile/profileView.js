// The Profile page: user/owner details, previous posts, and personal widgets.
import { el, clear, icon, toast, openModal } from '../ui/dom.js';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import { displayNameOf } from '../auth/auth.js';
import { isMaster, roleLabel } from '../workspaces/roles.js';
import { getUserProfile, listMyWorkspaces, setCurrentWorkspace, updateUserProfile } from '../workspaces/data.js';
import { postCard } from '../feed/feed.js';
import { renderWidgetsPanel } from '../feed/widgets.js';
import { avatarNode, applyAvatar, initials, openAvatarEditor, pickAndEditAvatar, removeAvatar, commitAvatar } from './avatar.js';
import { profileLinksNode } from './links.js';
import { bioNode } from './bio.js';
import { AVATAR_FRAMES, cleanFrame, applyFrame, DEFAULT_THICKNESS, DEFAULT_CUSTOM } from './frames.js';
import { viewerIsPro, proGate, FREE_FRAMES } from '../monetize.js';

// Returns an unsubscribe function (for the live widgets listener).
export function renderProfile(host, user, { onOpenWorkspace, onOpenUser, onViewAsVisitor } = {}) {
  clear(host);
  const name = displayNameOf(user);

  // --- details (avatar: click to view; edit/upload/remove/frame live in the modal) ---
  let currentPhoto = null;   // latest saved photoURL (null = default initials)
  let currentFrame = '';     // decorative frame: preset id | 'custom' | ''
  let currentThickness = DEFAULT_THICKNESS;
  let currentCustom = { ...DEFAULT_CUSTOM };
  const avatar = avatarNode(name, null, 'profile-avatar profile-avatar--lg is-clickable');
  avatar.setAttribute('title', 'View photo');
  avatar.setAttribute('role', 'button');
  const setPhoto = (url) => { currentPhoto = url || null; applyAvatar(avatar, name, currentPhoto); };
  avatar.addEventListener('click', openAvatarViewer);
  // Hover hint sits over the avatar (a sibling, so applyAvatar's clear() can't wipe it).
  const avatarWrap = el('div', { class: 'profile-avatar-wrap' }, [avatar, el('div', { class: 'avatar-hint' }, icon('eye'))]);
  const paintFrame = () => applyFrame(avatarWrap, { frame: currentFrame, custom: currentCustom, thickness: currentThickness });
  const saveFrame = () => updateUserProfile(user.uid, { avatarFrame: currentFrame, avatarFrameThickness: currentThickness, avatarFrameCustom: currentCustom }).catch((e) => toast(e.message || 'Could not save frame.', 'error'));

  // Full-size photo viewer. Since this is the user's own profile, it also carries
  // the edit / upload / remove actions and the frame picker (owner-only).
  function openAvatarViewer() {
    const { body, close } = openModal({ title: 'Profile photo', iconName: 'user' });
    const view = el('div', { class: `avatar-view ${currentPhoto ? 'has-photo' : ''}` },
      currentPhoto ? el('img', { src: currentPhoto, alt: name }) : initials(name));
    // Preview the frame live on both the big avatar and the profile avatar.
    const repaint = () => { applyFrame(view, { frame: currentFrame, custom: currentCustom, thickness: currentThickness }); paintFrame(); };
    repaint();

    const uploadBtn = el('button', { class: 'btn btn--primary' }, [icon('camera'), ' Upload new photo']);
    uploadBtn.addEventListener('click', () => { close(); pickAndEditAvatar(user, setPhoto); });

    const editBtn = currentPhoto ? el('button', { class: 'btn btn--ghost' }, [icon('crop'), ' Edit photo']) : null;
    if (editBtn) editBtn.addEventListener('click', () => { close(); openAvatarEditor(currentPhoto, { onSave: (d) => commitAvatar(user, d, setPhoto) }); });

    const removeBtn = currentPhoto ? el('button', { class: 'btn btn--danger' }, [icon('trash'), ' Remove photo']) : null;
    if (removeBtn) removeBtn.addEventListener('click', () => { close(); removeAvatar(user, () => setPhoto('')); });

    // --- custom frame controls (solid / gradient + colors + angle) ---
    const modeSel = el('select', { class: 'input avatar-cf-mode' }, [
      el('option', { value: 'gradient' }, 'Gradient'),
      el('option', { value: 'solid' }, 'Solid color'),
    ]);
    modeSel.value = currentCustom.mode || 'gradient';
    const c1 = el('input', { type: 'color', class: 'avatar-cf-color', value: currentCustom.c1 || DEFAULT_CUSTOM.c1 });
    const c2 = el('input', { type: 'color', class: 'avatar-cf-color', value: currentCustom.c2 || DEFAULT_CUSTOM.c2 });
    const angle = el('input', { type: 'range', class: 'avatar-cf-angle', min: '0', max: '360', step: '5', value: String(currentCustom.angle ?? 135) });
    const c2Field = el('label', { class: 'avatar-cf-field' }, [el('span', {}, 'Color 2'), c2]);
    const angleField = el('label', { class: 'avatar-cf-field' }, [el('span', {}, 'Angle'), angle]);
    const customBox = el('div', { class: 'avatar-cf', style: 'display:none' }, [
      el('label', { class: 'avatar-cf-field' }, [el('span', {}, 'Style'), modeSel]),
      el('label', { class: 'avatar-cf-field' }, [el('span', {}, 'Color 1'), c1]),
      c2Field, angleField,
    ]);
    const syncCustomInputs = () => {
      const grad = (currentCustom.mode || 'gradient') === 'gradient';
      c2Field.style.display = grad ? '' : 'none';
      angleField.style.display = grad ? '' : 'none';
    };
    const readCustom = () => { currentCustom = { mode: modeSel.value, c1: c1.value, c2: c2.value, angle: Number(angle.value) }; };
    const onCustomInput = () => { readCustom(); syncCustomInputs(); if (currentFrame !== 'custom') selectFrame('custom'); else repaint(); };
    modeSel.addEventListener('input', onCustomInput);
    [c1, c2, angle].forEach((inp) => inp.addEventListener('input', onCustomInput));
    [modeSel, c1, c2, angle].forEach((inp) => inp.addEventListener('change', saveFrame));

    // --- swatches (presets + a Custom swatch) ---
    // Free plan: only "None" and the default "Blue" frame. Everything else
    // (other presets, custom color/gradient/thickness) is ROMIO Pro.
    const pro = viewerIsPro();
    const isFreeFrame = (id) => FREE_FRAMES.includes(cleanFrame(id));
    let swatches = [];
    const selectFrame = (id) => {
      const cleaned = cleanFrame(id);
      if (!pro && !isFreeFrame(cleaned)) { proGate('Custom avatar frames'); return; }
      currentFrame = cleaned;
      customBox.style.display = currentFrame === 'custom' ? '' : 'none';
      if (currentFrame === 'custom') { readCustom(); syncCustomInputs(); }
      for (const sw of swatches) sw.classList.toggle('is-active', sw.dataset.fid === (currentFrame || ''));
      repaint();
      saveFrame();
    };
    const makeSwatch = (id, label, isCustom) => {
      const locked = !pro && (isCustom || !isFreeFrame(id));
      const sw = el('button', { class: `avatar-frame-swatch ${id === currentFrame ? 'is-active' : ''} ${locked ? 'is-locked' : ''}`, type: 'button', title: locked ? `${label} — ROMIO Pro` : label, ...(id && !isCustom ? { 'data-frame': id } : {}) }, [
        isCustom ? icon('palette') : (id ? null : el('span', { class: 'avatar-frame-none' }, icon('ban'))),
        locked ? el('span', { class: 'avatar-frame-lock' }, icon('lock')) : null,
      ]);
      sw.dataset.fid = id;
      sw.addEventListener('click', () => { if (locked) { proGate('Custom avatar frames'); return; } selectFrame(id); });
      return sw;
    };
    swatches = [...AVATAR_FRAMES.map((f) => makeSwatch(f.id, f.label, false)), makeSwatch('custom', 'Custom', true)];

    // Thickness applies to whatever frame is active.
    const thick = el('input', { type: 'range', class: 'avatar-cf-thick', min: '0', max: '16', step: '1', value: String(currentThickness) });
    thick.addEventListener('input', () => { currentThickness = Number(thick.value); repaint(); });
    thick.addEventListener('change', saveFrame);

    body.append(
      view,
      el('div', { class: 'avatar-view-actions' }, [uploadBtn, editBtn, removeBtn]),
      el('div', { class: 'avatar-frame-picker' }, [
        el('div', { class: 'avatar-frame-title muted' }, 'Frame'),
        el('div', { class: 'avatar-frame-grid' }, swatches),
        // Custom controls + thickness are Pro-only; Free shows an upgrade hint.
        ...(pro ? [customBox, el('label', { class: 'avatar-cf-field avatar-cf-thickrow' }, [el('span', {}, 'Thickness'), thick])]
          : [el('button', { class: 'avatar-frame-upsell', type: 'button', onclick: () => proGate('Custom avatar frames') }, [icon('crown'), ' Unlock custom color, gradient & thickness with Pro'])]),
      ]),
    );
    syncCustomInputs();
    if (pro && currentFrame === 'custom') customBox.style.display = '';
  }

  const bioSlot = el('div', { class: 'profile-bio-slot' });
  const linksEl = el('div', { class: 'profile-links' });
  const details = el('div', { class: 'profile-head profile-head--visit card' }, [
    avatarWrap,
    // .profile-head-main matters: it carries min-width:0 so this column can
    // shrink. Without it a long email can't wrap and shoves the badges
    // off-screen on a phone.
    el('div', { class: 'profile-head-main' }, [
      el('div', { class: 'profile-name' }, name),
      el('div', { class: 'muted profile-username', id: 'profile-username' }, ''),
      el('div', { class: 'muted' }, user.email),
      el('div', { class: 'profile-badges' }, [
        el('span', { class: `pill ${isMaster(user) ? 'pill--owner' : 'pill--viewer'}` },
          isMaster(user) ? 'Master · full access' : 'Member'),
        viewerIsPro() ? el('span', { class: 'pill pill--pro' }, [icon('crown'), ' Pro']) : null,
        user.emailVerified ? el('span', { class: 'pill pill--editor' }, [icon('circle-check'), ' Verified']) : null,
      ]),
      bioSlot,
      linksEl,
      el('div', { class: 'muted profile-since', id: 'profile-since' }, ''),
    ]),
  ]);

  // --- previous posts ---
  const posts = el('div', { class: 'profile-posts' }, el('p', { class: 'muted' }, 'Loading your posts…'));

  // --- widgets (same personal panel as the Feed) ---
  const widgetHost = el('aside', { class: 'feed-widgets' });

  const workspacesBox = el('div', { class: 'profile-ws-lists' }, el('p', { class: 'muted' }, 'Loading workspaces…'));

  // "View as" lets the owner preview their public profile the way visitors see it.
  const viewAsBtn = el('button', { class: 'btn btn--ghost btn--sm profile-viewas' }, [icon('eye'), ' View as']);
  if (onViewAsVisitor) viewAsBtn.addEventListener('click', () => onViewAsVisitor());

  host.append(
    el('div', { class: 'profile' }, [
      el('div', { class: 'profile-topbar' }, [
        onViewAsVisitor ? viewAsBtn : null,
      ]),
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
    if (p?.photoURL) setPhoto(p.photoURL);
    currentFrame = cleanFrame(p?.avatarFrame);
    currentThickness = Number.isFinite(Number(p?.avatarFrameThickness)) ? Number(p.avatarFrameThickness) : DEFAULT_THICKNESS;
    currentCustom = { ...DEFAULT_CUSTOM, ...(p?.avatarFrameCustom || {}) };
    paintFrame();
    clear(bioSlot);
    if (p?.bio) bioSlot.append(bioNode(p.bio));
    clear(linksEl);
    const linksNode = profileLinksNode(p);
    if (linksNode) linksEl.append(...linksNode.childNodes);
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
