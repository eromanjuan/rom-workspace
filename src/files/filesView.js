// The Files section: upload files and view everything you've uploaded.
import { el, clear, icon, toast, confirmModal } from '../ui/dom.js';
import { isMaster } from '../workspaces/roles.js';
import { uploadFile, listFiles, deleteFile, purgeExpiredTrash } from '../workspaces/data.js';

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function iconForType(type = '') {
  if (type.startsWith('image/')) return 'photo';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'music';
  if (type === 'application/pdf') return 'file-type-pdf';
  if (type.includes('zip') || type.includes('compressed')) return 'file-zip';
  if (type.startsWith('text/') || type.includes('word') || type.includes('document')) return 'file-text';
  return 'file';
}

export function renderFiles(host, user) {
  clear(host);

  const fileInput = el('input', { type: 'file', multiple: 'multiple', style: 'display:none' });
  const uploadBtn = el('button', { class: 'btn btn--primary' }, [icon('upload'), ' Upload files']);
  uploadBtn.addEventListener('click', () => fileInput.click());

  const grid = el('div', { class: 'files-grid' }, el('p', { class: 'muted' }, 'Loading files…'));

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    uploadBtn.disabled = true;
    uploadBtn.textContent = `Uploading ${files.length}…`;
    let done = 0;
    for (const f of files) {
      try { await uploadFile(user, f); done += 1; }
      catch (err) { toast(uploadError(err, f.name), 'error'); }
    }
    uploadBtn.disabled = false;
    clear(uploadBtn).append(icon('upload'), ' Upload files');
    if (done) toast(`Uploaded ${done} file${done > 1 ? 's' : ''}.`, 'success');
    load();
  });

  host.append(el('div', { class: 'files' }, [
    el('div', { class: 'files-head' }, [
      el('div', {}, [
        el('h2', { class: 'section__title' }, 'Files'),
        el('p', { class: 'muted' }, isMaster(user) ? 'All uploaded files across ROMIO.' : 'Everything you have uploaded.'),
      ]),
      el('div', {}, [uploadBtn, fileInput]),
    ]),
    grid,
  ]));

  // Best-effort: clear out any files that have sat in Trash past 30 days.
  purgeExpiredTrash(user.uid).catch(() => {});

  async function load() {
    try {
      const files = await listFiles(user.uid);
      clear(grid);
      if (!files.length) {
        grid.append(el('div', { class: 'placeholder' }, [
          el('div', { class: 'placeholder-icon' }, icon('folder')),
          el('h3', {}, 'No files yet'),
          el('p', { class: 'muted' }, 'Upload files to see them here.'),
        ]));
        return;
      }
      for (const f of files) grid.append(renderFileCard(f, user));
    } catch (err) {
      clear(grid);
      grid.append(el('p', { class: 'error-text' }, storageHint(err)));
    }
  }
  load();
}

function renderFileCard(f, user) {
  const when = f.createdAt?.toDate ? f.createdAt.toDate().toLocaleDateString() : '';
  const isImage = (f.type || '').startsWith('image/');
  const preview = isImage
    ? el('a', { href: f.url, target: '_blank', rel: 'noopener', class: 'file-thumb' }, el('img', { src: f.url, alt: f.name, loading: 'lazy' }))
    : el('a', { href: f.url, target: '_blank', rel: 'noopener', class: 'file-thumb file-thumb--icon' }, icon(iconForType(f.type)));

  return el('div', { class: 'file-card card' }, [
    preview,
    el('div', { class: 'file-meta' }, [
      el('div', { class: 'file-name', title: f.name }, f.name),
      el('div', { class: 'muted file-sub' }, `${fmtSize(f.size)}${when ? ' · ' + when : ''}${isMaster(user) && f.ownerName ? ' · ' + f.ownerName : ''}`),
    ]),
    el('div', { class: 'file-actions' }, [
      el('a', { class: 'btn btn--ghost btn--sm', href: f.url, target: '_blank', rel: 'noopener' }, [icon('external-link'), ' Open']),
      el('button', {
        class: 'btn btn--danger btn--sm', title: 'Move to Trash', onclick: async (e) => {
          const card = e.currentTarget.closest('.file-card');
          if (!(await confirmModal({ title: 'Move to Trash?', message: `"${f.name}" will be moved to Trash and permanently deleted after 30 days. You can restore it from Settings → Trash.`, confirmLabel: 'Move to Trash', danger: true }))) return;
          try { await deleteFile(f); card.remove(); toast('Moved to Trash', 'success'); }
          catch (err) { toast(err.message, 'error'); }
        },
      }, icon('trash')),
    ]),
  ]);
}

function uploadError(err, name) {
  const code = err?.code || '';
  if (code.includes('unauthorized') || code.includes('unauthenticated')) return `Not allowed to upload ${name}.`;
  if (code.includes('retry-limit') || code.includes('unknown')) return `Upload failed for ${name}. Is Storage enabled?`;
  return `Could not upload ${name}: ${err.message || code}`;
}

function storageHint(err) {
  const code = err?.code || err?.message || '';
  if (String(code).includes('storage') || String(code).includes('bucket')) {
    return 'Firebase Storage is not enabled yet — enable it in the Firebase Console, then reload.';
  }
  return `Could not load files: ${err.message || code}`;
}
