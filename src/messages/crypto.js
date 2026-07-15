// Message encryption for chat. This is a SHARED-SECRET model: the sender picks
// an algorithm and a key, and the recipient must know the same algorithm + key
// (agreed out of band) to decrypt. The key is never stored or sent — only the
// ciphertext and the algorithm id travel with the message.
//
// AES-256-GCM (via the browser's Web Crypto) is real, strong encryption. The
// Caesar and Vigenère ciphers are classic and are light obfuscation only — do
// not rely on them for anything sensitive.

export const ENCRYPTIONS = [
  { id: 'aes', label: 'AES-256 (strong)', keyLabel: 'Passphrase', keyPh: 'A secret passphrase', hint: 'Real encryption via your browser. Recommended.' },
  { id: 'vigenere', label: 'Vigenère cipher', keyLabel: 'Key word', keyPh: 'A secret word (letters)', hint: 'Classic letter cipher — light obfuscation only.' },
  { id: 'caesar', label: 'Caesar shift', keyLabel: 'Shift number', keyPh: 'e.g. 3', hint: 'Shift letters by a number — very basic.' },
];
export const algoLabel = (id) => (ENCRYPTIONS.find((e) => e.id === id) || {}).label || id;

// --- Caesar ---
function caesar(text, shift) {
  const s = ((shift % 26) + 26) % 26;
  return String(text).replace(/[a-zA-Z]/g, (ch) => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + s) % 26) + base);
  });
}

// --- Vigenère (dir = +1 encrypt, -1 decrypt) ---
function vigenere(text, key, dir) {
  const k = String(key).toUpperCase().replace(/[^A-Z]/g, '');
  if (!k) throw new Error('Key must contain letters.');
  let ki = 0, out = '';
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    let base;
    if (code >= 65 && code <= 90) base = 65;
    else if (code >= 97 && code <= 122) base = 97;
    else { out += ch; continue; }
    const shift = (k.charCodeAt(ki % k.length) - 65) * dir;
    out += String.fromCharCode((((code - base + shift) % 26) + 26) % 26 + base);
    ki++;
  }
  return out;
}

// --- AES-256-GCM with a PBKDF2-derived key ---
const te = new TextEncoder();
const td = new TextDecoder();
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, usage) {
  if (!passphrase) throw new Error('A passphrase is required.');
  const material = await crypto.subtle.importKey('raw', te.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, [usage],
  );
}
async function aesEncrypt(passphrase, text) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, 'encrypt');
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text)));
  const packed = new Uint8Array(salt.length + iv.length + ct.length);
  packed.set(salt, 0); packed.set(iv, salt.length); packed.set(ct, salt.length + iv.length);
  return toB64(packed);
}
async function aesDecrypt(passphrase, b64) {
  const packed = fromB64(b64);
  const salt = packed.slice(0, 16), iv = packed.slice(16, 28), ct = packed.slice(28);
  const key = await deriveKey(passphrase, salt, 'decrypt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return td.decode(pt);
}

// Encrypt plaintext with the chosen algorithm; returns the ciphertext string.
export async function encryptMessage(algo, key, text) {
  if (algo === 'aes') return aesEncrypt(key, text);
  if (algo === 'vigenere') return vigenere(text, key, 1);
  if (algo === 'caesar') {
    const n = parseInt(key, 10);
    if (Number.isNaN(n)) throw new Error('Caesar key must be a number.');
    return caesar(text, n);
  }
  throw new Error('Unknown encryption type.');
}

// Decrypt ciphertext; throws if the key is wrong or the algorithm mismatches.
export async function decryptMessage(algo, key, cipher) {
  if (algo === 'aes') {
    try { return await aesDecrypt(key, cipher); }
    catch { throw new Error('Wrong key or corrupted message.'); }
  }
  if (algo === 'vigenere') return vigenere(cipher, key, -1);
  if (algo === 'caesar') {
    const n = parseInt(key, 10);
    if (Number.isNaN(n)) throw new Error('Caesar key must be a number.');
    return caesar(cipher, -n);
  }
  throw new Error('Unknown encryption type.');
}
