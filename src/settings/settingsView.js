// The Settings page: change password, switch theme, and manage workspaces
// (add / open / set-as-current / delete).
import { el, clear, icon, toast, openModal } from '../ui/dom.js';
import { changePassword, changeName, changeEmailAddress, sendPasswordReset, displayNameOf, verifyPassword } from '../auth/auth.js';
import { checkPassword } from '../auth/passwordPolicy.js';
import { getTheme, applyTheme, PALETTE_VARS, setPaletteVar, resetPalette, currentPaletteValue, getAppearance, setAppearance, resetAppearance, BG_PATTERNS } from '../ui/theme.js';
import { isMaster, roleLabel } from '../workspaces/roles.js';
import { APP_ICONS, APP_COLORS } from '../workspaces/appBuilder.js';
import {
  listMyWorkspaces, createWorkspace, deleteWorkspace,
  setCurrentWorkspace, getUserProfile, updateUserProfile, uploadWorkspaceImage,
  isUsernameAvailable, usernameFormatError, changeUsername, normalizeUsername,
} from '../workspaces/data.js';

export function renderSettings(host, user, { onOpenWorkspace, section } = {}) {
  clear(host);
  // Deep-linked sub-section (e.g. /settings/workspace) opens that accordion.
  const openIf = (key) => ({ open: section === key });
  const wsSection = collapsible(buildWorkspaceSection(user, onOpenWorkspace), openIf('workspace'));
  host.append(
    el('div', { class: 'settings' }, [
      el('h2', { class: 'section__title' }, 'Settings'),
      collapsible(buildProfileSection(user), openIf('profile')),
      collapsible(buildVisibilitySection(user), openIf('visibility')),
      collapsible(buildEmailSection(user), openIf('email')),
      collapsible(buildPasswordSection(user), openIf('password')),
      collapsible(buildThemeSection(), openIf('theme')),
      wsSection,
    ]),
  );
  // Bring a deep-linked section into view.
  if (section) {
    const opened = host.querySelector('.settings-collapsible.is-open');
    if (opened) setTimeout(() => opened.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }
  // Refresh the workspace list instantly when a workspace is added/removed.
  const onWsChange = () => { try { wsSection._reloadWorkspaces && wsSection._reloadWorkspaces(); } catch { /* ignore */ } };
  window.addEventListener('rom-workspaces-changed', onWsChange);
  return () => window.removeEventListener('rom-workspaces-changed', onWsChange);
}

// Turn a settings-card <section> (first child = h3.settings-title) into a
// collapsed accordion: the header stays visible; the body opens only when the
// edit/header is clicked. Prevents accidental edits.
function collapsible(section, { open = false } = {}) {
  const kids = [...section.children];
  const title = kids[0];
  const body = el('div', { class: 'settings-body' });
  kids.slice(1).forEach((c) => body.append(c));
  const toggle = el('button', { class: 'settings-toggle', type: 'button', 'aria-label': 'Edit' }, icon('pencil'));
  const header = el('div', { class: 'settings-head' }, [title, toggle]);
  clear(section).append(header, body);
  section.classList.add('settings-collapsible');
  const setOpen = (o) => {
    section.classList.toggle('is-open', o);
    body.style.display = o ? '' : 'none';
    toggle.replaceChildren(icon(o ? 'chevron-up' : 'pencil'));
    toggle.setAttribute('aria-label', o ? 'Close' : 'Edit');
    toggle.setAttribute('aria-expanded', String(o));
  };
  setOpen(open);
  header.addEventListener('click', () => setOpen(!section.classList.contains('is-open')));
  return section;
}

/* ---------- profile visibility: what visitors can see ---------- */

// The visible-to-visitors fields and their defaults. Keep in sync with the
// public profile (userProfile.js) which reads users/{uid}.visibility.
export const VISIBILITY_FIELDS = [
  ['posts', 'Posts', 'Show your posts on your public profile'],
  ['ownedWorkspaces', 'Workspaces you own', 'List the workspaces you own'],
  ['memberSince', 'Member since', 'Show the date you joined'],
  ['verified', 'Verified badge', 'Show the verified badge when your email is verified'],
  ['email', 'Email address', 'Show your email address to visitors'],
];
export const VISIBILITY_DEFAULTS = { posts: true, ownedWorkspaces: true, memberSince: true, verified: true, email: false };

function buildVisibilitySection(user) {
  const inputs = {};
  const rows = VISIBILITY_FIELDS.map(([key, label, desc]) => {
    const cb = el('input', { type: 'checkbox', class: 'vis-check' });
    inputs[key] = cb;
    return el('label', { class: 'vis-row' }, [
      cb,
      el('div', { class: 'vis-text' }, [
        el('div', { class: 'vis-label' }, label),
        el('div', { class: 'muted vis-desc' }, desc),
      ]),
    ]);
  });
  const save = el('button', { class: 'btn btn--primary' }, 'Save visibility');
  const status = el('span', { class: 'muted settings-status' });
  getUserProfile(user.uid).then((p) => {
    const vis = { ...VISIBILITY_DEFAULTS, ...(p?.visibility || {}) };
    for (const [key] of VISIBILITY_FIELDS) inputs[key].checked = !!vis[key];
  }).catch(() => {});
  save.addEventListener('click', async () => {
    const visibility = {};
    for (const [key] of VISIBILITY_FIELDS) visibility[key] = inputs[key].checked;
    save.disabled = true;
    try { await updateUserProfile(user.uid, { visibility }); status.textContent = 'Saved.'; }
    catch (e) { status.textContent = e.message; }
    finally { save.disabled = false; setTimeout(() => { status.textContent = ''; }, 2500); }
  });
  return el('section', { class: 'settings-card card' }, [
    el('h3', { class: 'settings-title' }, [icon('eye'), ' Profile visibility']),
    el('p', { class: 'muted' }, 'Choose what other people can see when they view your profile.'),
    ...rows,
    el('div', { class: 'settings-actions' }, [save, status]),
  ]);
}

/* ---------- profile: name + username + phone ---------- */

function buildProfileSection(user) {
  const firstInput = el('input', { class: 'input', placeholder: 'First name' });
  const lastInput = el('input', { class: 'input', placeholder: 'Surname' });
  const userInput = el('input', { class: 'input', placeholder: 'username' });
  const phoneInput = el('input', { class: 'input', type: 'tel', placeholder: 'e.g. +63 917 000 0000' });
  const saveName = el('button', { class: 'btn btn--primary' }, 'Save');
  const saveUser = el('button', { class: 'btn btn--primary' }, 'Save');
  const savePhone = el('button', { class: 'btn btn--primary' }, 'Save');
  const userHint = el('div', { class: 'field__hint', 'aria-live': 'polite' }, 'Your unique @handle.');

  let originalUsername = '';
  // Prefill from the profile doc (fall back to splitting the display name).
  getUserProfile(user.uid).then((p) => {
    const dn = (p?.displayName || displayNameOf(user)).trim();
    firstInput.value = p?.firstName || dn.split(/\s+/)[0] || '';
    lastInput.value = p?.lastName || dn.split(/\s+/).slice(1).join(' ') || '';
    originalUsername = p?.username || '';
    userInput.value = originalUsername;
    if (p?.phone) phoneInput.value = p.phone;
  }).catch(() => {});

  // Live availability while editing the username.
  let userTimer = null; let userOk = true;
  const setHint = (cls, txt) => { userHint.className = `field__hint ${cls}`; userHint.textContent = txt; };
  userInput.addEventListener('input', () => {
    clearTimeout(userTimer);
    const val = userInput.value.trim();
    if (!val || normalizeUsername(val) === normalizeUsername(originalUsername)) { userOk = true; setHint('', 'Your unique @handle.'); return; }
    const fmt = usernameFormatError(val);
    if (fmt) { userOk = false; setHint('is-error', fmt); return; }
    userOk = false; setHint('', 'Checking availability…');
    userTimer = setTimeout(async () => {
      try { const ok = await isUsernameAvailable(val); if (userInput.value.trim() !== val) return; userOk = ok; setHint(ok ? 'is-ok' : 'is-error', ok ? `@${val} is available` : `@${val} is taken`); }
      catch { userOk = true; setHint('', "Couldn't check — you can still try."); }
    }, 450);
  });

  saveName.addEventListener('click', async () => {
    const first = firstInput.value.trim(); const last = lastInput.value.trim();
    const name = [first, last].filter(Boolean).join(' ');
    if (!name) return toast('Enter your first name and surname.', 'error');
    saveName.disabled = true;
    try { await changeName(name); await updateUserProfile(user.uid, { firstName: first, lastName: last, displayName: name }); toast('Name updated — reload to see it everywhere.', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    finally { saveName.disabled = false; }
  });
  saveUser.addEventListener('click', async () => {
    const val = userInput.value.trim();
    if (normalizeUsername(val) === normalizeUsername(originalUsername)) return toast('That is already your username.', 'info');
    const fmt = usernameFormatError(val);
    if (fmt) return toast(`Username: ${fmt.toLowerCase()}.`, 'error');
    if (!userOk) return toast('That username is taken — pick another.', 'error');
    saveUser.disabled = true;
    try {
      await changeUsername(user.uid, originalUsername, val);
      await updateUserProfile(user.uid, { username: val.trim() });
      originalUsername = val.trim(); setHint('is-ok', 'Username saved.');
      toast('Username updated.', 'success');
    } catch (err) { toast('Could not save — that username may have just been taken.', 'error'); }
    finally { saveUser.disabled = false; }
  });
  savePhone.addEventListener('click', async () => {
    savePhone.disabled = true;
    try { await updateUserProfile(user.uid, { phone: phoneInput.value.trim() }); toast('Phone number saved.', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    finally { savePhone.disabled = false; }
  });

  return el('section', { class: 'settings-card card' }, [
    el('h3', { class: 'settings-title' }, [icon('user'), ' Profile']),
    el('label', { class: 'settings-label' }, 'Name'),
    el('div', { class: 'field-row' }, [firstInput, lastInput]),
    el('div', { class: 'row', style: 'margin-top:.5rem' }, [el('div', { style: 'flex:1' }), saveName]),
    el('label', { class: 'settings-label' }, 'Username'),
    el('div', { class: 'row' }, [userInput, saveUser]),
    userHint,
    el('label', { class: 'settings-label' }, 'Phone number'),
    el('div', { class: 'row' }, [phoneInput, savePhone]),
  ]);
}

/* ---------- change email (verified) ---------- */

function buildEmailSection(user) {
  const cur = el('input', { class: 'input', type: 'password', placeholder: 'Current password' });
  const next = el('input', { class: 'input', type: 'email', placeholder: 'new@email.com' });
  const save = el('button', { class: 'btn btn--primary' }, [icon('mail'), ' Verify & change email']);
  save.addEventListener('click', async () => {
    const email = next.value.trim();
    if (!email) return toast('Enter the new email.', 'error');
    if (!cur.value) return toast('Enter your current password to confirm.', 'error');
    save.disabled = true;
    try {
      await changeEmailAddress(cur.value, email);
      toast(`Verification link sent to ${email}. Click it to finish the change.`, 'success');
      cur.value = ''; next.value = '';
    } catch (err) {
      const code = err?.code || '';
      if (code.includes('wrong-password') || code.includes('invalid-credential')) toast('Current password is incorrect.', 'error');
      else if (code.includes('email-already-in-use')) toast('That email is already in use.', 'error');
      else if (code.includes('invalid-email')) toast('That email looks invalid.', 'error');
      else if (code.includes('requires-recent-login')) toast('Please log out and back in, then try again.', 'error');
      else toast(err.message || 'Could not change email.', 'error');
    } finally { save.disabled = false; }
  });
  return el('section', { class: 'settings-card card' }, [
    el('h3', { class: 'settings-title' }, [icon('mail'), ' Change email']),
    el('p', { class: 'muted' }, `Current: ${user.email}. We'll send a verification link to the new address — the change takes effect once you click it.`),
    cur, next, el('div', { class: 'row' }, [save]),
  ]);
}

/* ---------- change password ---------- */

function buildPasswordSection(user) {
  const cur = el('input', { class: 'input', type: 'password', placeholder: 'Current password' });
  const next = el('input', { class: 'input', type: 'password', placeholder: 'New password' });
  const reqs = el('ul', { class: 'pw-reqs' });
  function drawReqs() {
    clear(reqs);
    for (const r of checkPassword(next.value).results) {
      reqs.append(el('li', { class: `pw-req ${r.ok ? 'pw-req--ok' : ''}` }, [icon(r.ok ? 'circle-check' : 'circle'), ' ' + r.label]));
    }
  }
  next.addEventListener('input', drawReqs); drawReqs();

  const save = el('button', { class: 'btn btn--primary' }, 'Change password');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await changePassword(cur.value, next.value);
      toast('Password changed.', 'success');
      cur.value = ''; next.value = ''; drawReqs();
    } catch (err) {
      const code = err?.code || '';
      if (code.includes('wrong-password') || code.includes('invalid-credential')) toast('Current password is incorrect.', 'error');
      else if (code === 'auth/weak-password-policy') toast(err.message, 'error');
      else if (code.includes('requires-recent-login')) toast('Please log out and back in, then try again.', 'error');
      else toast(err.message || 'Could not change password.', 'error');
    } finally { save.disabled = false; }
  });

  // Email-verification path: send a reset link to the account email.
  const emailBtn = el('button', { class: 'btn btn--ghost' }, [icon('mail'), ' Verify by email instead']);
  emailBtn.addEventListener('click', async () => {
    emailBtn.disabled = true;
    try { await sendPasswordReset(user.email); toast(`Reset link sent to ${user.email}. Follow it to set a new password.`, 'success'); }
    catch (err) { toast(err.message || 'Could not send reset email.', 'error'); }
    finally { setTimeout(() => { emailBtn.disabled = false; }, 4000); }
  });

  return el('section', { class: 'settings-card card' }, [
    el('h3', { class: 'settings-title' }, [icon('lock'), ' Change password']),
    el('p', { class: 'muted' }, 'Confirm with your current password, or verify by email — we\'ll send a secure reset link to your address.'),
    cur, next, reqs,
    el('div', { class: 'row' }, [save, emailBtn]),
  ]);
}

/* ---------- theme ---------- */

function buildThemeSection() {
  // dark / light toggle
  const segWrap = el('div', {});
  function seg() {
    const current = getTheme();
    const mk = (val, label, ic) => el('button', {
      class: `seg ${current === val ? 'seg--active' : ''}`,
      onclick: () => { applyTheme(val); clear(segWrap).append(seg()); drawSwatches(); },
    }, [icon(ic), ' ' + label]);
    return el('div', { class: 'seg-group' }, [mk('dark', 'Dark', 'moon'), mk('light', 'Light', 'sun')]);
  }
  segWrap.append(seg());

  // fully customizable palette
  const swatchWrap = el('div', { class: 'palette-grid' });
  function drawSwatches() {
    clear(swatchWrap);
    for (const entry of PALETTE_VARS) {
      const input = el('input', { type: 'color', class: 'palette-color', value: toHex(currentPaletteValue(entry)) });
      input.addEventListener('input', () => setPaletteVar(entry.var, input.value));
      swatchWrap.append(el('label', { class: 'palette-row' }, [input, el('span', {}, entry.label)]));
    }
  }
  drawSwatches();

  // --- card style: solid (default) or frosted glass with blur + opacity ---
  const cardWrap = el('div', {});
  const glassCtl = el('div', {});
  function drawCardStyle() {
    const a = getAppearance();
    const glass = a.cardStyle === 'glass';
    const mk = (val, label, ic) => el('button', {
      class: `seg ${((val === 'glass') === glass) ? 'seg--active' : ''}`,
      onclick: () => { setAppearance({ cardStyle: val }); drawCardStyle(); },
    }, [icon(ic), ' ' + label]);
    clear(cardWrap).append(el('div', { class: 'seg-group' }, [mk('solid', 'Solid', 'square'), mk('glass', 'Glass', 'sparkles')]));
    clear(glassCtl);
    if (glass) {
      const blur = el('input', { type: 'range', min: '0', max: '24', step: '1', value: String(a.cardBlur != null ? a.cardBlur : 10) });
      blur.addEventListener('input', () => setAppearance({ cardBlur: Number(blur.value) }));
      const op = el('input', { type: 'range', min: '30', max: '95', step: '1', value: String(a.cardOpacity != null ? a.cardOpacity : 65) });
      op.addEventListener('input', () => setAppearance({ cardOpacity: Number(op.value) }));
      glassCtl.append(
        el('div', { class: 'theme-slider-row' }, [el('label', {}, 'Blur'), blur]),
        el('div', { class: 'theme-slider-row' }, [el('label', {}, 'Opacity'), op]),
      );
    }
  }
  drawCardStyle();

  // --- background: none (default) / preset pattern / uploaded image ---
  const bgWrap = el('div', {});
  const bgDetail = el('div', {});
  const bgFile = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  bgFile.addEventListener('change', async () => {
    const f = bgFile.files && bgFile.files[0];
    bgFile.value = '';
    if (!f) return;
    try { const url = await compressBg(f); setAppearance({ bgType: 'image', bgImage: url }); drawBg(); toast('Background updated', 'success'); }
    catch { toast('Could not load that image.', 'error'); }
  });
  function drawBg() {
    const a = getAppearance();
    const type = a.bgType || 'none';
    const mk = (val, label, ic) => el('button', {
      class: `seg ${type === val ? 'seg--active' : ''}`,
      onclick: () => { if (val === 'none') { setAppearance({ bgType: 'none' }); } else { setAppearance({ bgType: val }); } drawBg(); },
    }, [icon(ic), ' ' + label]);
    clear(bgWrap).append(el('div', { class: 'seg-group' }, [mk('none', 'None', 'ban'), mk('pattern', 'Pattern', 'grid-dots'), mk('image', 'Image', 'photo')]));
    clear(bgDetail);
    if (type === 'pattern') {
      const row = el('div', { class: 'bg-pattern-row' });
      for (const pat of BG_PATTERNS) {
        const sw = el('button', { class: `bg-pattern ${a.bgPattern === pat.id ? 'is-active' : ''}`, title: pat.label, type: 'button' });
        sw.style.setProperty('--bgp-size', pat.size || 'auto');
        sw.style.setProperty('--bgp-repeat', pat.repeat || 'repeat');
        sw.style.backgroundImage = pat.image;
        sw.addEventListener('click', () => { setAppearance({ bgType: 'pattern', bgPattern: pat.id }); drawBg(); });
        row.append(sw);
      }
      bgDetail.append(row);
    } else if (type === 'image') {
      const pick = el('button', { class: 'btn btn--ghost btn--sm', type: 'button' }, [icon('upload'), a.bgImage ? ' Replace image' : ' Upload image']);
      pick.addEventListener('click', () => bgFile.click());
      bgDetail.append(el('div', { class: 'theme-slider-row', style: 'margin-top:10px' }, [pick, a.bgImage ? el('span', { class: 'muted', style: 'font-size:12px' }, 'Image set') : null]));
    }
  }
  drawBg();

  const resetBtn = el('button', { class: 'btn btn--ghost btn--sm' }, [icon('refresh'), ' Reset to default']);
  resetBtn.addEventListener('click', () => { resetPalette(); resetAppearance(); drawSwatches(); drawCardStyle(); drawBg(); toast('Theme reset to default.', 'success'); });

  return el('section', { class: 'settings-card card' }, [
    el('h3', { class: 'settings-title' }, [icon('palette'), ' Theme']),
    el('p', { class: 'muted' }, 'Choose light or dark, customize colors, card style and the background.'),
    segWrap,
    el('label', { class: 'settings-label' }, 'Custom palette'),
    swatchWrap,
    el('span', { class: 'theme-sub' }, 'Card style'),
    cardWrap,
    glassCtl,
    el('span', { class: 'theme-sub' }, 'Background'),
    bgWrap,
    bgDetail,
    bgFile,
    el('div', { class: 'row', style: 'margin-top:16px' }, [resetBtn]),
  ]);
}

// Compress an uploaded background so the theme (saved on the user doc) stays
// well under Firestore's 1 MB limit.
function compressBg(file, maxDim = 1280, quality = 0.68) {
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
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = r.result;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// Normalize a CSS color value to a 6-digit hex for <input type=color>.
function toHex(v) {
  const s = String(v || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + s.slice(1).split('').map((c) => c + c).join('');
  return '#000000';
}

/* ---------- workspace management ---------- */

function buildWorkspaceSection(user, onOpenWorkspace) {
  const createBtn = el('button', { class: 'btn btn--primary' }, [icon('plus'), ' Create workspace']);
  const list = el('div', { class: 'ws-manage-list' }, el('p', { class: 'muted' }, 'Loading…'));

  const section = el('section', { class: 'settings-card card' }, [
    el('h3', { class: 'settings-title' }, [icon('layout-dashboard'), ' Select workspace']),
    el('p', { class: 'muted' }, 'Add, open, delete, or set your default workspace (the "Workspace" nav item opens your default).'),
    el('div', { class: 'row' }, [createBtn]),
    list,
  ]);

  createBtn.addEventListener('click', () => openCreateWorkspaceModal(user, () => load()));

  async function load() {
    try {
      const [spaces, profile] = await Promise.all([listMyWorkspaces(user.uid), getUserProfile(user.uid)]);
      const currentId = profile?.currentWorkspaceId || null;
      clear(list);
      if (!spaces.length) { list.append(el('p', { class: 'muted' }, 'No workspaces yet. Create one above.')); return; }
      for (const ws of spaces) {
        const isCurrent = ws.id === currentId;
        const canDelete = ws.myRole === 'owner' || isMaster(user);
        const avatar = ws.imageUrl
          ? el('div', { class: 'ws-avatar ws-avatar--img' }, el('img', { src: ws.imageUrl, alt: ws.name }))
          : el('div', { class: 'ws-avatar', style: `background:${ws.color || '#5b8cff'}` }, icon(ws.icon || 'layout-dashboard'));
        list.append(el('div', { class: 'ws-manage-row card' }, [
          el('div', { class: 'ws-manage-left' }, [
            avatar,
            el('div', {}, [
              el('div', { class: 'ws-manage-name' }, [ws.name, isCurrent ? el('span', { class: 'pill pill--editor ws-current' }, 'Default') : null]),
              el('div', { class: 'muted' }, `Your role: ${roleLabel(ws.myRole)}${ws.description ? ' · ' + ws.description : ''}`),
            ]),
          ]),
          el('div', { class: 'ws-manage-actions' }, [
            el('button', { class: 'btn btn--ghost btn--sm', onclick: async () => {
                try { if (!isCurrent) await setCurrentWorkspace(user.uid, ws.id); onOpenWorkspace(ws.id); }
                catch (err) { toast(err.message, 'error'); }
              } }, 'Open'),
            isCurrent ? null : el('button', {
              class: 'btn btn--ghost btn--sm', onclick: async () => {
                try { await setCurrentWorkspace(user.uid, ws.id); toast('Set as default', 'success'); load(); }
                catch (err) { toast(err.message, 'error'); }
              },
            }, 'Set default'),
            canDelete ? el('button', {
              class: 'btn btn--danger btn--sm', onclick: () => openDeleteWorkspaceModal(user, ws, load),
            }, 'Delete') : null,
          ]),
        ]));
      }
    } catch (err) {
      clear(list);
      list.append(el('p', { class: 'error-text' }, err.message));
    }
  }
  load();
  section._reloadWorkspaces = load; // let renderSettings refresh on external changes
  return section;
}

/* ---- Create-workspace modal: name, description, icon+color OR uploaded image ---- */

// Hardened workspace deletion: type the exact workspace name + your password
// twice (verified by reauthentication) before the destructive delete proceeds.
function openDeleteWorkspaceModal(user, ws, onDeleted) {
  const { body, close } = openModal({ title: 'Delete workspace', iconName: 'trash' });
  const nameInput = el('input', { class: 'input', placeholder: ws.name, autocomplete: 'off', spellcheck: 'false' });
  const pw1 = el('input', { class: 'input', type: 'password', placeholder: 'Your password', autocomplete: 'current-password' });
  const pw2 = el('input', { class: 'input', type: 'password', placeholder: 'Confirm password', autocomplete: 'current-password' });
  const err = el('div', { class: 'error-text', style: 'display:none; margin-top:6px' });
  const showErr = (m) => { err.textContent = m || ''; err.style.display = m ? '' : 'none'; };

  const delBtn = el('button', { class: 'btn btn--danger', disabled: 'disabled' }, [icon('trash'), ' Delete forever']);
  const cancelBtn = el('button', { class: 'btn btn--ghost', onclick: close }, 'Cancel');

  const nameMatches = () => nameInput.value.trim() === ws.name;
  nameInput.addEventListener('input', () => { delBtn.disabled = !nameMatches(); showErr(''); });

  delBtn.addEventListener('click', async () => {
    if (!nameMatches()) { showErr('The workspace name does not match.'); return; }
    if (!pw1.value || !pw2.value) { showErr('Enter your password in both fields.'); return; }
    if (pw1.value !== pw2.value) { showErr('The two passwords do not match.'); return; }
    delBtn.disabled = true;
    try {
      await verifyPassword(pw1.value);
      await deleteWorkspace(ws.id, user.uid);
      toast('Workspace deleted', 'success');
      close();
      if (onDeleted) onDeleted();
    } catch (e) {
      const c = String(e?.code || e?.message || '');
      showErr(c.includes('wrong-password') || c.includes('invalid-credential') ? 'Incorrect password.' : (e.message || 'Could not delete workspace.'));
      delBtn.disabled = false;
    }
  });

  body.append(
    el('p', { class: 'muted' }, ['This permanently deletes ', el('b', {}, ws.name), ' and all of its data. This cannot be undone.']),
    el('label', { class: 'form-label' }, ['Type ', el('b', {}, ws.name), ' to confirm']),
    nameInput,
    el('label', { class: 'form-label' }, 'Enter your password'),
    pw1,
    el('label', { class: 'form-label' }, 'Confirm your password'),
    pw2,
    err,
    el('div', { class: 'confirm-modal__actions', style: 'margin-top:16px' }, [cancelBtn, delBtn]),
  );
  nameInput.focus();
}

export function openCreateWorkspaceModal(user, onDone) {
  const state = { mode: 'icon', icon: APP_ICONS[0], color: APP_COLORS[0], file: null, previewUrl: '' };
  const { body, close, iconEl } = openModal({ title: 'Create workspace', iconName: state.icon, iconColor: state.color });

  const nameInput = el('input', { class: 'input', placeholder: 'e.g. Roman Space, Marketing' });
  const descInput = el('textarea', { class: 'input', rows: '2', placeholder: 'What is this workspace for? (optional)' });

  function refreshHeader() {
    if (!iconEl) return;
    if (state.mode === 'image' && state.previewUrl) {
      iconEl.style.background = `center / cover no-repeat url(${state.previewUrl})`;
      iconEl.innerHTML = '';
    } else {
      iconEl.style.background = state.color;
      clear(iconEl).append(icon(state.icon));
    }
  }

  // appearance mode toggle
  const iconModeBtn = el('button', { class: 'btn btn--primary', type: 'button' }, [icon('category'), ' Icon']);
  const imgModeBtn = el('button', { class: 'btn', type: 'button' }, [icon('photo'), ' Upload image']);
  const iconPanel = el('div', {});
  const imgPanel = el('div', { style: 'display:none' });
  function setMode(m) {
    state.mode = m;
    iconModeBtn.className = 'btn' + (m === 'icon' ? ' btn--primary' : '');
    imgModeBtn.className = 'btn' + (m === 'image' ? ' btn--primary' : '');
    iconPanel.style.display = m === 'icon' ? '' : 'none';
    imgPanel.style.display = m === 'image' ? '' : 'none';
    refreshHeader();
  }
  iconModeBtn.onclick = () => setMode('icon');
  imgModeBtn.onclick = () => setMode('image');

  // icon panel
  const search = el('input', { class: 'input', placeholder: 'Search icons…' });
  const grid = el('div', { class: 'icon-grid' });
  function drawGrid() {
    const q = search.value.trim().toLowerCase();
    clear(grid);
    for (const n of APP_ICONS.filter((x) => !q || x.includes(q))) {
      grid.append(el('button', { class: `icon-cell ${n === state.icon ? 'icon-cell--active' : ''}`, type: 'button', onclick: () => { state.icon = n; drawGrid(); refreshHeader(); } }, icon(n)));
    }
  }
  search.addEventListener('input', drawGrid);
  // Color row: preset swatches + a "+" that opens a custom-color POPOVER which
  // stays open while you pick and closes only when you click outside it.
  const swatches = el('div', { class: 'color-row' });
  let pop = null;
  function onDocDown(e) { if (pop && !pop.contains(e.target) && !e.target.closest('.swatch--custom')) closePop(); }
  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', onDocDown); } }
  function setColor(c) { state.color = c; refreshHeader(); drawSwatches(); }
  function openPop(anchor) {
    const isCustom = !APP_COLORS.includes(state.color);
    const native = el('input', { type: 'color', class: 'color-pop-native', value: isCustom ? state.color : '#5b8cff' });
    const hex = el('input', { class: 'input input--sm color-pop-hex', value: state.color, maxlength: '7', spellcheck: 'false' });
    native.addEventListener('input', () => { hex.value = native.value; state.color = native.value; refreshHeader(); });
    hex.addEventListener('input', () => { const v = hex.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) { native.value = v; state.color = v; refreshHeader(); } });
    pop = el('div', { class: 'color-popover' }, [
      el('div', { class: 'color-pop-title' }, 'Custom color'),
      el('div', { class: 'color-pop-row' }, [native, hex]),
      el('div', { class: 'color-pop-foot' }, el('button', { class: 'btn btn--primary btn--sm', type: 'button', onclick: () => { drawSwatches(); closePop(); } }, 'Done')),
    ]);
    anchor.append(pop);
    setTimeout(() => document.addEventListener('mousedown', onDocDown), 0);
  }
  function drawSwatches() {
    clear(swatches);
    for (const c of APP_COLORS) {
      swatches.append(el('button', { class: `swatch ${c === state.color ? 'swatch--active' : ''}`, type: 'button', style: `background:${c}`, onclick: () => setColor(c) }));
    }
    const isCustom = !APP_COLORS.includes(state.color);
    // A positioned wrapper so the popover is a SIBLING of the trigger button
    // (inputs inside a <button> would be invalid + steal clicks).
    const wrap = el('span', { class: 'swatch-custom-wrap' });
    const trigger = el('button', {
      class: `swatch swatch--custom ${isCustom ? 'swatch--active' : ''}`, type: 'button', title: 'Custom color',
      ...(isCustom ? { style: `background:${state.color}` } : {}),
    }, isCustom ? null : icon('plus'));
    trigger.addEventListener('click', () => { if (pop) closePop(); else openPop(wrap); });
    wrap.append(trigger);
    if (pop) wrap.append(pop); // keep an open popover attached across redraws
    swatches.append(wrap);
  }
  drawGrid(); drawSwatches();
  iconPanel.append(el('label', { class: 'form-label' }, 'Icon'), search, grid, el('label', { class: 'form-label' }, 'Icon color'), swatches);

  // image panel
  const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  const pickBtn = el('button', { class: 'btn', type: 'button' }, [icon('upload'), ' Choose image']);
  const imgPreview = el('div', { class: 'ws-img-preview' });
  pickBtn.onclick = () => fileInput.click();
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0]; if (!f) return;
    state.file = f;
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = URL.createObjectURL(f);
    clear(imgPreview).append(el('img', { src: state.previewUrl, alt: 'preview' }));
    refreshHeader();
  });
  imgPanel.append(el('label', { class: 'form-label' }, 'Workspace image'), pickBtn, fileInput, imgPreview);

  const createBtn = el('button', { class: 'btn btn--primary' }, [icon('plus'), ' Create workspace']);
  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return toast('Give the workspace a name.', 'error');
    createBtn.disabled = true;
    try {
      let imageUrl = '';
      if (state.mode === 'image' && state.file) imageUrl = await uploadWorkspaceImage(user, state.file);
      const newId = await createWorkspace(user, { name, description: descInput.value.trim(), icon: state.icon, color: state.color, imageUrl });
      toast('Workspace created', 'success');
      close();
      onDone(newId);
    } catch (err) {
      const c = String(err?.code || err?.message || '');
      toast(c.includes('storage') || c.includes('unauthorized') || c.includes('bucket')
        ? 'Image upload failed — is Firebase Storage enabled? You can use an icon instead.'
        : (err.message || 'Could not create workspace.'), 'error');
      createBtn.disabled = false;
    }
  });

  refreshHeader();
  body.append(el('div', { class: 'field-modal' }, [
    el('label', { class: 'form-label' }, 'Workspace name'), nameInput,
    el('label', { class: 'form-label' }, ['Description ', el('span', { class: 'muted' }, '(optional)')]), descInput,
    el('label', { class: 'form-label' }, 'Appearance'),
    el('div', { class: 'row' }, [iconModeBtn, imgModeBtn]),
    iconPanel, imgPanel,
    el('div', { class: 'app-create-foot' }, [el('button', { class: 'btn btn--ghost', onclick: close }, 'Cancel'), createBtn]),
  ]));
}
