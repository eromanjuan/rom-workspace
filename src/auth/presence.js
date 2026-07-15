// Online/offline presence, Firestore-only (no Realtime Database needed).
//
// The signed-in user writes a heartbeat (`online:true` + `lastActive`) to their
// own users/{uid} doc every 30s and marks `online:false` when the tab closes.
// A closed/crashed tab can't always write the offline flag, so a reader treats
// anyone whose last heartbeat is older than STALE_MS as offline regardless.
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { timeAgo } from '../ui/dom.js';

const HEARTBEAT_MS = 30000;
export const STALE_MS = 70000; // no heartbeat within this window ⇒ offline

// Begin heartbeating for `uid`. Returns a stop() that also marks offline.
export function startPresence(uid) {
  if (!uid || !db) return () => {};
  const write = (online) => setDoc(doc(db, 'users', uid), { online, lastActive: serverTimestamp() }, { merge: true }).catch(() => {});
  write(true);
  const timer = setInterval(() => write(true), HEARTBEAT_MS);
  const goOffline = () => write(false);
  // pagehide fires on tab close / navigation / mobile background more reliably
  // than beforeunload; keep both for coverage.
  window.addEventListener('pagehide', goOffline);
  window.addEventListener('beforeunload', goOffline);
  return () => {
    clearInterval(timer);
    window.removeEventListener('pagehide', goOffline);
    window.removeEventListener('beforeunload', goOffline);
    write(false);
  };
}

// Milliseconds of a Firestore Timestamp | Date | seconds-object, or 0.
function lastActiveMs(profile) {
  const t = profile && profile.lastActive;
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (t instanceof Date) return t.getTime();
  return 0;
}

export function isOnline(profile) {
  if (!profile || profile.online !== true) return false;
  const t = lastActiveMs(profile);
  return t > 0 && (Date.now() - t) < STALE_MS;
}

// The Date of the last heartbeat, or null if never seen.
export function lastActiveDate(profile) {
  const t = lastActiveMs(profile);
  return t > 0 ? new Date(t) : null;
}

// Exact wording for a hover tooltip: "Online now" / "Last active <full date>".
export function presenceExact(profile) {
  if (isOnline(profile)) return 'Online now';
  const d = lastActiveDate(profile);
  return d ? `Last active ${d.toLocaleString()}` : 'Offline';
}

// Human label: "Online", "Last seen 5m ago", or "Offline".
export function presenceText(profile) {
  if (isOnline(profile)) return 'Online';
  const t = lastActiveMs(profile);
  return t > 0 ? `Last seen ${timeAgo(new Date(t))}` : 'Offline';
}
