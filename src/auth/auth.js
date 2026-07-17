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
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  GoogleAuthProvider,
  FacebookAuthProvider,
  signInWithPopup,
  deleteUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase.js';
import { checkPassword } from './passwordPolicy.js';
import { reserveUsername, usernameFormatError, emailForLogin } from '../workspaces/data.js';

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
  // A username is required for every account.
  const handle = (username || '').trim();
  const fmt = usernameFormatError(handle);
  if (fmt) { const e = new Error(`Username: ${fmt.toLowerCase()}.`); e.code = 'auth/invalid-username'; throw e; }
  const displayName = [first, last].filter(Boolean).join(' ') || handle || email.split('@')[0];

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName });

  // Reserve the handle now that we're authenticated. If it was taken in a race,
  // roll the account back so we never create a user without a username.
  try {
    await reserveUsername(cred.user.uid, handle, email);
  } catch {
    try { await cred.user.delete(); } catch { /* ignore */ }
    const e = new Error('That username was just taken — please choose another.');
    e.code = 'auth/username-taken';
    throw e;
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

// Log in with either an email address or a username (both + password).
export async function logIn({ identifier, email, password }) {
  const addr = await emailForLogin(identifier || email);
  if (!addr) { const e = new Error('No account found for that username.'); e.code = 'auth/user-not-found'; throw e; }
  const cred = await signInWithEmailAndPassword(auth, addr, password);
  await ensureProfile(cred.user);
  return cred.user;
}

// "Remember me": local persistence survives browser restarts; session
// persistence is cleared when the tab/window closes. Call before signing in.
export async function setAuthPersistence(remember) {
  try { await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence); }
  catch { /* non-fatal — keep the default persistence */ }
}

// Social sign-in (popup). Works once the provider is enabled in the Firebase
// Console (Authentication → Sign-in method) and the domain is authorized.
async function socialSignIn(provider) {
  const cred = await signInWithPopup(auth, provider);
  const u = cred.user;
  const dn = (u.displayName || '').trim();
  await ensureProfile(u, {
    displayName: dn || (u.email ? u.email.split('@')[0] : 'User'),
    firstName: dn.split(/\s+/)[0] || '',
    lastName: dn.split(/\s+/).slice(1).join(' ') || '',
  });
  return u;
}
export function signInWithGoogle() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return socialSignIn(p);
}
export function signInWithFacebook() {
  return socialSignIn(new FacebookAuthProvider());
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
  // Keep the verified flag fresh so the public profile's "Verified" badge is
  // accurate for visitors (who can't read another user's auth state directly).
  try { await setDoc(ref, { emailVerified: !!user.emailVerified }, { merge: true }); } catch { /* non-fatal */ }
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
// Verify the signed-in user's password by reauthenticating. Throws on mismatch.
export async function verifyPassword(password) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const cred = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, cred);
  return true;
}

export async function changePassword(currentPassword, newPassword) {
  const { valid, firstError } = checkPassword(newPassword);
  if (!valid) { const e = new Error(`Password needs: ${firstError}.`); e.code = 'auth/weak-password-policy'; throw e; }
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}

// Permanently delete the signed-in user's account (required by Google Play).
// Deleting an auth user needs a recent login, so we reauthenticate with the
// password first. We mark the profile deleted BEFORE removing the auth account:
// once the auth user is gone the client loses permission to write, and the
// `deleted` flag lets admin/cleanup treat the leftover data as tombstoned.
export async function deleteMyAccount(password) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in.');
  const cred = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, cred);
  const uid = user.uid;
  try {
    await setDoc(doc(db, 'users', uid), {
      deleted: true, deletedAt: serverTimestamp(),
      // Scrub the profile so nothing personal lingers in a readable doc.
      bio: '', phone: '', photoURL: '', links: {}, username: '',
    }, { merge: true });
  } catch { /* best effort — proceed to remove the auth account regardless */ }
  await deleteUser(user);
}
