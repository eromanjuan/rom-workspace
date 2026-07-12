// The login / sign-up screen shown when no user is signed in.
// Split layout: a brand panel + a form card. Sign-up collects Firstname,
// Surname, email, a unique username (live availability check), and a password
// with a strength meter + confirm field. Inline validation throughout.
import { el, clear, icon, toast } from '../ui/dom.js';
import { signUp, logIn, sendPasswordReset } from './auth.js';
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
        el('div', { class: 'auth__logo' }, [el('span', { class: 'auth__logo-mark' }, 'R'), 'ROM']),
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

    // ---------- submit ----------
    const submit = el('button', { class: 'btn btn--primary auth__submit', type: 'submit' }, isSignup ? 'Create account' : 'Log in');

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
        } else if (!email.value.trim() || !pass.value) {
          return toast('Enter your email and password.', 'error');
        }
        submit.disabled = true;
        submit.innerHTML = '';
        submit.append(el('span', { class: 'spinner spinner--xs' }), ' Please wait…');
        try {
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
      el('div', { class: 'auth__logo auth__logo--mobile' }, [el('span', { class: 'auth__logo-mark' }, 'R'), 'ROM']),
      el('h1', { class: 'auth__title' }, isSignup ? 'Create your account' : 'Welcome back'),
      el('p', { class: 'auth__subtitle' }, isSignup ? 'Join ROM — it only takes a minute.' : 'Log in to your feed and workspaces.'),

      isSignup ? el('div', { class: 'field-row' }, [
        field('First name', 'su-first', firstName),
        field('Surname', 'su-last', lastName),
      ]) : null,

      field('Email', 'au-email', email, null, 'mail'),

      isSignup ? field('Username', 'su-username', usernameControl(username), userHint) : null,

      field('Password', 'au-pass', passwordControl(pass), isSignup ? null : forgot(email)),
      isSignup ? meterRow : null,
      isSignup ? reqList : null,

      isSignup ? field('Confirm password', 'su-confirm', passwordControl(confirm), confirmHint) : null,

      submit,
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

// "Forgot password?" affordance shown under the login password field.
function forgot(emailInput) {
  const link = el('button', { class: 'field__link', type: 'button' }, 'Forgot password?');
  link.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) { toast('Enter your email above first, then tap “Forgot password?”.', 'info'); emailInput.focus(); return; }
    try { await sendPasswordReset(email); toast('Password reset link sent — check your email.', 'success'); }
    catch (err) { toast(friendly(err), 'error'); }
  });
  return el('div', { class: 'field__hint field__hint--right' }, link);
}

function friendly(err) {
  const code = err?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Wrong email or password.';
  if (code.includes('email-already-in-use')) return 'That email already has an account. Try logging in.';
  if (code === 'auth/weak-password-policy') return err.message;
  if (code.includes('weak-password')) return 'Password must be at least 8 characters.';
  if (code.includes('invalid-email')) return 'That email address looks invalid.';
  if (code.includes('too-many-requests')) return 'Too many attempts — please wait a moment and try again.';
  if (code.includes('configuration') || code.includes('api-key')) return 'Firebase is not configured yet — check your .env.local and enable Email/Password auth.';
  return err?.message || 'Something went wrong.';
}

// Focus + toast helper for inline validation failures.
function failFocus(inputEl, message) {
  toast(message, 'error');
  (inputEl.querySelector?.('input') || inputEl).focus?.();
  inputEl.focus?.();
}
