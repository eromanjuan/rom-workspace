// Chat data layer: conversations (direct + workspace groups) and their messages.
// A direct conversation has a deterministic id (dm_<sorted-uids>) so a pair can
// only ever have one. A workspace group has id ws_<workspaceId> and its members
// track the workspace membership. Kept separate from workspaces/data.js so that
// file can import these helpers without a cycle.
import {
  collection, doc, setDoc, getDoc, updateDoc, addDoc, onSnapshot,
  query, where, orderBy, limit, serverTimestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { db } from '../firebase.js';

export function dmId(a, b) { return `dm_${[a, b].sort().join('_')}`; }
export function wsConvId(wsId) { return `ws_${wsId}`; }

// Create (if needed) the direct conversation between two users; returns its id.
export async function ensureDirectConversation(me, other) {
  const id = dmId(me.uid, other.uid);
  const ref = doc(db, 'conversations', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type: 'direct',
      members: [me.uid, other.uid],
      memberNames: { [me.uid]: me.name || '', [other.uid]: other.name || '' },
      memberPhotos: { [me.uid]: me.photoURL || '', [other.uid]: other.photoURL || '' },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: null,
    });
  }
  return id;
}

// Create the group conversation for a workspace (owner is the first member).
export async function ensureWorkspaceConversation(wsId, owner, wsName) {
  const ref = doc(db, 'conversations', wsConvId(wsId));
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      type: 'group',
      workspaceId: wsId,
      name: wsName || 'Workspace',
      members: [owner.uid],
      memberNames: { [owner.uid]: owner.name || '' },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: null,
    });
  }
  return wsConvId(wsId);
}
export async function addWorkspaceConversationMember(wsId, uid, name) {
  try { await updateDoc(doc(db, 'conversations', wsConvId(wsId)), { members: arrayUnion(uid), [`memberNames.${uid}`]: name || '' }); } catch { /* group may not exist yet */ }
}
export async function removeWorkspaceConversationMember(wsId, uid) {
  try { await updateDoc(doc(db, 'conversations', wsConvId(wsId)), { members: arrayRemove(uid) }); } catch { /* ignore */ }
}
export async function renameWorkspaceConversation(wsId, name) {
  try { await updateDoc(doc(db, 'conversations', wsConvId(wsId)), { name }); } catch { /* ignore */ }
}

// Live list of my conversations (sorted client-side to avoid a composite index).
export function listenConversations(uid, cb) {
  return onSnapshot(
    query(collection(db, 'conversations'), where('members', 'array-contains', uid)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))),
    () => cb([]),
  );
}
export async function getConversation(convId) {
  const s = await getDoc(doc(db, 'conversations', convId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
export function listenMessages(convId, cb, max = 300) {
  return onSnapshot(
    query(collection(db, 'conversations', convId, 'messages'), orderBy('createdAt', 'asc'), limit(max)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  );
}
export async function sendMessage(convId, user, text) {
  const t = (text || '').trim();
  if (!t) return;
  const name = user.displayName || user.email || 'You';
  await addDoc(collection(db, 'conversations', convId, 'messages'), {
    senderId: user.uid, senderName: name, text: t, createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'conversations', convId), {
    updatedAt: serverTimestamp(),
    lastMessage: { text: t.slice(0, 140), senderId: user.uid, senderName: name },
  }).catch(() => {});
}
