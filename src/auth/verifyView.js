// Shown after sign-up (or login with an unverified email). Blocks the app until
// the user confirms their email address.
import { el, clear, icon, toast } from '../ui/dom.js';
import { resendVerification, refreshUser, logOut } from './auth.js';

export function renderVerify(root, user, onVerified) {
  clear(root);

  const checkBtn = el('button', { class: 'btn btn--primary' }, "I've verified — continue");
  const resendBtn = el('button', { class: 'btn btn--ghost' }, 'Resend email');

  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    checkBtn.textContent = 'Checking…';
    try {
      const fresh = await refreshUser();
      if (fresh?.emailVerified) {
        toast('Email verified! Welcome.', 'success');
        onVerified();
      } else {
        toast('Not verified yet — click the link in your email, then try again.', 'error');
        checkBtn.disabled = false;
        checkBtn.textContent = "I've verified — continue";
      }
    } catch (err) {
      toast(err.message, 'error');
      checkBtn.disabled = false;
      checkBtn.textContent = "I've verified — continue";
    }
  });

  resendBtn.addEventListener('click', async () => {
    resendBtn.disabled = true;
    try {
      await resendVerification();
      toast('Verification email sent.', 'success');
    } catch (err) {
      toast(err.message || 'Could not resend right now.', 'error');
    }
    setTimeout(() => { resendBtn.disabled = false; }, 4000);
  });

  root.append(
    el('div', { class: 'auth' }, [
      el('div', { class: 'auth__form verify' }, [
        el('h1', { class: 'auth__brand' }, 'ROMIO'),
        el('div', { class: 'verify__icon' }, icon('mail')),
        el('h2', { class: 'verify__title' }, 'Verify your email'),
        el('p', { class: 'muted' }, `We sent a verification link to ${user.email}. Click it to activate your account, then come back here.`),
        checkBtn,
        resendBtn,
        el('button', {
          class: 'auth__switch', type: 'button', onclick: () => logOut(),
        }, 'Use a different account'),
      ]),
    ]),
  );
}
