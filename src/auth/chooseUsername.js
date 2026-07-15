// Username gate: every ROMIO account must have a username. Shown after login for
// any user who doesn't have one yet (social sign-ins, or older accounts). Blocks
// the app until a valid, available handle is reserved.
import { el, clear, icon, toast } from '../ui/dom.js';
import { logOut } from './auth.js';
import { isUsernameAvailable, usernameFormatError, claimUsername, updateUserProfile } from '../workspaces/data.js';

export function renderChooseUsername(host, user, onDone) {
  clear(host);

  const input = el('input', { class: 'field__input', id: 'cu-username', type: 'text', placeholder: 'juandc', autocomplete: 'username' });
  const prefix = el('div', { class: 'field__control field__control--prefix' }, [el('span', { class: 'field__prefix' }, '@'), input]);
  const hintEl = el('div', { class: 'field__hint', 'aria-live': 'polite' }, 'Letters, numbers & underscore — your unique @handle.');
  const save = el('button', { class: 'btn btn--primary auth__submit', type: 'submit' }, 'Continue');

  let state = 'idle';   // idle | checking | ok | taken | invalid
  let timer = null;
  const setHint = (s, msg) => {
    state = s;
    hintEl.className = `field__hint ${s === 'ok' ? 'is-ok' : (s === 'taken' || s === 'invalid') ? 'is-error' : ''}`;
    clear(hintEl);
    const ic = s === 'checking' ? el('span', { class: 'spinner spinner--xs' })
      : s === 'ok' ? icon('circle-check')
      : (s === 'taken' || s === 'invalid') ? icon('alert-circle') : null;
    if (ic) hintEl.append(ic, ' ');
    hintEl.append(msg);
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const val = input.value.trim();
    if (!val) { setHint('idle', 'Letters, numbers & underscore — your unique @handle.'); return; }
    const fmt = usernameFormatError(val);
    if (fmt) { setHint('invalid', fmt); return; }
    setHint('checking', 'Checking availability…');
    timer = setTimeout(async () => {
      try {
        const ok = await isUsernameAvailable(val);
        if (input.value.trim() !== val) return;
        setHint(ok ? 'ok' : 'taken', ok ? `@${val} is available` : `@${val} is already taken`);
      } catch { setHint('idle', "Couldn't check right now — you can still try."); }
    }, 450);
  });

  const form = el('form', {
    class: 'auth__form', novalidate: 'novalidate',
    onsubmit: async (e) => {
      e.preventDefault();
      const val = input.value.trim();
      const fmt = usernameFormatError(val);
      if (fmt) { toast(`Username: ${fmt.toLowerCase()}.`, 'error'); input.focus(); return; }
      if (state === 'taken') { toast('That username is taken — pick another.', 'error'); input.focus(); return; }
      save.disabled = true; save.innerHTML = '';
      save.append(el('span', { class: 'spinner spinner--xs' }), ' Saving…');
      try {
        await claimUsername(user.uid, val, user.email);   // idempotent: ok if already ours
        await updateUserProfile(user.uid, { username: val });
        onDone();
      } catch (err) {
        // Most likely the handle was just taken (reserve is a create-once).
        toast('That username was just taken — please choose another.', 'error');
        setHint('taken', 'Please choose another.');
        save.disabled = false; save.textContent = 'Continue';
      }
    },
  }, [
    el('div', { class: 'auth__logo auth__logo--mobile' }, [
      el('img', { class: 'auth__logo-mark', src: '/romio-mark.png', alt: '', width: '32', height: '32' }),
      el('span', { class: 'brand-word', role: 'img', 'aria-label': 'ROMIO' }),
    ]),
    el('h1', { class: 'auth__title' }, 'Choose your username'),
    el('p', { class: 'auth__subtitle' }, 'You need a username to use ROMIO. This is your unique @handle.'),
    el('div', { class: 'field' }, [el('label', { class: 'field__label', for: 'cu-username' }, 'Username'), prefix, hintEl]),
    save,
    el('p', { class: 'auth__switch-line' }, [
      'Not you? ',
      el('button', { class: 'auth__switch', type: 'button', onclick: () => logOut() }, 'Log out'),
    ]),
  ]);

  host.append(el('div', { class: 'auth' }, el('main', { class: 'auth__main' }, el('div', { class: 'auth__card' }, form))));
  setTimeout(() => input.focus(), 0);
}
