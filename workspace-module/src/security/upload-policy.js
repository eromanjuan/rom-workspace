// Shared file-upload security policy — "Abe's" 3-layer defense.
//
//   Layer 1  the file picker's `accept` attribute (acceptAttr) — a UX nicety,
//            trivially bypassed with DevTools, so it is never trusted alone.
//   Layer 2  extension + MIME allowlist — if it merely *looks* wrong on the
//            surface (wrong type/extension), drop it instantly.
//   Layer 3  magic-byte inspection — read the real bytes and confirm the
//            signature matches the claimed type. The binary data never lies,
//            so `malware.zip` renamed to `photo.jpg` is caught here.
//
// This is the CLIENT gate (and defense-in-depth). The non-bypassable backstops
// live in the Supabase bucket config (allowed_mime_types / file_size_limit) and
// the api/ endpoints — see supabase/migrations and api/_lib.

const KB = 1024;
const MB = 1024 * KB;

// Byte signatures per logical type. Each entry lists acceptable signatures; a
// signature may be anchored at an `offset` (default 0). WEBP requires BOTH the
// RIFF prefix and the WEBP tag at offset 8.
export const FILE_SIGNATURES = {
  png: [{ bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  jpeg: [{ bytes: [0xff, 0xd8, 0xff] }],
  gif: [{ bytes: [0x47, 0x49, 0x46, 0x38] }],
  webp: [{ bytes: [0x52, 0x49, 0x46, 0x46] }, { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }],
  pdf: [{ bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }],
  zip: [{ bytes: [0x50, 0x4b, 0x03, 0x04] }, { bytes: [0x50, 0x4b, 0x05, 0x06] }, { bytes: [0x50, 0x4b, 0x07, 0x08] }],
};

// Which signature an extension must satisfy. `text` types carry no binary
// signature — they are verified as "not binary" instead.
const EXT_SIGNATURE = {
  png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif', webp: 'webp',
  pdf: 'pdf', zip: 'zip', csv: 'text', tsv: 'text', txt: 'text',
};

// Canonical MIME allowlist per extension (Layer 2 — extension and MIME must
// agree). An empty string tolerates browsers/OSes that report no MIME type.
const EXT_MIME = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  zip: ['application/zip', 'application/x-zip-compressed', 'application/x-zip', ''],
  csv: ['text/csv', 'text/plain', 'application/vnd.ms-excel', ''],
  tsv: ['text/tab-separated-values', 'text/plain', ''],
  txt: ['text/plain', ''],
};

// Per-context upload policies: the extension allowlist and a hard size cap.
export const UPLOAD_POLICIES = {
  image: { exts: ['png', 'jpg', 'jpeg', 'webp', 'gif'], max: 5 * MB, label: 'image' },
  // Dashboard image tiles upload to Storage, so they allow larger files.
  tileimage: { exts: ['png', 'jpg', 'jpeg', 'webp', 'gif'], max: 25 * MB, label: 'image' },
  document: { exts: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'csv'], max: 25 * MB, label: 'document' },
  csv: { exts: ['csv', 'tsv', 'txt'], max: 10 * MB, label: 'spreadsheet' },
  backup: { exts: ['zip'], max: 50 * MB, label: 'backup archive' },
  formfile: { exts: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'csv'], max: 15 * MB, label: 'file' },
};

// Extensions that must never be accepted, regardless of context — a backstop in
// case a policy is ever widened by mistake. Includes script/executable and
// active-content types (SVG can carry script → XSS).
export const DANGEROUS_EXTS = new Set([
  'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'sh', 'bash', 'zsh', 'ps1', 'psm1',
  'vbs', 'vbe', 'js', 'mjs', 'cjs', 'jse', 'wsf', 'wsh', 'jar', 'app', 'apk', 'dmg',
  'deb', 'rpm', 'html', 'htm', 'xhtml', 'shtml', 'svg', 'php', 'phtml', 'php3', 'php4',
  'php5', 'asp', 'aspx', 'jsp', 'jspx', 'py', 'rb', 'pl', 'cgi', 'dll', 'so', 'dylib',
  'bin', 'lnk', 'reg', 'hta', 'cpl', 'gadget', 'inf', 'ins', 'msc', 'msp',
]);

export function fileExtension(name) {
  const clean = String(name || '').toLowerCase().trim();
  const dot = clean.lastIndexOf('.');
  return dot >= 0 ? clean.slice(dot + 1) : '';
}

// Catch the double-extension trick (invoice.pdf.exe) by scanning EVERY trailing
// dotted segment, not just the last one.
export function hasDangerousExtension(name) {
  return String(name || '').toLowerCase().split('.').slice(1).some((part) => DANGEROUS_EXTS.has(part.trim()));
}

// Make a storage-safe filename: strip path separators / traversal, collapse odd
// characters, cap length. Never returns an empty string.
export function sanitizeFilename(name) {
  const cleaned = String(name || 'upload')
    .normalize('NFKD')
    .replace(/[\\/]+/g, '-')
    .replace(/[^\w.\-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return cleaned || 'upload';
}

// Layer 1: the `accept` attribute for a given policy (extensions + MIME types).
export function acceptAttr(policyKey) {
  const policy = UPLOAD_POLICIES[policyKey];
  if (!policy) return '';
  const exts = policy.exts.map((ext) => `.${ext}`);
  const mimes = [...new Set(policy.exts.flatMap((ext) => (EXT_MIME[ext] || []).filter(Boolean)))];
  return [...exts, ...mimes].join(',');
}

// The Content-Type to declare when uploading. Prefer the browser's value, but
// fall back to the canonical MIME for the file's extension so it still satisfies
// a bucket's `allowed_mime_types` (never a bare application/octet-stream, which
// a locked-down bucket would reject).
export function contentTypeFor(file) {
  const declared = String((file && file.type) || '').toLowerCase();
  if (declared) return declared;
  const canonical = (EXT_MIME[fileExtension(file && file.name)] || []).find(Boolean);
  return canonical || 'application/octet-stream';
}

function bytesMatch(head, sig) {
  const at = sig.offset || 0;
  for (let i = 0; i < sig.bytes.length; i += 1) {
    if (head[at + i] !== sig.bytes[i]) return false;
  }
  return true;
}

function looksBinary(head, len) {
  for (let i = 0; i < len; i += 1) if (head[i] === 0) return true; // NUL byte ⇒ not text
  return false;
}

// The full three-layer check for a File. Returns { ok, reason }. Reads only the
// first 512 bytes for the magic-byte (Layer 3) verification.
export async function validateUpload(file, policyKey) {
  const policy = UPLOAD_POLICIES[policyKey];
  if (!policy) return { ok: false, reason: 'No upload policy is configured for this field.' };
  if (!file || typeof file.size !== 'number') return { ok: false, reason: 'No file was selected.' };
  if (file.size <= 0) return { ok: false, reason: 'The file is empty.' };
  if (file.size > policy.max) return { ok: false, reason: `That file is too large — the limit is ${Math.round(policy.max / MB)} MB.` };
  // Backstop: dangerous / double extensions are rejected outright.
  if (hasDangerousExtension(file.name)) return { ok: false, reason: 'That file type is blocked for security reasons.' };
  // Layer 2a: extension allowlist.
  const ext = fileExtension(file.name);
  if (!ext || !policy.exts.includes(ext)) {
    return { ok: false, reason: `Only ${policy.exts.map((e) => e.toUpperCase()).join(', ')} files are allowed here.` };
  }
  // Layer 2b: MIME must agree with the extension (when the browser provides one).
  const mime = String(file.type || '').toLowerCase();
  const allowedMimes = EXT_MIME[ext] || [];
  if (mime && allowedMimes.length && !allowedMimes.includes(mime)) {
    return { ok: false, reason: 'The file’s type does not match its extension.' };
  }
  // Layer 3: the bytes never lie.
  let head;
  try {
    head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  } catch {
    return { ok: false, reason: 'The file could not be read for validation.' };
  }
  const sigKey = EXT_SIGNATURE[ext];
  if (sigKey === 'text') {
    if (looksBinary(head, Math.min(head.length, 512))) {
      return { ok: false, reason: 'This does not look like a plain text / CSV file.' };
    }
  } else if (sigKey && FILE_SIGNATURES[sigKey]) {
    const sigs = FILE_SIGNATURES[sigKey];
    const matched = sigKey === 'webp' ? sigs.every((s) => bytesMatch(head, s)) : sigs.some((s) => bytesMatch(head, s));
    if (!matched) {
      return { ok: false, reason: 'The file’s contents don’t match its type — it may be renamed or corrupted.' };
    }
  }
  return { ok: true, reason: '' };
}
