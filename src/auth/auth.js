// Authentication: email/password sign up, log in, log out, and the user profile doc.
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  sendEmailVerification,
  reload,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  verifyBeforeUpdateEmail,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { checkPassword } from './passwordPolicy.js';
import { reserveUsername } from '../workspaces/data.js';

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signUp({ firstName, lastName, username, email, password }) {
  // Enforce the password policy before hitting Firebase.
  const { valid, firstError } = checkPassword(password);
  if (!valid) {
    const err = new Error(`Password needs: ${firstError}.`);
    err.code = 'auth/weak-password-policy';
    throw err;
  }
  const first = (firstName || '').trim();
  const last = (lastName || '').trim();
  const displayName = [first, last].filter(Boolean).join(' ') || (username || '').trim() || email.split('@')[0];

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });

  // Reserve the handle (now that we're authenticated). If it was taken in a
  // race, keep the account but leave the handle empty — settable in Settings.
  let handle = (username || '').trim();
  if (handle) {
    try { await reserveUsername(cred.user.uid, handle); }
    catch { handle = ''; }
  }

  // Send the verification email; the app gates access until it's confirmed.
  await sendEmailVerification(cred.user);
  await ensureProfile(cred.user, { firstName: first, lastName: last, username: handle, displayName });
  return cred.user;
}

// Re-send the verification email for the currently signed-in user.
export async function resendVerification() {
  if (auth.currentUser) await sendEmailVerification(auth.currentUser);
}

// Ask Firebase for the latest user state (used to detect that email is now verified).
export async function refreshUser() {
  if (auth.currentUser) {
    await reload(auth.currentUser);
    return auth.currentUser;
  }
  return null;
}

export async function logIn({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  await ensureProfile(cred.user);
  return cred.user;
}

export function logOut() {
  return signOut(auth);
}

// Create the users/{uid} profile doc on first sign-in if it does not exist yet.
// `extra` may carry { firstName, lastName, username, displayName } from sign-up.
export async function ensureProfile(user, extra) {
  const e = extra && typeof extra === 'object' ? extra : {};
  const ref = doc(db, 'users', user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email,
      displayName: e.displayName || user.displayName || user.email.split('@')[0],
      firstName: e.firstName || '',
      lastName: e.lastName || '',
      username: e.username || '',
      createdAt: serverTimestamp(),
    });
  }
  return ref;
}

export function displayNameOf(user) {
  return user?.displayName || user?.email?.split('@')[0] || 'User';
}

// Update the signed-in user's display name.
export async function changeName(name) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  await updateProfile(user, { displayName: name });
}

// Change email with verification: Firebase sends a confirmation link to the NEW
// address and only switches the login email after the user clicks it. Requires a
// recent login, so we re-authenticate with the current password first.
export async function changeEmailAddress(currentPassword, newEmail) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await verifyBeforeUpdateEmail(user, newEmail);
}

// Email the user a password-reset link (the email-verification path for changing a password).
export async function sendPasswordReset(email) {
  await sendPasswordResetEmail(auth, email || auth.currentUser?.email);
}

// Change the signed-in user's password, enforcing the same policy as sign-up.
// Firebase requires a recent login; we re-authenticate with the current password.
export async function changePassword(currentPassword, newPassword) {
  const { valid, firstError } = checkPassword(newPassword);
  if (!valid) { const e = new Error(`Password needs: ${firstError}.`); e.code = 'auth/weak-password-policy'; throw e; }
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}
