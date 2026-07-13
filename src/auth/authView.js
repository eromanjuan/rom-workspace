// The login / sign-up screen shown when no user is signed in.
// Split layout: a brand panel + a form card. Sign-up collects Firstname,
// Surname, email, a unique username (live availability check), and a password
// with a strength meter + confirm field. Inline validation throughout.
import { el, clear, icon, toast, openModal } from '../ui/dom.js';
import { signUp, logIn, sendPasswordReset, setAuthPersistence, signInWithGoogle, signInWithFacebook } from './auth.js';
import { checkPassword, passwordStrength } from './passwordPolicy.js';
import { isUsernameAvailable, usernameFormatError } from '../workspaces/data.js';

export function renderAuth(root) {
  clear(root);
  let mode = 'login'; // 'login' | 'signup'

  const shell = el('div', { class: 'auth' });

  function draw() {
    clear(shell);
    const isSignup = mode === 'signup';

    // --- brand / marketing aside (hidden on small screens) ---
    const aside = el('aside', { class: 'auth__aside' }, [
      el('div', { class: 'auth__aside-inner' }, [
        el('div', { class: 'auth__logo' }, [el('img', { class: 'auth__logo-mark', src: '/logo.svg', alt: '', width: '32', height: '32' }), 'ROMIO']),
        el('h2', { class: 'auth__aside-title' }, 'Your feed, your workspaces, your apps.'),
        el('p', { class: 'auth__aside-sub' }, 'One command center for posting, collaborating, and building no-code apps with your team.'),
        el('ul', { class: 'auth__features' }, [
          ['news', 'A shared feed with likes & comments'],
          ['layout-dashboard', 'Workspaces with roles & invites'],
          ['apps', 'A no-code app builder + tools'],
        ].map(([ic, text]) => el('li', {}, [el('span', { class: 'auth__feature-ic' }, icon(ic)), text]))),
      ]),
    ]);

    // ---------- fields ----------
    const firstName = input({ id: 'su-first', type: 'text', placeholder: 'Juan', autocomplete: 'given-name' });
    const lastName = input({ id: 'su-last', type: 'text', placeholder: 'Dela Cruz', autocomplete: 'family-name' });
    const email = input({ id: 'au-email', type: 'email', placeholder: 'you@example.com', autocomplete: 'email' });
    const username = input({ id: 'su-username', type: 'text', placeholder: 'juandc', autocomplete: 'username' });
    const pass = input({ id: 'au-pass', type: 'password', placeholder: isSignup ? 'Create a strong password' : 'Your password', autocomplete: isSignup ? 'new-password' : 'current-password' });
    const confirm = input({ id: 'su-confirm', type: 'password', placeholder: 'Re-enter password', autocomplete: 'new-password' });

    // ---------- username availability (debounced) ----------
    const userHint = hint('su-username', 'Letters, numbers & underscore — this is your unique @handle.');
    let usernameState = 'idle'; // idle | checking | ok | taken | invalid
    let userTimer = null;
    function setUserHint(state, msg) {
      usernameState = state;
      userHint.className = `field__hint ${state === 'ok' ? 'is-ok' : (state === 'taken' || state === 'invalid') ? 'is-error' : ''}`;
      clear(userHint);
      const ic = state === 'checking' ? el('span', { class: 'spinner spinner--xs' })
        : state === 'ok' ? icon('circle-check')
        : (state === 'taken' || state === 'invalid') ? icon('alert-circle') : null;
      if (ic) userHint.append(ic, ' ');
      userHint.append(msg);
      username.setAttribute('aria-invalid', state === 'taken' || state === 'invalid' ? 'true' : 'false');
    }
    username.addEventListener('input', () => {
      clearTimeout(userTimer);
      const val = username.value.trim();
      if (!val) { setUserHint('idle', 'Letters, numbers & underscore — this is your unique @handle.'); return; }
      const fmt = usernameFormatError(val);
      if (fmt) { setUserHint('invalid', fmt); return; }
      setUserHint('checking', 'Checking availability…');
      userTimer = setTimeout(async () => {
        try {
          const ok = await isUsernameAvailable(val);
          // Ignore stale results if the field changed meanwhile.
          if (username.value.trim() !== val) return;
          setUserHint(ok ? 'ok' : 'taken', ok ? `@${val} is available` : `@${val} is already taken`);
        } catch { setUserHint('idle', "Couldn't check right now — you can still try."); }
      }, 450);
    });

    // ---------- password strength + requirements ----------
    const meter = el('div', { class: 'pw-meter' }, el('div', { class: 'pw-meter__fill' }));
    const meterLabel = el('span', { class: 'pw-meter__label' }, '');
    const meterRow = el('div', { class: 'pw-meter-row' }, [meter, meterLabel]);
    const reqList = el('ul', { class: 'pw-reqs' });
    function refreshPass() {
      const s = passwordStrength(pass.value);
      const fill = meter.firstChild;
      fill.style.width = `${s.pct}%`;
      meter.dataset.level = s.level;
      meterLabel.textContent = s.label;
      meterLabel.dataset.level = s.level;
      clear(reqList);
      for (const r of checkPassword(pass.value).results) {
        reqList.append(el('li', { class: `pw-req ${r.ok ? 'pw-req--ok' : ''}` }, [icon(r.ok ? 'circle-check' : 'circle'), ' ' + r.label]));
      }
    }
    const confirmHint = hint('su-confirm', '');
    function refreshConfirm() {
      if (!confirm.value) { confirmHint.className = 'field__hint'; clear(confirmHint); return; }
      const match = confirm.value === pass.value;
      confirmHint.className = `field__hint ${match ? 'is-ok' : 'is-error'}`;
      clear(confirmHint);
      confirmHint.append(icon(match ? 'circle-check' : 'alert-circle'), ' ', match ? 'Passwords match' : "Passwords don't match yet");
      confirm.setAttribute('aria-invalid', match ? 'false' : 'true');
    }
    if (isSignup) {
      pass.addEventListener('input', () => { refreshPass(); if (confirm.value) refreshConfirm(); });
      confirm.addEventListener('input', refreshConfirm);
      refreshPass();
    }

    // ---------- remember me + social ----------
    const remember = el('input', { type: 'checkbox', id: 'au-remember', checked: 'checked' });
    const rememberRow = el('div', { class: 'auth__row' }, [
      el('label', { class: 'auth__remember', for: 'au-remember' }, [remember, el('span', {}, 'Remember me')]),
      forgotLink(email),
    ]);

    async function doSocial(fn, btn) {
      const orig = btn.innerHTML;
      btn.disabled = true; btn.style.opacity = '0.7';
      try {
        await setAuthPersistence(remember.checked);
        await fn();
        // onAuthStateChanged in main.js takes over.
      } catch (err) {
        toast(friendly(err), 'error');
        btn.disabled = false; btn.style.opacity = ''; btn.innerHTML = orig;
      }
    }
    const gBtn = socialBtn('google', 'brand-google', 'Continue with Google');
    const fBtn = socialBtn('facebook', 'brand-facebook', 'Continue with Facebook');
    gBtn.addEventListener('click', () => doSocial(signInWithGoogle, gBtn));
    fBtn.addEventListener('click', () => doSocial(signInWithFacebook, fBtn));
    const social = el('div', { class: 'auth__social' }, [
      el('div', { class: 'auth__divider' }, el('span', {}, 'or')),
      gBtn, fBtn,
    ]);

    // ---------- submit ----------
    const submit = el('button', { class: 'btn btn--primary auth__submit', type: 'submit' }, isSignup ? 'Create account' : 'Log in');

    // ---------- terms agreement (sign-up only): gates the Create button ----------
    const terms = el('input', { type: 'checkbox', class: 'auth__terms-cb' });
    const termsRow = el('label', { class: 'auth__terms' }, [
      terms,
      el('span', {}, [
        'I have read and agree to the ',
        el('button', { type: 'button', class: 'auth__terms-link', onclick: showTermsModal }, 'Terms of Service & Privacy Policy'),
        '.',
      ]),
    ]);
    if (isSignup) {
      submit.disabled = true;
      terms.addEventListener('change', () => { submit.disabled = !terms.checked; });
    }

    const form = el('form', {
      class: 'auth__form', novalidate: 'novalidate',
      onsubmit: async (e) => {
        e.preventDefault();
        if (isSignup) {
          if (!firstName.value.trim()) return failFocus(firstName, 'Enter your first name.');
          if (!lastName.value.trim()) return failFocus(lastName, 'Enter your surname.');
          if (!email.value.trim()) return failFocus(email, 'Enter your email.');
          const fmt = usernameFormatError(username.value.trim());
          if (fmt) return failFocus(username, `Username: ${fmt.toLowerCase()}.`);
          if (usernameState === 'taken') return failFocus(username, 'That username is taken — pick another.');
          const { valid, firstError } = checkPassword(pass.value);
          if (!valid) return failFocus(pass, `Password needs: ${firstError}.`);
          if (confirm.value !== pass.value) return failFocus(confirm, 'Passwords do not match.');
          if (!terms.checked) return toast('Please agree to the Terms of Service to create an account.', 'error');
        } else if (!email.value.trim() || !pass.value) {
          return toast('Enter your email and password.', 'error');
        }
        submit.disabled = true;
        submit.innerHTML = '';
        submit.append(el('span', { class: 'spinner spinner--xs' }), ' Please wait…');
        try {
          await setAuthPersistence(remember.checked);
          if (isSignup) {
            await signUp({ firstName: firstName.value.trim(), lastName: lastName.value.trim(), username: username.value.trim(), email: email.value.trim(), password: pass.value });
          } else {
            await logIn({ email: email.value.trim(), password: pass.value });
          }
          // onAuthStateChanged in main.js takes over from here.
        } catch (err) {
          toast(friendly(err), 'error');
          submit.disabled = false;
          submit.textContent = isSignup ? 'Create account' : 'Log in';
        }
      },
    }, [
      el('div', { class: 'auth__logo auth__logo--mobile' }, [el('img', { class: 'auth__logo-mark', src: '/logo.svg', alt: '', width: '32', height: '32' }), 'ROMIO']),
      el('h1', { class: 'auth__title' }, isSignup ? 'Create your account' : 'Welcome back'),
      el('p', { class: 'auth__subtitle' }, isSignup ? 'Join ROMIO — it only takes a minute.' : 'Log in to your feed and workspaces.'),

      isSignup ? el('div', { class: 'field-row' }, [
        field('First name', 'su-first', firstName),
        field('Surname', 'su-last', lastName),
      ]) : null,

      field('Email', 'au-email', email, null, 'mail'),

      isSignup ? field('Username', 'su-username', usernameControl(username), userHint) : null,

      field('Password', 'au-pass', passwordControl(pass), null),
      isSignup ? meterRow : null,
      isSignup ? reqList : null,

      isSignup ? field('Confirm password', 'su-confirm', passwordControl(confirm), confirmHint) : null,

      isSignup ? null : rememberRow,
      isSignup ? termsRow : null,
      submit,
      social,
    ]);

    const card = el('div', { class: 'auth__card' }, [
      form,
      el('p', { class: 'auth__switch-line' }, [
        isSignup ? 'Already have an account? ' : "Don't have an account? ",
        el('button', { class: 'auth__switch', type: 'button', onclick: () => { mode = isSignup ? 'login' : 'signup'; draw(); } }, isSignup ? 'Log in' : 'Create one'),
      ]),
    ]);

    shell.append(aside, el('main', { class: 'auth__main' }, card));
  }

  draw();
  root.append(shell);
}

// ---------- small builders ----------
function input(attrs) { return el('input', { class: 'field__input', ...attrs }); }

function field(label, forId, control, hintEl, iconName) {
  return el('div', { class: 'field' }, [
    el('label', { class: 'field__label', for: forId }, label),
    iconName
      ? el('div', { class: 'field__control field__control--icon' }, [el('span', { class: 'field__icon' }, icon(iconName)), control])
      : control,
    hintEl || null,
  ]);
}

// Wrap an input with a leading @ prefix for usernames.
function usernameControl(inputEl) {
  return el('div', { class: 'field__control field__control--prefix' }, [
    el('span', { class: 'field__prefix' }, '@'),
    inputEl,
  ]);
}

// Wrap a password input with a show/hide toggle.
function passwordControl(inputEl) {
  const toggle = el('button', { class: 'field__toggle', type: 'button', tabindex: '-1', 'aria-label': 'Show password' }, icon('eye'));
  toggle.addEventListener('click', () => {
    const show = inputEl.type === 'password';
    inputEl.type = show ? 'text' : 'password';
    clear(toggle).append(icon(show ? 'eye-off' : 'eye'));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    inputEl.focus();
  });
  return el('div', { class: 'field__control field__control--toggle' }, [inputEl, toggle]);
}

function hint(forId, text) {
  return el('div', { class: 'field__hint', id: `${forId}-hint`, 'aria-live': 'polite' }, text);
}

// "Forgot password?" link (sends a reset email to the typed address).
function forgotLink(emailInput) {
  const link = el('button', { class: 'field__link', type: 'button' }, 'Forgot password?');
  link.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) { toast('Enter your email above first, then tap “Forgot password?”.', 'info'); emailInput.focus(); return; }
    try { await sendPasswordReset(email); toast('Password reset link sent — check your email.', 'success'); }
    catch (err) { toast(friendly(err), 'error'); }
  });
  return link;
}

// A social sign-in button, e.g. socialBtn('google', 'brand-google', 'Continue with Google').
function socialBtn(kind, iconName, label) {
  return el('button', { class: `auth__social-btn auth__social-btn--${kind}`, type: 'button' }, [icon(iconName), el('span', {}, label)]);
}

function friendly(err) {
  const code = err?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Wrong email or password.';
  if (code.includes('email-already-in-use')) return 'That email already has an account. Try logging in.';
  if (code === 'auth/weak-password-policy') return err.message;
  if (code.includes('weak-password')) return 'Password must be at least 8 characters.';
  if (code.includes('invalid-email')) return 'That email address looks invalid.';
  if (code.includes('too-many-requests')) return 'Too many attempts — please wait a moment and try again.';
  // social / popup
  if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return 'Sign-in was cancelled.';
  if (code.includes('popup-blocked')) return 'Your browser blocked the popup — allow popups for this site and try again.';
  if (code.includes('account-exists-with-different-credential')) return 'An account already exists with this email using a different sign-in method. Log in that way first.';
  if (code.includes('operation-not-allowed')) return "This sign-in method isn't enabled yet (Firebase Console → Authentication → Sign-in method).";
  if (code.includes('unauthorized-domain')) return 'This domain is not authorized in Firebase (Authentication → Settings → Authorized domains).';
  if (code.includes('configuration') || code.includes('api-key')) return 'Firebase is not configured yet — check your .env.local and enable Email/Password auth.';
  return err?.message || 'Something went wrong.';
}

// Focus + toast helper for inline validation failures.
function failFocus(inputEl, message) {
  toast(message, 'error');
  (inputEl.querySelector?.('input') || inputEl).focus?.();
  inputEl.focus?.();
}

// The ROMIO User Agreement + Privacy summary shown from the sign-up terms link.
function showTermsModal() {
  const { body } = openModal({ title: 'Terms of Service & Privacy', iconName: 'file-text', wide: true });
  const h = (t) => el('h4', { class: 'terms-h' }, t);
  const p = (t) => el('p', { class: 'terms-p' }, t);
  body.append(el('div', { class: 'terms-doc' }, [
    p('Welcome to ROMIO. By creating an account you agree to the terms below. Please read them.'),

    h('1. Your account'),
    p('You must provide accurate information and are responsible for keeping your password secure and for all activity under your account. You must be old enough to form a binding agreement in your country. Do not share your login or impersonate others.'),

    h('2. Acceptable use'),
    p('You agree not to post or share content that is illegal, hateful, harassing, deceptive, infringing, or that contains malware, and not to spam, scrape, or disrupt the service or other users. Workspaces, messages and posts must respect the rights and privacy of others.'),

    h('3. Your content'),
    p('You keep ownership of the content you create (posts, messages, files, workspaces and apps). By posting it, you grant ROMIO the permission needed to store, display and share it with the people and workspaces you choose, solely to operate the service. You are responsible for the content you share and must have the right to share it.'),

    h('4. Privacy'),
    p('ROMIO stores your data (such as your name, email, profile, posts, messages, workspace content and theme preferences) using Google Firebase / Cloud to run the service. We use it to operate and improve ROMIO and to show your content to the people you share it with. We do not sell your personal data. Administrators (master accounts) can moderate content and may access data to keep the service safe and running.'),

    h('5. Moderation & termination'),
    p('We may remove content or suspend or delete accounts that violate these terms or harm the service or other users. You may stop using ROMIO and request removal of your account at any time.'),

    h('6. Service "as is"'),
    p('ROMIO is provided "as is" without warranties of any kind. We are not liable for lost data, downtime, or damages arising from your use of the service to the extent permitted by law.'),

    h('7. Changes'),
    p('We may update these terms as ROMIO evolves. Continued use after an update means you accept the revised terms.'),

    p('If you do not agree with these terms, please do not create an account or use ROMIO.'),
  ]));
}
