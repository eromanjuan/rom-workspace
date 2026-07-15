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
// Firebase Storage isn't enabled on this project, so a chat attachment is stored
// inline as a data URL on the message doc (like the feed composer). Firestore
// caps a doc at 1 MB, so the picked file is size-capped before it gets here.
export const MAX_ATTACHMENT_BYTES = 800 * 1024; // ~800 KB, leaves headroom under 1 MB

// `enc`, when present, is { algo, cipher } for an end-to-end encrypted message.
// The plaintext is never stored — only the ciphertext and the algorithm id.
export async function sendMessage(convId, user, text, { attachment = null, enc = null } = {}) {
  const t = (text || '').trim();
  if (!t && !attachment && !enc) return;
  const name = user.displayName || user.email || 'You';
  const msg = { senderId: user.uid, senderName: name, text: enc ? '' : t, createdAt: serverTimestamp() };
  if (attachment) msg.attachment = attachment;
  if (enc) { msg.encrypted = true; msg.encAlgo = enc.algo; msg.cipher = enc.cipher; }
  await addDoc(collection(db, 'conversations', convId, 'messages'), msg);
  // Never leak plaintext into the conversation-list preview.
  const preview = enc ? 'Encrypted message' : (t || (attachment ? `Attachment: ${attachment.name}` : ''));
  await updateDoc(doc(db, 'conversations', convId), {
    updatedAt: serverTimestamp(),
    lastMessage: { text: preview.slice(0, 140), senderId: user.uid, senderName: name },
  }).catch(() => {});
}
