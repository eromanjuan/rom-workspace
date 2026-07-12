// Firestore data access for workspaces, members, invites, apps and records.
import {
  collection, collectionGroup, doc, addDoc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { auth, db, storage } from '../firebase.js';
import { isMaster } from './roles.js';

// --- workspaces ---

// Create a workspace and make the caller its owner.
// NOTE: these two writes must be SEQUENTIAL, not a batch. The membership rule
// authorizes via get(workspace).ownerId, and get() can't see writes still
// pending in the same batch — so the workspace doc must be committed first.
// Accepts either a plain name (legacy) or an options object
// { name, description, icon, color, imageUrl }.
export async function createWorkspace(user, opts) {
  const o = typeof opts === 'string' ? { name: opts } : (opts || {});
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
  return wsRef.id;
}

// Every workspace the user belongs to (via their membership docs across all workspaces).
// The master account sees every workspace, always as owner.
export async function listMyWorkspaces(uid) {
  if (isMaster(auth.currentUser)) {
    const all = await getDocs(collection(db, 'workspaces'));
    return all.docs.map((d) => ({ id: d.id, ...d.data(), myRole: 'owner' }));
  }
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
}

// Update workspace metadata (name/description/icon/color/imageUrl).
export async function updateWorkspace(wsId, patch) {
  await updateDoc(doc(db, 'workspaces', wsId), patch);
}

// Set a member's role, and (for the 'custom' role) their permission set.
export async function setMemberRole(wsId, memberUid, role, perms) {
  const patch = { role };
  if (role === 'custom' && perms) patch.perms = perms;
  await updateDoc(doc(db, 'workspaces', wsId, 'members', memberUid), patch);
}

// Delete a workspace. Remove other members first (so the owner keeps delete
// rights), then the workspace doc, then the owner's own membership last.
// (Feed/tiles/apps subcollections are left orphaned but become unreadable; a
// recursive cleanup would be a Cloud Function follow-up.)
export async function deleteWorkspace(wsId, ownerUid) {
  const members = await getDocs(collection(db, 'workspaces', wsId, 'members'));
  for (const m of members.docs) {
    if (m.id !== ownerUid) await deleteDoc(m.ref);
  }
  await deleteDoc(doc(db, 'workspaces', wsId));
  await deleteDoc(doc(db, 'workspaces', wsId, 'members', ownerUid));
}

// --- user profile + preferences ---

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function setCurrentWorkspace(uid, wsId) {
  await setDoc(doc(db, 'users', uid), { currentWorkspaceId: wsId }, { merge: true });
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
// create fails because the doc id already exists).
export async function reserveUsername(uid, username) {
  const handle = normalizeUsername(username);
  await setDoc(doc(db, 'usernames', handle), { uid, username: username.trim(), createdAt: serverTimestamp() });
}

// Move a user's handle: reserve the new one, then release the old.
export async function changeUsername(uid, oldUsername, newUsername) {
  await reserveUsername(uid, newUsername);
  const old = normalizeUsername(oldUsername);
  if (old && old !== normalizeUsername(newUsername)) {
    try { await deleteDoc(doc(db, 'usernames', old)); } catch { /* ignore */ }
  }
}

// All registered users (for searching people to add to a workspace).
export async function listAllUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

// Owner adds a user to the workspace directly (no invite needed).
export async function addMemberDirect(wsId, targetUser, role = 'viewer') {
  await setDoc(doc(db, 'workspaces', wsId, 'members', targetUser.uid), {
    uid: targetUser.uid,
    email: targetUser.email || '',
    displayName: targetUser.displayName || targetUser.email || 'Member',
    role,
    joinedAt: serverTimestamp(),
  });
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

// --- join requests (user asks to join a workspace; the owner approves) ---
export async function requestToJoin(wsId, user) {
  await setDoc(doc(db, 'workspaces', wsId, 'joinRequests', user.uid), {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || user.email || 'User',
    status: 'pending',
    createdAt: serverTimestamp(),
  });
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
}
export async function declineJoinRequest(wsId, reqUid) {
  await deleteDoc(doc(db, 'workspaces', wsId, 'joinRequests', reqUid));
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

// The user's files (master sees all). Sorted client-side (no composite index).
export async function listFiles(uid) {
  const q = isMaster(auth.currentUser)
    ? collection(db, 'files')
    : query(collection(db, 'files'), where('ownerId', '==', uid));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

export async function deleteFile(fileDoc) {
  try { await deleteObject(ref(storage, fileDoc.path)); } catch { /* blob may already be gone */ }
  await deleteDoc(doc(db, 'files', fileDoc.id));
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
