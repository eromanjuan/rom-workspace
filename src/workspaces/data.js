// Firestore data access for workspaces, members, invites, apps and records.
import {
  collection, collectionGroup, doc, addDoc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, db, storage } from '../firebase.js';
import { isMaster, hasWritePerm } from './roles.js';
import { viewerIsPro } from '../monetize.js';
import { ensureWorkspaceConversation, addWorkspaceConversationMember, removeWorkspaceConversationMember, renameWorkspaceConversation } from '../messages/messagesData.js';

// How many workspaces a user owns. Free accounts are capped at 1; Pro (and
// master, who is always Pro) are unlimited. Used to enforce the plan limit.
export async function countOwnedWorkspaces(uid) {
  try {
    const snap = await getDocs(query(collection(db, 'workspaces'), where('ownerId', '==', uid)));
    return snap.size;
  } catch { return 0; }
}

// Thrown by createWorkspace when a Free account is already at its 1-workspace cap.
export const FREE_WORKSPACE_LIMIT = 'free-workspace-limit';

// Broadcast so mounted views (Settings, Profile, the Workspace tab) refresh
// their workspace lists instantly without a page reload.
function workspacesChanged() { try { window.dispatchEvent(new Event('rom-workspaces-changed')); } catch { /* ignore */ } }

// --- workspaces ---

// Create a workspace and make the caller its owner.
// NOTE: these two writes must be SEQUENTIAL, not a batch. The membership rule
// authorizes via get(workspace).ownerId, and get() can't see writes still
// pending in the same batch — so the workspace doc must be committed first.
// Accepts either a plain name (legacy) or an options object
// { name, description, icon, color, imageUrl }.
export async function createWorkspace(user, opts) {
  const o = typeof opts === 'string' ? { name: opts } : (opts || {});
  // Free plan: at most one owned workspace. Master accounts are always Pro so
  // this never trips for them. This is the hard backstop behind the UI gate.
  if (!viewerIsPro() && await countOwnedWorkspaces(user.uid) >= 1) {
    const e = new Error(FREE_WORKSPACE_LIMIT); e.code = FREE_WORKSPACE_LIMIT; throw e;
  }
  const wsRef = doc(collection(db, 'workspaces'));
  await setDoc(wsRef, {
    name: o.name,
    description: o.description || '',
    icon: o.icon || 'layout-dashboard',
    color: o.color || '#5b8cff',
    imageUrl: o.imageUrl || '',
    ownerId: user.uid,
    ownerName: user.displayName || user.email,
    createdAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'workspaces', wsRef.id, 'members', user.uid), {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email,
    role: 'owner',
    joinedAt: serverTimestamp(),
  });
  // Auto-create the workspace group chat (owner is the first member).
  await ensureWorkspaceConversation(wsRef.id, { uid: user.uid, name: user.displayName || user.email }, o.name);
  logActivity({ action: 'workspace.create', text: `Created workspace "${o.name}"`, workspaceId: wsRef.id, workspaceName: o.name });
  workspacesChanged();
  return wsRef.id;
}

// Every workspace the user actually belongs to (via their own membership docs).
// This applies to the master account too — the master's profile/settings should
// only list workspaces they own or joined, NOT everyone else's. The master can
// still open any workspace it doesn't belong to (getMyRole grants 'owner' and the
// rules allow it) — e.g. from Search — it just isn't shown as "owned by me".
export async function listMyWorkspaces(uid) {
  const snap = await getDocs(query(collectionGroup(db, 'members'), where('uid', '==', uid)));
  const results = [];
  for (const m of snap.docs) {
    const wsRef = m.ref.parent.parent; // members/{uid} -> workspaces/{wsId}
    if (!wsRef) continue;
    const wsSnap = await getDoc(wsRef);
    if (wsSnap.exists()) {
      results.push({ id: wsRef.id, ...wsSnap.data(), myRole: m.data().role });
    }
  }
  return results;
}

export async function getWorkspace(wsId) {
  const snap = await getDoc(doc(db, 'workspaces', wsId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function renameWorkspace(wsId, name) {
  await updateDoc(doc(db, 'workspaces', wsId), { name });
  await renameWorkspaceConversation(wsId, name);
  workspacesChanged();
}

// Update workspace metadata (name/description/icon/color/imageUrl).
export async function updateWorkspace(wsId, patch) {
  await updateDoc(doc(db, 'workspaces', wsId), patch);
  if (patch && patch.name) await renameWorkspaceConversation(wsId, patch.name);
  const fields = Object.keys(patch || {}).join(', ');
  logActivity({ action: 'workspace.update', text: `Updated workspace settings (${fields})`, workspaceId: wsId, workspaceName: patch?.name || (await workspaceName(wsId)) });
  workspacesChanged();
}

// Set a member's role, and (for the 'custom' role) their permission set.
export async function setMemberRole(wsId, memberUid, role, perms) {
  const patch = { role };
  // Store a derived `writer` flag so firestore.rules can grant workspace writes to
  // a custom member who has any create/edit/interact capability.
  if (role === 'custom' && perms) { patch.perms = perms; patch.writer = hasWritePerm(perms); }
  else { patch.writer = role === 'owner' || role === 'editor'; }
  await updateDoc(doc(db, 'workspaces', wsId, 'members', memberUid), patch);
  logActivity({ action: 'member.role', text: `Changed a member's role to ${role}`, workspaceId: wsId, workspaceName: await workspaceName(wsId) });
}

// Delete a workspace. Remove other members first (so the owner keeps delete
// rights), then the workspace doc, then the owner's own membership last.
// (Feed/tiles/apps subcollections are left orphaned but become unreadable; a
// recursive cleanup would be a Cloud Function follow-up.)
export async function deleteWorkspace(wsId, ownerUid) {
  const name = await workspaceName(wsId);
  const members = await getDocs(collection(db, 'workspaces', wsId, 'members'));
  for (const m of members.docs) {
    if (m.id !== ownerUid) await deleteDoc(m.ref);
  }
  await deleteDoc(doc(db, 'workspaces', wsId));
  await deleteDoc(doc(db, 'workspaces', wsId, 'members', ownerUid));
  logActivity({ action: 'workspace.delete', text: `Deleted workspace "${name}"`, workspaceId: wsId, workspaceName: name });
  workspacesChanged();
}

// --- user profile + preferences ---

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function setCurrentWorkspace(uid, wsId) {
  await setDoc(doc(db, 'users', uid), { currentWorkspaceId: wsId }, { merge: true });
}

// The apps built inside a workspace live in the embedded module's synced blob
// (workspaceBuilder/{wsId}, a { keys: { <localStorage key>: <json string> } } map).
// Parse the app list out of it defensively so ROM can list them in the sidebar.
export async function listWorkspaceApps(wsId) {
  if (!wsId) return [];
  try {
    const snap = await getDoc(doc(db, 'workspaceBuilder', wsId));
    if (!snap.exists()) return [];
    const keys = snap.data().keys || {};
    const apps = []; const seen = new Set();
    for (const [k, v] of Object.entries(keys)) {
      // Current prefix, plus the pre-rename one (a workspace only migrates the
      // first time its dashboard is opened, so both can be in flight).
      if (!k.startsWith('romio_workspace_v1') && !k.startsWith('qhq_workspace_builder_v1')) continue;
      let blob; try { blob = JSON.parse(v); } catch { continue; }
      const spaces = Array.isArray(blob?.workspaces) ? blob.workspaces : [];
      for (const ws of spaces) {
        for (const app of (Array.isArray(ws?.apps) ? ws.apps : [])) {
          if (app && app.id && !seen.has(app.id)) {
            seen.add(app.id);
            apps.push({ id: app.id, name: app.name || 'Untitled app', color: app.color || '#e0552d' });
          }
        }
      }
    }
    return apps.sort((a, b) => a.name.localeCompare(b.name));
  } catch { return []; }
}

// --- activity log (audit trail) ---
// Every meaningful action (workspace/app/record create-update-delete, members,
// roles, invites) is recorded here with WHO did it. Written from ROM and, via the
// bridge helper, from the embedded workspace module too.
export async function logActivity(entry = {}) {
  const u = auth.currentUser;
  if (!u) return;
  try {
    await addDoc(collection(db, 'activityLog'), {
      actorId: u.uid,
      actorName: u.displayName || u.email || 'User',
      actorEmail: u.email || '',
      action: String(entry.action || 'activity').slice(0, 60),
      text: String(entry.text || '').slice(0, 400),
      workspaceId: entry.workspaceId || '',
      workspaceName: String(entry.workspaceName || '').slice(0, 120),
      createdAt: serverTimestamp(),
    });
  } catch { /* audit writes are best-effort — never block the action */ }
}
// Live activity feed. The master sees everything; anyone else sees their own.
// (The "mine" query avoids orderBy so it needs no composite index — sorted client-side.)
export function listenActivity(cb, { all = false, uid = null, max = 300 } = {}) {
  const base = collection(db, 'activityLog');
  const q = all
    ? query(base, orderBy('createdAt', 'desc'), limit(max))
    : query(base, where('actorId', '==', uid || '__none__'), limit(max));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (!all) rows.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      cb(rows);
    },
    () => cb([]),
  );
}

// --- bug reports / feedback ---
export async function submitReport({ type, message }) {
  const u = auth.currentUser;
  return addDoc(collection(db, 'reports'), {
    type: type === 'feedback' ? 'feedback' : 'bug',
    message: String(message || '').slice(0, 4000),
    fromUid: u?.uid || '',
    fromName: u?.displayName || u?.email || 'User',
    fromEmail: u?.email || '',
    page: (typeof location !== 'undefined' ? location.pathname : '') || '',
    status: 'open',
    createdAt: serverTimestamp(),
  });
}
// Live inbox of every report (master only). Newest first.
export function listenReports(cb) {
  return onSnapshot(
    query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(200)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  );
}
export async function setReportStatus(id, status) {
  await updateDoc(doc(db, 'reports', id), { status, resolvedAt: status === 'resolved' ? serverTimestamp() : null });
}
export async function deleteReport(id) { await deleteDoc(doc(db, 'reports', id)); }

// Master-only: search across ALL chat messages (collection-group). No text index
// in Firestore, so fetch a recent slice and filter client-side.
export async function adminSearchMessages(term) {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return [];
  try {
    const snap = await getDocs(query(collectionGroup(db, 'messages'), limit(500)));
    return snap.docs
      .map((d) => ({ id: d.id, convId: d.ref.parent.parent?.id || '', ...d.data() }))
      .filter((m) => (m.text || '').toLowerCase().includes(q))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      .slice(0, 50);
  } catch { return []; }
}

// Merge arbitrary profile fields (displayName, phone, ...) onto users/{uid}.
export async function updateUserProfile(uid, patch) {
  await setDoc(doc(db, 'users', uid), patch, { merge: true });
}

// --- usernames (unique handles) ---
// Uniqueness is enforced by a dedicated `usernames/{handle}` collection: the doc
// id IS the lowercased handle, so a create can only succeed once. Availability
// is a public read (used pre-signup while unauthenticated).
export function normalizeUsername(username) {
  return (username || '').trim().toLowerCase();
}

// Basic format check: 3–20 chars, letters/numbers/underscore, must start with a letter.
export function usernameFormatError(username) {
  const u = (username || '').trim();
  if (u.length < 3) return 'At least 3 characters';
  if (u.length > 20) return 'At most 20 characters';
  if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(u)) return 'Letters, numbers, underscore; start with a letter';
  return null;
}

export async function isUsernameAvailable(username) {
  const handle = normalizeUsername(username);
  if (!handle) return false;
  const snap = await getDoc(doc(db, 'usernames', handle));
  return !snap.exists();
}

// Reserve a handle for a signed-in user. Throws if it's already taken (the
// create fails because the doc id already exists). The email is stored so login
// can resolve a username → email (Firebase Auth only signs in by email).
export async function reserveUsername(uid, username, email) {
  const handle = normalizeUsername(username);
  const data = { uid, username: username.trim(), createdAt: serverTimestamp() };
  if (email) data.email = String(email).trim().toLowerCase();
  await setDoc(doc(db, 'usernames', handle), data);
}

// Move a user's handle: reserve the new one, then release the old.
export async function changeUsername(uid, oldUsername, newUsername, email) {
  await reserveUsername(uid, newUsername, email);
  const old = normalizeUsername(oldUsername);
  if (old && old !== normalizeUsername(newUsername)) {
    try { await deleteDoc(doc(db, 'usernames', old)); } catch { /* ignore */ }
  }
}

// The handle this user already owns (if any), by querying the reservations.
// Used to repair a profile that lost its `username` field but still holds the
// reservation — so we don't wrongly prompt them to pick a username again.
export async function findMyUsername(uid) {
  const snap = await getDocs(query(collection(db, 'usernames'), where('uid', '==', uid)));
  const d = snap.docs[0];
  return d ? (d.data().username || d.id) : null;
}

// Claim a handle for a user, idempotently: succeeds if it's free OR already
// owned by this user; throws only if someone else holds it.
export async function claimUsername(uid, username, email) {
  const handle = normalizeUsername(username);
  const ref = doc(db, 'usernames', handle);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    if (snap.data().uid !== uid) { const e = new Error('That username is taken.'); e.code = 'auth/username-taken'; throw e; }
    return; // already ours — nothing to reserve
  }
  const data = { uid, username: username.trim(), createdAt: serverTimestamp() };
  if (email) data.email = String(email).trim().toLowerCase();
  await setDoc(ref, data);
}

// Resolve a login identifier to an email address. If it already looks like an
// email it's returned as-is; otherwise it's treated as a username and looked up.
export async function emailForLogin(identifier) {
  const id = (identifier || '').trim();
  if (!id || id.includes('@')) return id;
  const snap = await getDoc(doc(db, 'usernames', normalizeUsername(id)));
  const data = snap.exists() ? snap.data() : null;
  return data && data.email ? data.email : null;
}

// --- master control panel (admin) ---
// Set an admin flag on any user (master-only, enforced by rules). Used for
// suspend/unsuspend and promote/demote master.
export async function adminSetUser(uid, patch) {
  await setDoc(doc(db, 'users', uid), patch, { merge: true });
}
// "Delete" a user: a client can't remove their Auth credential, so we ban them
// (blocked on login), strip their posts, and free their username.
export async function adminDeleteUser(u) {
  await setDoc(doc(db, 'users', u.uid), { deleted: true, suspended: true }, { merge: true });
  try {
    const snap = await getDocs(query(collection(db, 'posts'), where('authorId', '==', u.uid)));
    for (const d of snap.docs) { try { await deleteDoc(d.ref); } catch { /* ignore */ } }
  } catch { /* ignore */ }
  if (u.username) { try { await deleteDoc(doc(db, 'usernames', String(u.username).toLowerCase())); } catch { /* ignore */ } }
}

// All registered users (for searching people to add to a workspace).
export async function listAllUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

// Live single-user profile (used for presence — online/offline — and fresh name/photo).
export function listenUser(uid, onData, onError) {
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => onData(snap.exists() ? { uid: snap.id, ...snap.data() } : null),
    onError || (() => {}),
  );
}

// Owner adds a user to the workspace directly (no invite needed). Pass
// { notify: true } to tell the added user (approve-join sends its own notice).
export async function addMemberDirect(wsId, targetUser, role = 'viewer', opts = {}) {
  await setDoc(doc(db, 'workspaces', wsId, 'members', targetUser.uid), {
    uid: targetUser.uid,
    email: targetUser.email || '',
    displayName: targetUser.displayName || targetUser.email || 'Member',
    role,
    joinedAt: serverTimestamp(),
  });
  // Add them to the workspace group chat too.
  await addWorkspaceConversationMember(wsId, targetUser.uid, targetUser.displayName || targetUser.email || 'Member');
  logActivity({
    action: 'member.add',
    text: `Added ${targetUser.displayName || targetUser.email || 'a user'} as ${role}`,
    workspaceId: wsId, workspaceName: await workspaceName(wsId),
  });
  if (opts.notify) {
    await notify(targetUser.uid, {
      type: 'memberAdded',
      title: `You were added to ${await workspaceName(wsId)}`,
      actorId: auth.currentUser?.uid,
      link: { view: 'workspace' },
    });
  }
}

// A user's own posts from the global feed (sorted client-side to avoid a composite index).
export async function listMyPosts(uid) {
  const snap = await getDocs(query(collection(db, 'posts'), where('authorId', '==', uid)));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

// --- search / discovery ---

// Recent posts (newest first) for search; the caller filters by text/visibility.
export async function listRecentPosts(max = 200) {
  const snap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Every workspace's doc-level info (name/icon/owner) for discovery + search.
export async function listAllWorkspaces() {
  const snap = await getDocs(collection(db, 'workspaces'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- notifications ---
// Each user owns a notifications/{uid}/items subcollection. notify() appends one;
// the recipient sees it live in the bell. Writes are best-effort (never block the
// underlying action if a notification fails).
export async function notify(uid, payload) {
  if (!uid) return;
  try {
    await addDoc(collection(db, 'notifications', uid, 'items'), {
      read: false,
      createdAt: serverTimestamp(),
      ...payload,
    });
  } catch (e) { /* non-fatal */ }
}
// A notification you raise for YOURSELF (e.g. a calendar reminder). actorId must
// equal your own uid to satisfy the rules; safe to call for uid === your uid.
export async function addSelfNotification(uid, payload = {}) {
  if (!uid) return;
  try {
    await addDoc(collection(db, 'notifications', uid, 'items'), {
      read: false,
      createdAt: serverTimestamp(),
      type: payload.type || 'reminder',
      actorId: uid,
      actorName: payload.actorName || 'Reminder',
      title: String(payload.title || 'Reminder').slice(0, 300),
      body: String(payload.body || '').slice(0, 500),
      link: payload.link || { view: 'calendar' },
    });
  } catch (e) { /* non-fatal */ }
}
export function listenNotifications(uid, cb, max = 30) {
  return onSnapshot(
    query(collection(db, 'notifications', uid, 'items'), orderBy('createdAt', 'desc'), limit(max)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  );
}
export async function markNotificationRead(uid, id) {
  try { await updateDoc(doc(db, 'notifications', uid, 'items', id), { read: true }); } catch { /* ignore */ }
}
export async function markAllNotificationsRead(uid, ids) {
  await Promise.all((ids || []).map((id) => updateDoc(doc(db, 'notifications', uid, 'items', id), { read: true }).catch(() => {})));
}
async function workspaceName(wsId) {
  try { const ws = await getDoc(doc(db, 'workspaces', wsId)); return ws.exists() ? (ws.data().name || 'the workspace') : 'the workspace'; } catch { return 'the workspace'; }
}

// --- join requests (user asks to join a workspace; the owner approves) ---
export async function requestToJoin(wsId, user) {
  await setDoc(doc(db, 'workspaces', wsId, 'joinRequests', user.uid), {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || user.email || 'User',
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  // Notify the workspace owner that someone wants to join.
  try {
    const ws = await getDoc(doc(db, 'workspaces', wsId));
    if (ws.exists() && ws.data().ownerId) {
      await notify(ws.data().ownerId, {
        type: 'joinRequest',
        title: `${user.displayName || user.email || 'Someone'} asked to join ${ws.data().name || 'your workspace'}`,
        actorId: user.uid, actorName: user.displayName || user.email || 'User',
        link: { view: 'workspace' },
      });
    }
  } catch { /* ignore */ }
}
export async function getMyJoinRequest(wsId, uid) {
  const snap = await getDoc(doc(db, 'workspaces', wsId, 'joinRequests', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
export async function cancelJoinRequest(wsId, uid) {
  await deleteDoc(doc(db, 'workspaces', wsId, 'joinRequests', uid));
}
export async function listJoinRequests(wsId) {
  const snap = await getDocs(collection(db, 'workspaces', wsId, 'joinRequests'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function approveJoinRequest(wsId, req, role = 'viewer') {
  await addMemberDirect(wsId, { uid: req.uid, email: req.email, displayName: req.displayName }, role);
  await deleteDoc(doc(db, 'workspaces', wsId, 'joinRequests', req.uid));
  await notify(req.uid, {
    type: 'joinApproved',
    title: `You were approved to join ${await workspaceName(wsId)}`,
    actorId: auth.currentUser?.uid,
    link: { view: 'workspace' },
  });
}
export async function declineJoinRequest(wsId, reqUid) {
  await deleteDoc(doc(db, 'workspaces', wsId, 'joinRequests', reqUid));
  logActivity({ action: 'join.decline', text: 'Declined a join request', workspaceId: wsId, workspaceName: await workspaceName(wsId) });
  await notify(reqUid, {
    type: 'joinDeclined',
    title: `Your request to join ${await workspaceName(wsId)} was declined`,
    actorId: auth.currentUser?.uid,
    link: { view: 'feed' },
  });
}

// --- uploaded files (Storage blob + Firestore metadata) ---

const safeName = (n) => String(n).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);

export async function uploadFile(user, file) {
  const path = `files/${user.uid}/${Date.now()}_${safeName(file.name)}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });
  const url = await getDownloadURL(storageRef);
  return addDoc(collection(db, 'files'), {
    ownerId: user.uid,
    ownerName: user.displayName || user.email,
    name: file.name,
    size: file.size,
    type: file.type || '',
    path,
    url,
    createdAt: serverTimestamp(),
  });
}

// Files kept in Trash this long before they're auto-purged.
export const TRASH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The user's live (non-trashed) files (master sees all). Sorted client-side.
export async function listFiles(uid) {
  const q = isMaster(auth.currentUser)
    ? collection(db, 'files')
    : query(collection(db, 'files'), where('ownerId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((f) => !f.deleted)
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

// Files currently in Trash (owner, or master sees all). Newest-deleted first.
export async function listTrashedFiles(uid) {
  const q = isMaster(auth.currentUser)
    ? collection(db, 'files')
    : query(collection(db, 'files'), where('ownerId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((f) => f.deleted)
    .sort((a, b) => (b.deletedAt?.toMillis?.() || 0) - (a.deletedAt?.toMillis?.() || 0));
}

// Soft-delete: move a file to Trash (kept 30 days, then auto-purged).
export async function deleteFile(fileDoc) {
  await updateDoc(doc(db, 'files', fileDoc.id), { deleted: true, deletedAt: serverTimestamp() });
}

// Restore a file out of Trash.
export async function restoreFile(fileDoc) {
  await updateDoc(doc(db, 'files', fileDoc.id), { deleted: false, deletedAt: null });
}

// Permanently delete: remove the Storage blob + the Firestore metadata doc.
export async function permanentlyDeleteFile(fileDoc) {
  try { if (fileDoc.path) await deleteObject(ref(storage, fileDoc.path)); } catch { /* blob may already be gone */ }
  await deleteDoc(doc(db, 'files', fileDoc.id));
}

// Auto-purge trashed files older than the TTL (best-effort, runs client-side
// when Trash/Files is opened, since there's no server cron).
export async function purgeExpiredTrash(uid) {
  const cutoff = Date.now() - TRASH_TTL_MS;
  let items;
  try { items = await listTrashedFiles(uid); } catch { return 0; }
  let purged = 0;
  for (const f of items) {
    const t = f.deletedAt?.toMillis?.() || 0;
    if (t && t < cutoff) { try { await permanentlyDeleteFile(f); purged += 1; } catch { /* ignore */ } }
  }
  return purged;
}

// Upload a workspace icon image (readable by all members). Returns the download URL.
export async function uploadWorkspaceImage(user, file) {
  const path = `workspace-images/${user.uid}/${Date.now()}_${safeName(file.name)}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file, { contentType: file.type || 'image/png' });
  return getDownloadURL(storageRef);
}

// --- generic per-WORKSPACE subcollections (shared calendar events, checklists) ---

export function addWsDoc(wsId, sub, data, createdBy) {
  return addDoc(collection(db, 'workspaces', wsId, sub), { ...data, createdBy, createdAt: serverTimestamp() });
}
export function subscribeWsDocs(wsId, sub, onData, onError) {
  return onSnapshot(collection(db, 'workspaces', wsId, sub), (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}
export async function listWsDocs(wsId, sub) {
  const snap = await getDocs(collection(db, 'workspaces', wsId, sub));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function updateWsDoc(wsId, sub, id, patch) {
  await updateDoc(doc(db, 'workspaces', wsId, sub, id), patch);
}
export async function deleteWsDoc(wsId, sub, id) {
  await deleteDoc(doc(db, 'workspaces', wsId, sub, id));
}

// --- generic per-user subcollections (tools: events, checklists, notes, widgets) ---

export function addUserDoc(uid, sub, data) {
  return addDoc(collection(db, 'users', uid, sub), { ...data, createdAt: serverTimestamp() });
}
export async function listUserDocs(uid, sub) {
  const snap = await getDocs(collection(db, 'users', uid, sub));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export function subscribeUserDocs(uid, sub, onData, onError) {
  return onSnapshot(collection(db, 'users', uid, sub), (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}
export async function updateUserDoc(uid, sub, id, patch) {
  await updateDoc(doc(db, 'users', uid, sub, id), patch);
}
export async function deleteUserDoc(uid, sub, id) {
  await deleteDoc(doc(db, 'users', uid, sub, id));
}

// --- profile widgets (customizable) ---

export async function addWidget(uid, { title, body }) {
  return addDoc(collection(db, 'users', uid, 'widgets'), {
    title: title || 'Note', body: body || '', createdAt: serverTimestamp(),
  });
}

export function subscribeWidgets(uid, onData, onError) {
  const q = query(collection(db, 'users', uid, 'widgets'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function updateWidget(uid, widgetId, patch) {
  await updateDoc(doc(db, 'users', uid, 'widgets', widgetId), patch);
}

export async function deleteWidget(uid, widgetId) {
  await deleteDoc(doc(db, 'users', uid, 'widgets', widgetId));
}

// --- members ---

export async function listMembers(wsId) {
  const snap = await getDocs(collection(db, 'workspaces', wsId, 'members'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getMyRole(wsId, uid) {
  // Master account is treated as owner in every workspace, member or not.
  if (isMaster(auth.currentUser)) return 'owner';
  const snap = await getDoc(doc(db, 'workspaces', wsId, 'members', uid));
  return snap.exists() ? snap.data().role : null;
}

export async function changeMemberRole(wsId, memberUid, role) {
  await updateDoc(doc(db, 'workspaces', wsId, 'members', memberUid), { role });
}

export async function removeMember(wsId, memberUid) {
  await deleteDoc(doc(db, 'workspaces', wsId, 'members', memberUid));
  await removeWorkspaceConversationMember(wsId, memberUid);
  logActivity({ action: 'member.remove', text: 'Removed a member from the workspace', workspaceId: wsId, workspaceName: await workspaceName(wsId) });
}

// --- invites ---

export async function createInvite(wsId, email, role, invitedBy) {
  const ref = await addDoc(collection(db, 'invites'), {
    workspaceId: wsId,
    email: email.toLowerCase().trim(),
    role,
    status: 'pending',
    invitedBy,
    createdAt: serverTimestamp(),
  });
  logActivity({ action: 'invite.create', text: `Invited ${email.toLowerCase().trim()} as ${role}`, workspaceId: wsId, workspaceName: await workspaceName(wsId) });
  return ref.id;
}

export async function listInvites(wsId) {
  const snap = await getDocs(query(collection(db, 'invites'), where('workspaceId', '==', wsId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getInvite(inviteId) {
  const snap = await getDoc(doc(db, 'invites', inviteId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function revokeInvite(inviteId) {
  await deleteDoc(doc(db, 'invites', inviteId));
}

// Accept an invite: create your own membership (with the invite's role) then mark it accepted.
export async function acceptInvite(user, invite) {
  await setDoc(doc(db, 'workspaces', invite.workspaceId, 'members', user.uid), {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName || user.email,
    role: invite.role,
    inviteId: invite.id,
    joinedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'invites', invite.id), { status: 'accepted' });
}

// --- workspace activity feed ---

export async function addFeedPost(wsId, { mode, text, url, isTask }, user) {
  return addDoc(collection(db, 'workspaces', wsId, 'feed'), {
    mode: mode || 'post',
    text: text || '',
    url: url || null,
    isTask: !!isTask,
    authorId: user.uid,
    authorName: user.displayName || user.email,
    createdAt: serverTimestamp(),
  });
}

// Live subscription to a workspace's feed (newest first). Returns the unsubscribe fn.
export function subscribeFeed(wsId, onData, onError) {
  const q = query(collection(db, 'workspaces', wsId, 'feed'), orderBy('createdAt', 'desc'), limit(50));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  );
}

export async function deleteFeedPost(wsId, postId) {
  await deleteDoc(doc(db, 'workspaces', wsId, 'feed', postId));
}

// --- dashboard tiles (no-code dashboard) ---

export async function addTile(wsId, { type, title, body }, createdBy) {
  return addDoc(collection(db, 'workspaces', wsId, 'tiles'), {
    type,                       // 'text' | 'tasks' | 'report'
    title: title || '',
    body: body || '',
    createdBy,
    createdAt: serverTimestamp(),
  });
}

export function subscribeTiles(wsId, onData, onError) {
  const q = query(collection(db, 'workspaces', wsId, 'tiles'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function updateTile(wsId, tileId, patch) {
  await updateDoc(doc(db, 'workspaces', wsId, 'tiles', tileId), patch);
}

export async function deleteTile(wsId, tileId) {
  await deleteDoc(doc(db, 'workspaces', wsId, 'tiles', tileId));
}

// --- workspace tasks (Tasks tile) ---

export async function addTask(wsId, title, createdBy) {
  return addDoc(collection(db, 'workspaces', wsId, 'tasks'), {
    title, done: false, createdBy, createdAt: serverTimestamp(),
  });
}

export function subscribeTasks(wsId, onData, onError) {
  const q = query(collection(db, 'workspaces', wsId, 'tasks'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function toggleTask(wsId, taskId, done) {
  await updateDoc(doc(db, 'workspaces', wsId, 'tasks', taskId), { done });
}

export async function deleteTask(wsId, taskId) {
  await deleteDoc(doc(db, 'workspaces', wsId, 'tasks', taskId));
}

// Record counts per app — powers the Report tile.
export async function appRecordCounts(wsId) {
  const apps = await listApps(wsId);
  const out = [];
  for (const app of apps) {
    const snap = await getDocs(collection(db, 'workspaces', wsId, 'apps', app.id, 'records'));
    out.push({ id: app.id, name: app.name, icon: app.icon || 'apps', count: snap.size });
  }
  return out;
}

// --- app builder: apps + records ---

export async function createApp(wsId, { name, description, type, icon, color, fields, reports, automations }, createdBy) {
  const ref = await addDoc(collection(db, 'workspaces', wsId, 'apps'), {
    name,
    description: description || '',
    type: type || '',
    icon: icon || 'apps',
    color: color || '#e0552d',
    fields: fields || [], // [{ key, label, type, config? }]
    reports: reports || [],
    automations: automations || [],
    createdBy,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// --- ROM App Market (shared app definitions) ---

export async function publishToMarket(user, definition) {
  return addDoc(collection(db, 'appMarket'), {
    ...definition,
    publishedBy: user.uid,
    publisherName: user.displayName || user.email,
    publishedAt: serverTimestamp(),
  });
}

export async function listMarketApps() {
  const snap = await getDocs(collection(db, 'appMarket'));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.publishedAt?.toMillis?.() || 0) - (a.publishedAt?.toMillis?.() || 0));
}

export async function unpublishMarketApp(id) {
  await deleteDoc(doc(db, 'appMarket', id));
}

// Update app metadata (name, description, icon, color) or its fields array.
export async function updateApp(wsId, appId, patch) {
  await updateDoc(doc(db, 'workspaces', wsId, 'apps', appId), patch);
}

export async function listApps(wsId) {
  const snap = await getDocs(
    query(collection(db, 'workspaces', wsId, 'apps'), orderBy('createdAt', 'asc')),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getApp(wsId, appId) {
  const snap = await getDoc(doc(db, 'workspaces', wsId, 'apps', appId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function deleteApp(wsId, appId) {
  await deleteDoc(doc(db, 'workspaces', wsId, 'apps', appId));
}

export async function addRecord(wsId, appId, values, createdBy) {
  const ref = await addDoc(collection(db, 'workspaces', wsId, 'apps', appId, 'records'), {
    values,
    createdBy,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listRecords(wsId, appId) {
  const snap = await getDocs(
    query(collection(db, 'workspaces', wsId, 'apps', appId, 'records'), orderBy('createdAt', 'desc')),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteRecord(wsId, appId, recordId) {
  await deleteDoc(doc(db, 'workspaces', wsId, 'apps', appId, 'records', recordId));
}
