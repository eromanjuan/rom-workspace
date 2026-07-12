// Tiny DOM helpers so modules stay small and framework-free.

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== null && value !== undefined) {
      node.setAttribute(key, value);
    }
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

// A Tabler icon element, e.g. icon('plus'). No emoji anywhere in the UI.
export function icon(name, cls = '') {
  return el('i', { class: `ti ti-${name}${cls ? ' ' + cls : ''}`, 'aria-hidden': 'true' });
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// Escape user text before putting it in innerHTML.
export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function timeAgo(date) {
  if (!date) return '';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const units = [
    ['y', 31536000], ['mo', 2592000], ['d', 86400],
    ['h', 3600], ['m', 60], ['s', 1],
  ];
  for (const [label, secs] of units) {
    const v = Math.floor(seconds / secs);
    if (v >= 1) return `${v}${label} ago`;
  }
  return 'just now';
}

// A centered modal overlay. Returns { overlay, body, close }.
// `title` and `iconName` render the header; onClose fires on dismiss.
export function openModal({ title, iconName, iconColor, wide, onClose } = {}) {
  const body = el('div', { class: 'modal-body' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); };
  // With no explicit iconColor, the icon uses the theme accent (via CSS .modal-ic).
  const iconEl = iconName ? el('div', { class: 'modal-ic', ...(iconColor ? { style: `background:${iconColor}` } : {}) }, icon(iconName)) : null;
  const header = el('div', { class: 'modal-head' }, [
    el('div', { class: 'modal-head-left' }, [
      iconEl,
      el('h3', { class: 'modal-title' }, title || ''),
    ]),
    el('button', { class: 'btn wb-modal-close-btn', onclick: close }, 'Close'),
  ]);
  const card = el('div', { class: `modal-card${wide ? ' modal-card--wide' : ''}` }, [header, body]);
  // Do NOT dismiss on a backdrop click — these modals hold form input, and an
  // accidental outside click would lose it. Close via the Close/Cancel button or
  // the Escape key only.
  const overlay = el('div', { class: 'modal-overlay' }, [card]);
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return { overlay, body, close, iconEl };
}

// A professional confirmation dialog that replaces the native confirm(). Returns
// a Promise resolving true if confirmed, false if cancelled/closed/Escape.
export function confirmModal({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, iconName } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const { body, close } = openModal({
      title,
      iconName: iconName || (danger ? 'trash' : 'help-circle'),
      onClose: () => { if (!settled) { settled = true; resolve(false); } },
    });
    const done = (v) => { if (settled) return; settled = true; close(); resolve(v); };
    const cancelBtn = el('button', { class: 'btn btn--ghost', onclick: () => done(false) }, cancelLabel);
    const okBtn = el('button', { class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`, onclick: () => done(true) }, confirmLabel);
    body.append(
      message ? el('p', { class: 'confirm-modal__msg' }, message) : null,
      el('div', { class: 'confirm-modal__actions' }, [cancelBtn, okBtn]),
    );
    okBtn.focus();
  });
}

// Trigger a client-side file download of text content.
export function downloadFile(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toast(message, kind = 'info') {
  const t = el('div', { class: `toast toast--${kind}` }, message);
  document.body.append(t);
  setTimeout(() => t.classList.add('toast--show'), 10);
  setTimeout(() => {
    t.classList.remove('toast--show');
    setTimeout(() => t.remove(), 300);
  }, 3200);
}
