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

const PREFIX = 'qhq_workspace_builder_v1';
// Stable entry name (see vite.config.js). Bump ?v= to bust cache on rebuild.
const MODULE_ENTRY = '/workspace-module/assets/rom-module-entry.js?v=16';
const MASTER_EMAIL = 'eugenioiromanjuan@gmail.com';

const ALL_PERMS = { viewWorkspace: true, viewPosts: true, viewTiles: true, interactTiles: true, post: true, deleteOwnPost: true, editTiles: true, manage: true };
const VIEWER_PERMS = { viewWorkspace: true, viewPosts: true, viewTiles: true, interactTiles: true, post: false, deleteOwnPost: false, editTiles: false, manage: false };
const NO_PERMS = { viewWorkspace: false, viewPosts: false, viewTiles: false, interactTiles: false, post: false, deleteOwnPost: false, editTiles: false, manage: false };
function permsForMember(role, perms, isMaster) {
  if (isMaster) return ALL_PERMS;
  if (role === 'owner') return ALL_PERMS;
  if (role === 'editor') return { ...ALL_PERMS, manage: false };
  if (role === 'viewer') return VIEWER_PERMS;
  if (role === 'custom' && perms) return { ...VIEWER_PERMS, ...perms, manage: false };
  return NO_PERMS;
}

function romTheme() { return localStorage.getItem('rom-theme') === 'light' ? 'light' : 'dark'; }
function romAccent() {
  try { const p = JSON.parse(localStorage.getItem('rom-palette') || '{}'); if (p['--primary']) return p['--primary']; } catch { /* ignore */ }
  return romTheme() === 'light' ? '#3f6fff' : '#5b8cff';
}
function applyThemeToModule() {
  const t = romTheme();
  const c = romAccent();
  localStorage.setItem('quest-theme', t);
  const root = document.documentElement;
  root.dataset.themeMode = t;
  root.dataset.theme = t;
  root.style.setProperty('--orange', c, 'important');
  root.style.setProperty('--amber', c, 'important');
}
applyThemeToModule();
window.addEventListener('storage', (e) => {
  if (e.key === 'rom-palette' || e.key === 'rom-theme' || e.key === null) applyThemeToModule();
});

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
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
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) origRemove(k);
  }
}
function applyKeys(keys) {
  applyingRemote = true;
  clearLocal();
  for (const [k, v] of Object.entries(keys || {})) origSet(k, v);
  applyingRemote = false;
}
function scheduleSave() {
  // Anti-clobber: never write until we've pulled + applied the remote state, so
  // a stale/empty tab can't overwrite what another tab already saved.
  if (!ref || !syncReady) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try { await setDoc(ref, { keys: collectLocal(), updatedAt: serverTimestamp() }); }
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
        applyKeys(snap.data().keys);
      } else {
        // First time on this workspace doc. Migrate the legacy global doc ONCE
        // (into whichever workspace loads first), then delete it so every other
        // workspace starts empty and stays isolated — installing an app in one
        // workspace no longer makes it appear in all of them.
        const legacy = await getDoc(legacyRef);
        if (legacy.exists() && Object.keys(legacy.data().keys || {}).length) {
          applyKeys(legacy.data().keys);
          await setDoc(ref, { keys: legacy.data().keys, updatedAt: serverTimestamp() });
          try { await deleteDoc(legacyRef); } catch (e) { /* best effort */ }
        } else {
          clearLocal(); // don't inherit another workspace's data from this browser
        }
      }
    } catch (e) { console.warn('[ROM] workspace seed failed', e); }
    syncReady = true; // safe to persist local edits now

    onSnapshot(ref, (snap) => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      const remote = JSON.stringify(snap.data().keys || {});
      if (remote === JSON.stringify(collectLocal())) return;
      applyKeys(snap.data().keys);
      location.reload();
    });
  }

  await import(MODULE_ENTRY);
  applyThemeToModule();
  try { window.parent.postMessage({ type: 'rom-ws-ready' }, window.location.origin); } catch { /* ignore */ }
}

boot();
