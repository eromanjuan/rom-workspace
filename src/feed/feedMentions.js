// @mention support for the ROM global feed: a typeahead over all users, mention
// extraction (for notifications), and highlighted, clickable rendering.
import { el, clear, escapeHtml } from '../ui/dom.js';
import { listAllUsers } from '../workspaces/data.js';

const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

let cachedUsers = null;
export async function loadMentionUsers() {
  if (cachedUsers) return cachedUsers;
  try { cachedUsers = await listAllUsers(); } catch { cachedUsers = []; }
  return cachedUsers;
}

// Attach the @ typeahead to a textarea. getUsers() returns the candidate list.
// Returns a cleanup function.
export function attachMentionAutocomplete(textarea, getUsers) {
  let pop = null;
  let state = null; // { at, items, index }

  const close = () => { if (pop) { pop.remove(); pop = null; } state = null; document.removeEventListener('mousedown', onDown); };
  const onDown = (e) => { if (pop && !pop.contains(e.target) && e.target !== textarea) close(); };

  const tokenAt = () => {
    const caret = textarea.selectionStart;
    if (caret == null || caret !== textarea.selectionEnd) return null;
    const m = textarea.value.slice(0, caret).match(/(?:^|\s)@([\w.\- ]{0,30})$/);
    return m ? { query: m[1], at: caret - m[1].length - 1 } : null;
  };
  const position = () => {
    const r = textarea.getBoundingClientRect();
    pop.style.position = 'fixed';
    pop.style.left = `${Math.max(8, r.left)}px`;
    pop.style.top = `${Math.min(r.bottom + 4, window.innerHeight - 8)}px`;
    pop.style.minWidth = `${Math.min(300, Math.max(220, r.width))}px`;
    pop.style.zIndex = '1300';
  };
  const draw = () => {
    if (!pop || !state) return;
    clear(pop);
    state.items.forEach((u, i) => {
      const name = u.displayName || u.username || 'User';
      const btn = el('button', { type: 'button', class: `mention-item ${i === state.index ? 'active' : ''}` }, [
        el('span', { class: 'mention-av' }, initials(name)),
        el('span', { class: 'mention-meta' }, [
          el('span', { class: 'mention-name' }, name),
          u.username ? el('span', { class: 'mention-handle' }, `@${u.username}`) : null,
        ]),
      ]);
      btn.addEventListener('mousedown', (e) => { e.preventDefault(); apply(i); });
      pop.append(btn);
    });
  };
  const show = (token) => {
    const q = token.query.trim().toLowerCase();
    const items = (getUsers() || []).filter((u) => {
      const n = (u.displayName || '').toLowerCase();
      const h = (u.username || '').toLowerCase();
      return !q || n.includes(q) || h.includes(q);
    }).slice(0, 6);
    if (!items.length) { close(); return; }
    if (!pop) { pop = el('div', { class: 'mention-pop' }); document.body.append(pop); }
    state = { at: token.at, items, index: 0 };
    draw(); position();
    setTimeout(() => document.addEventListener('mousedown', onDown), 0);
  };
  const apply = (i) => {
    if (!state) return;
    const u = state.items[i]; if (!u) return;
    const handle = `@${u.username || u.displayName || 'user'}`;
    const caret = textarea.selectionStart;
    textarea.value = `${textarea.value.slice(0, state.at)}${handle} ${textarea.value.slice(caret)}`;
    const pos = state.at + handle.length + 1;
    textarea.focus(); textarea.setSelectionRange(pos, pos);
    close();
  };

  const onInput = () => { const t = tokenAt(); if (!t) { close(); return; } show(t); };
  const onKey = (e) => {
    if (!state) return;
    const n = state.items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); state.index = (state.index + 1) % n; draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); state.index = (state.index - 1 + n) % n; draw(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); apply(state.index); }
    else if (e.key === 'Escape') { close(); }
  };
  textarea.addEventListener('input', onInput);
  textarea.addEventListener('keydown', onKey);
  return close;
}

// Resolve @mentions in text against the user list → [{uid, username, name}].
// Matches both @handle tokens AND @Display Name (so users without a handle, or
// names with spaces, still resolve — otherwise their mention silently drops and
// they never get notified).
export function extractMentions(text, users) {
  const out = []; const seen = new Set();
  const add = (u, name) => {
    if (u && u.uid && !seen.has(u.uid)) {
      seen.add(u.uid);
      out.push({ uid: u.uid, username: u.username || '', name: u.displayName || u.username || name || '' });
    }
  };
  const byHandle = new Map();
  (users || []).forEach((u) => { if (u.username) byHandle.set(u.username.toLowerCase(), u); });
  // 1) @handle tokens
  const re = /(?:^|[^\w@])@([a-zA-Z0-9_.]+)/g;
  let m;
  while ((m = re.exec(text))) add(byHandle.get(m[1].toLowerCase()));
  // 2) @Display Name — check longest names first so "@Ann Lee" wins over "@Ann"
  const lower = (text || '').toLowerCase();
  (users || []).filter((u) => u.displayName).sort((a, b) => b.displayName.length - a.displayName.length)
    .forEach((u) => { if (!seen.has(u.uid) && lower.includes('@' + u.displayName.toLowerCase())) add(u, u.displayName); });
  return out;
}

// Render text with @mentions highlighted + clickable (data-uid). Highlights by
// handle when present, else by the mentioned user's display name.
export function renderBodyWithMentions(text, mentions) {
  let html = escapeHtml(text || '');
  // token (username or display name, escaped+lowercased) -> mention
  const byToken = new Map();
  (mentions || []).forEach((x) => {
    if (!x || !x.uid) return;
    const tok = x.username || x.name;
    if (tok) byToken.set(escapeHtml(tok).toLowerCase(), x);
  });
  if (byToken.size) {
    const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`@(${tokens.join('|')})`, 'gi');
    html = html.replace(re, (full, tok) => {
      const x = byToken.get(tok.toLowerCase());
      if (!x) return full;
      const label = x.username ? `@${escapeHtml(x.username)}` : `@${escapeHtml(x.name)}`;
      return `<a class="mention-link" data-uid="${x.uid}">${label}</a>`;
    });
  }
  return html.replace(/\n/g, '<br>');
}
