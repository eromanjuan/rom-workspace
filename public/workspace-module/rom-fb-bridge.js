// ROM ↔ Firebase bridge for the embedded Workspace Builder module.
// Seeds localStorage from a shared Firestore doc, mirrors writes, live-syncs,
// mirrors ROM's theme + accent, injects the signed-in user (name/email), the
// workspace identity (name/desc/icon/color/image), the user's permissions, and
// the workspace members — then imports the module bundle and signals ROM.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js';
import { getAuth, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocs, collection, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDgJai9t4UxicjzaIyHdc-hk5pTyAVF0bI',
  authDomain: 'rom-database-0909.firebaseapp.com',
  projectId: 'rom-database-0909',
  storageBucket: 'rom-database-0909.firebasestorage.app',
  messagingSenderId: '192979949981',
  appId: '1:192979949981:web:162d2e67ffe5cb4a8e3774',
};

const PREFIX = 'romio_workspace_v1';
// Data written before the de-branding rename. Migrated once, in place, so an
// existing workspace's apps/tiles/feed carry over untouched.
const LEGACY_PREFIX = 'qhq_workspace_builder_v1';
// Stable entry name (see vite.config.js). Bump ?v= to bust cache on rebuild.
const MODULE_ENTRY = '/workspace-module/assets/rom-module-entry.js?v=24';
// The iframe's real page. Used to reload the module without picking up whatever
// path the module's router pushed into this iframe's URL.
const MODULE_PAGE = '/workspace-module/index.html?v=24';
const MASTER_EMAIL = 'eugenioiromanjuan@gmail.com';

const ALL_PERMS = { viewWorkspace: true, viewPosts: true, viewTiles: true, interactTiles: true, post: true, deleteOwnPost: true, editTiles: true, manage: true };
const VIEWER_PERMS = { viewWorkspace: true, viewPosts: true, viewTiles: true, interactTiles: false, post: false, deleteOwnPost: false, editTiles: false, manage: false };
const NO_PERMS = { viewWorkspace: false, viewPosts: false, viewTiles: false, interactTiles: false, post: false, deleteOwnPost: false, editTiles: false, manage: false };
function permsForMember(role, perms, isMaster) {
  if (isMaster) return ALL_PERMS;
  if (role === 'owner') return ALL_PERMS;
  if (role === 'editor') return { ...ALL_PERMS, manage: false };
  if (role === 'viewer') return VIEWER_PERMS;
  if (role === 'custom' && perms) {
    // Derive the dashboard's coarse enforcement flags from the granular toggles.
    const anyView = perms.viewFeed || perms.viewPosts || perms.viewApps || perms.viewTiles || perms.viewActivity;
    const anyWrite = perms.createPost || perms.createComment || perms.createApps || perms.createItems
      || perms.createTiles || perms.editTiles || perms.interactTiles || perms.addEvent || perms.addChecklist;
    return {
      viewWorkspace: !!anyView, viewPosts: !!perms.viewPosts, viewTiles: !!perms.viewTiles,
      interactTiles: !!(perms.interactTiles || anyWrite),
      post: !!anyWrite, editTiles: !!(perms.createTiles || perms.editTiles),
      deleteOwnPost: !!perms.createPost, manage: false,
    };
  }
  return NO_PERMS;
}

// A per-workspace theme (workspaces/{wsId}.theme), set by the owner in Workspace
// Settings. When present it FULLY overrides the viewer's personal theme for the
// dashboard; otherwise the dashboard inherits the viewer's global ROM theme.
let wsTheme = null;
function romTheme() {
  if (wsTheme && (wsTheme.mode === 'light' || wsTheme.mode === 'dark')) return wsTheme.mode;
  return localStorage.getItem('rom-theme') === 'light' ? 'light' : 'dark';
}
// ROMIO palette defaults (mirror of src/ui/theme.js PALETTE_VARS) so the module
// adopts ROMIO's colours even when the user hasn't customised them.
const ROM_PALETTE_DEFAULTS = {
  '--primary': { dark: '#5b8cff', light: '#3f6fff' },
  '--bg':      { dark: '#0f1115', light: '#f4f6fa' },
  '--surface': { dark: '#1a1d24', light: '#ffffff' },
  '--text':    { dark: '#e7e9ee', light: '#1c2230' },
  '--danger':  { dark: '#ff6b6b', light: '#e5484d' },
};
// Preset patterns (mirror of src/ui/theme.js BG_PATTERNS).
const ROM_BG_PATTERNS = {
  dots:     { image: 'radial-gradient(color-mix(in srgb, var(--text) 16%, transparent) 1px, transparent 1.6px)', size: '16px 16px', repeat: 'repeat' },
  grid:     { image: 'linear-gradient(color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 1px)', size: '24px 24px', repeat: 'repeat' },
  diagonal: { image: 'repeating-linear-gradient(45deg, color-mix(in srgb, var(--text) 7%, transparent) 0 1px, transparent 1px 13px)', size: 'auto', repeat: 'repeat' },
  glow:     { image: 'radial-gradient(at 18% 18%, color-mix(in srgb, var(--primary) 24%, transparent), transparent 42%), radial-gradient(at 82% 62%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 46%)', size: 'cover', repeat: 'no-repeat' },
  mesh:     { image: 'radial-gradient(at 0% 0%, color-mix(in srgb, var(--primary) 26%, transparent), transparent 40%), radial-gradient(at 100% 0%, color-mix(in srgb, var(--danger) 20%, transparent), transparent 42%), radial-gradient(at 60% 100%, color-mix(in srgb, var(--primary) 20%, transparent), transparent 44%)', size: 'cover', repeat: 'no-repeat' },
};
function romVar(name) {
  if (wsTheme && wsTheme.palette && wsTheme.palette[name]) return wsTheme.palette[name];
  try { const p = JSON.parse(localStorage.getItem('rom-palette') || '{}'); if (p[name]) return p[name]; } catch { /* ignore */ }
  const d = ROM_PALETTE_DEFAULTS[name];
  return d ? d[romTheme()] : '';
}
function romAppearance() {
  if (wsTheme && wsTheme.appearance) return wsTheme.appearance;
  try { return JSON.parse(localStorage.getItem('rom-appearance') || '{}') || {}; } catch { return {}; }
}
function applyThemeToModule() {
  const t = romTheme();
  localStorage.setItem('romio-theme', t);
  const root = document.documentElement;
  root.dataset.themeMode = t;
  root.dataset.theme = t;
  const accent = romVar('--primary');
  const set = (v, val) => { if (val) root.style.setProperty(v, val, 'important'); };
  // Accent → the module's accent vars.
  set('--primary', accent); set('--orange', accent); set('--amber', accent); set('--blue', accent);
  // Core surfaces/text/danger → the module's equivalents, so the workspace
  // dashboard matches ROMIO's palette (custom or theme default).
  const bg = romVar('--bg'), surface = romVar('--surface'), text = romVar('--text'), danger = romVar('--danger');
  set('--bg', bg);
  set('--surface', surface); set('--surface-2', surface); set('--surface-3', surface); set('--panel', surface);
  set('--text', text); set('--ink', text);
  set('--red', danger);
  mirrorAppearance();
}
// Mirror ROMIO's background image/pattern + glass into the (same-origin) module
// document via an injected stylesheet, so the dashboard adapts to Theme settings.
function mirrorAppearance() {
  if (!document.head) return;
  let st = document.getElementById('rom-mirror-appearance');
  if (!st) { st = document.createElement('style'); st.id = 'rom-mirror-appearance'; document.head.appendChild(st); }
  const a = romAppearance();
  let css = '';
  let bgImage = '', bgSize = 'cover', bgRepeat = 'no-repeat';
  if (a.bgType === 'image' && a.bgImage) { bgImage = `url("${a.bgImage}")`; }
  else if (a.bgType === 'pattern' && a.bgPattern && ROM_BG_PATTERNS[a.bgPattern]) {
    const pat = ROM_BG_PATTERNS[a.bgPattern]; bgImage = pat.image; bgSize = pat.size; bgRepeat = pat.repeat;
  }
  if (bgImage) {
    // Make the module's opaque shells transparent so the fixed background layer
    // (body::before) shows through, then paint the chosen image/pattern.
    css += `html,body,#app,.romio-app,.wb-builder,.wb-page,.tool-page,main{background:transparent !important}`
      + `body::before{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;`
      + `background-image:${bgImage};background-size:${bgSize};background-repeat:${bgRepeat};background-position:center;}`;
  }
  if (a.cardStyle === 'glass') {
    const blur = (a.cardBlur != null ? a.cardBlur : 10) + 'px';
    const op = (a.cardOpacity != null ? a.cardOpacity : 65) + '%';
    // Target the module's actual card/tile/panel classes (wb-*) so the frost + opacity land.
    const sel = '.wb-card,.wb-tile,.wb-feed,.wb-feed-card,.wb-composer,.wb-members-bar,.wb-empty,.wb-bar,.wb-panel,.wb-topbar,.wb-report,.card,.panel,.tile,[class*="card"]';
    css += `${sel}{`
      + `background-color:color-mix(in srgb, var(--surface) ${op}, transparent) !important;`
      + `backdrop-filter:blur(${blur}) saturate(1.15);-webkit-backdrop-filter:blur(${blur}) saturate(1.15);}`;
  }
  st.textContent = css;
}
applyThemeToModule();
window.addEventListener('storage', (e) => {
  if (e.key === 'rom-palette' || e.key === 'rom-theme' || e.key === 'rom-appearance' || e.key === null) applyThemeToModule();
});
// ROMIO also pushes theme changes directly (storage events don't always reach a
// nested iframe reliably), so light/dark + palette + glass update live here.
window.addEventListener('message', (e) => {
  if (e.origin === window.location.origin && e.data && e.data.type === 'rom-theme-sync') applyThemeToModule();
});

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Let the embedded module raise a ROMIO notification (e.g. a workspace @mention)
// into the recipient's ROMIO bell. actorId must equal the caller's uid to satisfy
// the Firestore rules; self-notifications are skipped.
window.__ROM_NOTIFY__ = async (uid, payload = {}) => {
  const me = auth.currentUser;
  if (!uid || !me || uid === me.uid) return;
  try {
    await addDoc(collection(db, 'notifications', uid, 'items'), {
      read: false,
      createdAt: serverTimestamp(),
      type: payload.type || 'mention',
      actorId: me.uid,
      actorName: me.displayName || me.email || 'Someone',
      title: String(payload.title || 'You were mentioned').slice(0, 300),
      body: String(payload.body || '').slice(0, 500),
      link: { view: 'workspace' },
    });
  } catch (e) { /* non-fatal */ }
};

// Per-workspace document (set in boot once we know the workspace). The legacy
// global doc is used only for a one-time migration so existing data isn't lost.
let ref = null;
let syncReady = false; // don't push local state until the initial pull is applied
const legacyRef = doc(db, 'workspaceBuilder', 'shared');

const origSet = localStorage.setItem.bind(localStorage);
const origRemove = localStorage.removeItem.bind(localStorage);
let applyingRemote = false;
let saveTimer = null;

function collectLocal() {
  const map = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) map[k] = localStorage.getItem(k);
  }
  return map;
}
function clearLocal() {
  // Clear both the current and the pre-rename prefix, so stale legacy entries
  // can't linger next to the migrated ones.
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const k = localStorage.key(i);
    if (k && (k.startsWith(PREFIX) || k.startsWith(LEGACY_PREFIX))) origRemove(k);
  }
}
function applyKeys(keys) {
  applyingRemote = true;
  clearLocal();
  for (const [k, v] of Object.entries(keys || {})) origSet(k, v);
  applyingRemote = false;
}
// One-time, lossless migration of the pre-rename storage keys: rewrite any
// `${LEGACY_PREFIX}:*` entry to `${PREFIX}:*`, keeping its value. Returns the
// migrated map plus whether anything changed (so we can persist it once).
function migrateLegacyKeys(keys) {
  const out = {}; let changed = false;
  for (const [k, v] of Object.entries(keys || {})) {
    if (k.startsWith(LEGACY_PREFIX)) { out[`${PREFIX}${k.slice(LEGACY_PREFIX.length)}`] = v; changed = true; }
    else out[k] = v;
  }
  return { keys: out, changed };
}
// The module stores its data under `${PREFIX}:${companyId}` but keeps the ACTIVE
// company in a separate localStorage key that was never synced. On a fresh
// browser (or if that key changed) the module would open a DIFFERENT, empty
// company — so a workspace's apps looked like they had vanished even though the
// data was safe in Firestore. Point the module at the company we actually seeded.
const COMPANY_KEY = 'romio-active-company';
const LEGACY_COMPANY_KEY = 'quest-hq-active-company';
function syncActiveCompanyFromKeys() {
  try {
    const p = `${PREFIX}:`;
    let best = null; let bestScore = -1;
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(p)) continue;
      let score = 0;
      try {
        const d = JSON.parse(localStorage.getItem(k) || '{}');
        for (const ws of (Array.isArray(d?.workspaces) ? d.workspaces : [])) {
          score += 1 + (Array.isArray(ws?.apps) ? ws.apps.length * 10 : 0);
        }
      } catch { /* unparseable — score 0 */ }
      if (score > bestScore) { bestScore = score; best = k.slice(p.length); }
    }
    if (best) origSet(COMPANY_KEY, best);
    origRemove(LEGACY_COMPANY_KEY); // drop the pre-rename key
  } catch { /* ignore */ }
}

// ROMIO owns authentication. Hide the embedded module's own "Sign out" — it calls
// navigate('/login'), which pushes /login into this iframe's URL; that path resolves
// to the ROMIO SPA, so a later reload would load ROMIO inside its own iframe.
function hideModuleAuthUI() {
  try {
    if (!document.head || document.getElementById('rom-hide-module-auth')) return;
    const st = document.createElement('style');
    st.id = 'rom-hide-module-auth';
    st.textContent = '[data-action="sign-out"]{display:none !important}';
    document.head.appendChild(st);
  } catch { /* ignore */ }
}

let seededKeyCount = 0; // how many builder keys the remote blob had when we seeded
function scheduleSave() {
  // Anti-clobber: never write until we've pulled + applied the remote state, so
  // a stale/empty tab can't overwrite what another tab already saved.
  if (!ref || !syncReady) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const keys = collectLocal();
    // Anti-wipe: never replace a populated remote blob with an empty local one
    // (a failed seed must not destroy the workspace's apps).
    if (!Object.keys(keys).length && seededKeyCount > 0) {
      console.warn('[ROM] skipped an empty workspace save (would have wiped remote data)');
      return;
    }
    try { await setDoc(ref, { keys, updatedAt: serverTimestamp() }); }
    catch (e) { console.warn('[ROM] workspace sync save failed', e); }
  }, 700);
}

localStorage.setItem = function patchedSet(k, v) {
  origSet(k, v);
  if (!applyingRemote && typeof k === 'string' && k.startsWith(PREFIX)) scheduleSave();
};
localStorage.removeItem = function patchedRemove(k) {
  origRemove(k);
  if (!applyingRemote && typeof k === 'string' && k.startsWith(PREFIX)) scheduleSave();
};

async function boot() {
  const user = await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
  });

  window.__ROM_WS_PERMS__ = ALL_PERMS;
  window.__ROM_WS_EVENTS__ = window.__ROM_WS_EVENTS__ || [];
  window.__ROM_WS_CHECKLISTS__ = window.__ROM_WS_CHECKLISTS__ || [];
  window.__ROM_WS_NOTES__ = window.__ROM_WS_NOTES__ || [];
  window.__ROM_CAN_WRITE__ = false;

  // Tiles mirror the signed-in user's PERSONAL data (Calendar/Checklist/Notes
  // tools). These are injected live so tile config pickers + snapshots see them.
  const notify = () => { try { window.dispatchEvent(new CustomEvent('rom-ws-data')); } catch { /* ignore */ } };

  if (user) {
    window.__ROM_USER_NAME__ = user.displayName || (user.email ? user.email.split('@')[0] : 'You');
    window.__ROM_USER_EMAIL__ = user.email || '';
    const isMaster = (user.email || '').toLowerCase() === MASTER_EMAIL;

    // Personal tool data (available regardless of workspace membership).
    onSnapshot(collection(db, 'users', user.uid, 'events'), (snap) => {
      window.__ROM_WS_EVENTS__ = snap.docs.map((dd) => ({ id: dd.id, ...dd.data() }));
      notify();
    }, () => {});
    onSnapshot(collection(db, 'users', user.uid, 'checklists'), (snap) => {
      window.__ROM_WS_CHECKLISTS__ = snap.docs.map((dd) => ({ id: dd.id, ...dd.data() }));
      notify();
    }, () => {});
    onSnapshot(collection(db, 'users', user.uid, 'notes'), (snap) => {
      window.__ROM_WS_NOTES__ = snap.docs.map((dd) => ({ id: dd.id, ...dd.data() }));
      notify();
    }, () => {});

    let wsId = null;
    try {
      const profile = await getDoc(doc(db, 'users', user.uid));
      // Prefer the ROM profile's displayName (auth.displayName is often unset).
      const pdata = profile.exists() ? profile.data() : {};
      if (pdata.displayName) window.__ROM_USER_NAME__ = pdata.displayName;
      wsId = profile.exists() ? profile.data().currentWorkspaceId : null;
      if (wsId) {
        const ws = await getDoc(doc(db, 'workspaces', wsId));
        if (ws.exists()) {
          const d = ws.data();
          if (d.name) window.__ROM_WS_NAME__ = d.name;
          if (d.description) window.__ROM_WS_DESC__ = d.description;
          if (d.icon) window.__ROM_WS_ICON__ = d.icon;
          if (d.color) window.__ROM_WS_COLOR__ = d.color;
          if (d.imageUrl) window.__ROM_WS_IMAGE__ = d.imageUrl;
          // Per-workspace theme overrides the viewer's personal theme (dashboard).
          if (d.theme && typeof d.theme === 'object') { wsTheme = d.theme; applyThemeToModule(); }
        }
        const mem = await getDoc(doc(db, 'workspaces', wsId, 'members', user.uid));
        const memRole = mem.exists() ? mem.data().role : null;
        window.__ROM_WS_PERMS__ = permsForMember(memRole, mem.exists() ? mem.data().perms : null, isMaster);
        // Can this user add/configure dashboard tiles? (owner/editor/master)
        window.__ROM_CAN_WRITE__ = isMaster || memRole === 'owner' || memRole === 'editor';
        try {
          const mems = await getDocs(collection(db, 'workspaces', wsId, 'members'));
          window.__ROM_WS_MEMBERS__ = mems.docs.map((m) => {
            const x = m.data();
            return { id: x.uid || m.id, name: x.displayName || x.email || 'Member', email: x.email || '', role: x.role || 'member' };
          });
        } catch (e) { /* keep default members */ }
      } else if (isMaster) {
        window.__ROM_WS_PERMS__ = ALL_PERMS;
      }
    } catch (e) { /* keep defaults */ }

    // Scope the builder's data to THIS workspace (falls back to a per-user doc
    // when no workspace is selected). Both local + live tabs converge on it.
    ref = doc(db, 'workspaceBuilder', wsId || `u-${user.uid}`);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        // Migrate pre-rename keys in place (lossless), then persist once.
        const m = migrateLegacyKeys(snap.data().keys);
        seededKeyCount = Object.keys(m.keys).length;
        applyKeys(m.keys);
        if (m.changed) {
          try { await setDoc(ref, { keys: m.keys, updatedAt: serverTimestamp() }); }
          catch (e) { console.warn('[ROM] storage-key migration save failed', e); }
        }
      } else {
        // First time on this workspace doc. Migrate the legacy global doc ONCE
        // (into whichever workspace loads first), then delete it so every other
        // workspace starts empty and stays isolated — installing an app in one
        // workspace no longer makes it appear in all of them.
        const legacy = await getDoc(legacyRef);
        if (legacy.exists() && Object.keys(legacy.data().keys || {}).length) {
          const m = migrateLegacyKeys(legacy.data().keys);
          seededKeyCount = Object.keys(m.keys).length;
          applyKeys(m.keys);
          await setDoc(ref, { keys: m.keys, updatedAt: serverTimestamp() });
          try { await deleteDoc(legacyRef); } catch (e) { /* best effort */ }
        } else {
          clearLocal(); // don't inherit another workspace's data from this browser
        }
      }
    } catch (e) { console.warn('[ROM] workspace seed failed', e); }
    // Open the company whose data we just seeded (see syncActiveCompanyFromKeys).
    syncActiveCompanyFromKeys();
    syncReady = true; // safe to persist local edits now

    onSnapshot(ref, (snap) => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      const remote = JSON.stringify(snap.data().keys || {});
      if (remote === JSON.stringify(collectLocal())) return;
      const m = migrateLegacyKeys(snap.data().keys);
      seededKeyCount = Object.keys(m.keys).length;
      applyKeys(m.keys);
      syncActiveCompanyFromKeys();
      // Reload the MODULE page. NOT location.reload(): the module's router
      // pushState's app paths (/workspaces/…, /login) into this iframe's URL, and
      // those resolve to the ROMIO SPA — reloading them loads ROMIO inside its own
      // iframe (the "Open ROMIO in its own tab" guard / apparent logout).
      window.location.replace(MODULE_PAGE);
    });
  }

  await import(MODULE_ENTRY);
  applyThemeToModule();
  hideModuleAuthUI();
  try { window.parent.postMessage({ type: 'rom-ws-ready' }, window.location.origin); } catch { /* ignore */ }
}

boot();
