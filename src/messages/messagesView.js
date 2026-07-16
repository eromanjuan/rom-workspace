// Messages: a two-pane chat (conversation list + active thread). Direct chats
// and workspace group chats live in the same list. New DMs are started by
// searching people. On mobile, selecting a conversation slides in the thread.
import { el, clear, icon, toast, timeAgo, openModal } from '../ui/dom.js';
import { playSound, primeAudio } from '../ui/sounds.js';
import { listAllUsers, notify, getWorkspace, listenUser } from '../workspaces/data.js';
import { isOnline, presenceText, presenceExact, lastActiveDate } from '../auth/presence.js';
import { avatarNode } from '../profile/avatar.js';
import { listenConversations, listenMessages, sendMessage, getConversation, ensureDirectConversation, MAX_ATTACHMENT_BYTES } from './messagesData.js';
import { ENCRYPTIONS, algoLabel, encryptMessage, decryptMessage } from './crypto.js';
import { viewerIsPro, proGate } from '../monetize.js';

// --- inline attachment encoding (no Firebase Storage; stored as data URLs) ---
const approxBytes = (dataURL) => Math.ceil((dataURL.length - dataURL.indexOf(',') - 1) * 0.75);

function compressImage(file, maxDim = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale);
        const h = Math.round(img.naturalHeight * scale);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        let q = quality;
        let out = c.toDataURL('image/jpeg', q);
        while (approxBytes(out) > MAX_ATTACHMENT_BYTES && q > 0.4) { q -= 0.12; out = c.toDataURL('image/jpeg', q); }
        resolve(out);
      };
      img.onerror = reject;
      img.src = r.result;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function readDataURL(file) {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(file); });
}

// Turn a picked File into the attachment stored on the message, or throw if it
// can't fit inline. Images are compressed; other files must already be small.
async function buildAttachment(file) {
  const isImage = (file.type || '').startsWith('image/');
  if (isImage) {
    const dataURL = await compressImage(file);
    if (approxBytes(dataURL) > MAX_ATTACHMENT_BYTES) throw new Error('Image is too large to send.');
    return { name: file.name || 'image', size: approxBytes(dataURL), type: 'image/jpeg', dataURL, isImage: true };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('File is too large (max 800 KB for non-images).');
  const dataURL = await readDataURL(file);
  return { name: file.name || 'file', size: file.size || 0, type: file.type || '', dataURL, isImage: false };
}

// Turn plain message text into an array of text + <a> nodes so URLs, www. links
// and emails become clickable. Only http/https/mailto are allowed as hrefs.
const LINK_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+|[^\s<@]+@[^\s<@]+\.[^\s<@]+)/gi;
function linkifyText(text) {
  const out = [];
  let last = 0;
  const str = String(text || '');
  str.replace(LINK_RE, (match, _m, offset) => {
    if (offset > last) out.push(str.slice(last, offset));
    // Keep trailing punctuation out of the link (e.g. "see https://x.com.").
    const trailing = (match.match(/[.,!?;:)\]]+$/) || [''])[0];
    const token = trailing ? match.slice(0, -trailing.length) : match;
    const isEmail = /^[^\s<@]+@[^\s<@]+$/.test(token);
    const href = isEmail ? `mailto:${token}` : (/^https?:\/\//i.test(token) ? token : `https://${token}`);
    out.push(el('a', {
      class: 'msg-link', href, target: isEmail ? null : '_blank', rel: 'noopener noreferrer',
    }, token));
    if (trailing) out.push(trailing);
    last = offset + match.length;
    return match;
  });
  if (last < str.length) out.push(str.slice(last));
  return out.length ? out : [str];
}

// A message attachment: inline preview for images, a download row for other files.
function attachmentNode(a) {
  const src = a.dataURL || a.url;
  if (a.isImage && src) {
    const img = el('img', { class: 'msg-attach-img', src, alt: a.name || '', loading: 'lazy' });
    return el('a', { class: 'msg-attach-imglink', href: src, target: '_blank', rel: 'noopener noreferrer' }, img);
  }
  const kb = Math.round((a.size || 0) / 1024);
  return el('a', { class: 'msg-attach-file', href: src, download: a.name || 'file' }, [
    el('span', { class: 'msg-attach-file-ic' }, icon('file')),
    el('span', { class: 'msg-attach-file-meta' }, [
      el('span', { class: 'msg-attach-file-name' }, a.name || 'Attachment'),
      el('span', { class: 'msg-attach-file-size muted' }, `${kb} KB · download`),
    ]),
    el('span', { class: 'msg-attach-file-dl' }, icon('download')),
  ]);
}

export function renderMessages(host, user, { initialConvId, onOpenUser } = {}) {
  clear(host);
  let convs = [];
  let activeId = null;
  let msgUnsub = null;
  const usersById = {};    // live profile name + photo (current, not the snapshot on the conv)
  const wsById = {};       // workspace icon/color/image for group chats
  const wsLoading = new Set();

  // Presence (online/offline) for the people I have direct chats with.
  const presenceById = {};              // uid -> live user profile (online, lastActive)
  const presenceUnsubs = new Map();     // uid -> unsubscribe
  let activeOtherUid = null;            // the other person in the open direct chat
  let activeStatusEl = null;            // the header status line to keep fresh
  function ensurePresence(uid) {
    if (!uid || presenceUnsubs.has(uid)) return;
    presenceUnsubs.set(uid, listenUser(uid, (p) => {
      if (p) { presenceById[uid] = p; usersById[uid] = { ...(usersById[uid] || {}), ...p }; }
      drawList();
      refreshActivePresence();
    }));
  }
  const presenceDot = (uid) => el('span', { class: `msg-presence-dot ${isOnline(presenceById[uid]) ? 'is-online' : ''}` });
  // Compact last-active label for a conversation-list row: "now" / "5m ago".
  const presenceListLabel = (uid) => {
    const p = presenceById[uid];
    if (isOnline(p)) return 'now';
    const d = lastActiveDate(p);
    return d ? timeAgo(d) : '';
  };
  function refreshActivePresence() {
    if (!activeStatusEl || !activeOtherUid) return;
    const p = presenceById[activeOtherUid];
    const online = isOnline(p);
    clear(activeStatusEl);
    activeStatusEl.classList.toggle('is-online', online);
    activeStatusEl.title = presenceExact(p);   // exact date/time on hover
    activeStatusEl.append(el('span', { class: `msg-presence-dot ${online ? 'is-online' : ''}` }), presenceText(p));
  }
  // "Last seen" text and stale-online detection drift over time with no doc
  // change to trigger a re-render, so re-evaluate presence on a timer too.
  const presenceTick = setInterval(() => { drawList(); refreshActivePresence(); }, 30000);

  const otherOf = (c) => (c.members || []).find((u) => u !== user.uid);
  const convTitle = (c) => {
    if (c.type === 'group') { const w = wsById[c.workspaceId]; return (w && w.name) || c.name || 'Workspace'; }
    const o = otherOf(c);
    return (usersById[o] && usersById[o].displayName) || (c.memberNames && c.memberNames[o]) || 'Direct message';
  };
  const convPhoto = (c) => {
    if (c.type === 'group') return '';
    const o = otherOf(c);
    return (usersById[o] && usersById[o].photoURL) || (c.memberPhotos && c.memberPhotos[o]) || '';
  };
  function ensureWs(wsId) {
    if (!wsId || wsById[wsId] || wsLoading.has(wsId)) return;
    wsLoading.add(wsId);
    getWorkspace(wsId).then((w) => { if (w) { wsById[wsId] = w; drawList(); } }).catch(() => {}).finally(() => wsLoading.delete(wsId));
  }
  const convAvatar = (c) => {
    if (c.type === 'group') {
      const w = wsById[c.workspaceId];
      if (w && w.imageUrl) return el('div', { class: 'msg-avatar has-photo' }, el('img', { src: w.imageUrl, alt: '' }));
      if (w) return el('div', { class: 'msg-avatar', style: `background:${w.color || '#5b8cff'}` }, icon(w.icon || 'layout-dashboard'));
      ensureWs(c.workspaceId);
      return el('div', { class: 'msg-avatar msg-avatar--group' }, icon('users'));
    }
    return avatarNode(convTitle(c), convPhoto(c), 'msg-avatar');
  };
  // Avatar plus an online dot for direct chats (groups have no single status).
  const convAvatarWithPresence = (c) => {
    if (c.type !== 'direct') return convAvatar(c);
    return el('span', { class: 'msg-avatar-wrap' }, [convAvatar(c), presenceDot(otherOf(c))]);
  };

  const listBox = el('div', { class: 'msg-conv-list' }, el('p', { class: 'muted' }, 'Loading…'));
  const newBtn = el('button', { class: 'btn btn--primary btn--sm' }, [icon('edit'), ' New']);
  newBtn.addEventListener('click', openNewMessage);
  const chatPane = el('div', { class: 'msg-chat' }, el('div', { class: 'msg-chat-empty muted' }, [icon('message'), el('p', {}, 'Select a conversation or start a new one.')]));

  host.append(el('div', { class: 'msg-layout' }, [
    el('div', { class: 'msg-sidebar' }, [
      el('div', { class: 'msg-sidebar-head' }, [el('h2', { class: 'section__title' }, 'Messages'), newBtn]),
      listBox,
    ]),
    chatPane,
  ]));

  function drawList() {
    clear(listBox);
    if (!convs.length) { listBox.append(el('p', { class: 'muted msg-empty' }, 'No conversations yet. Tap “New”.')); return; }
    for (const c of convs) {
      const last = c.lastMessage ? `${c.lastMessage.senderId === user.uid ? 'You: ' : ''}${c.lastMessage.text}` : 'No messages yet';
      const other = c.type === 'direct' ? otherOf(c) : null;
      const row = el('button', { class: `msg-conv ${c.id === activeId ? 'is-active' : ''}` }, [
        convAvatarWithPresence(c),
        el('div', { class: 'msg-conv-main' }, [
          el('div', { class: 'msg-conv-title' }, convTitle(c)),
          el('div', { class: 'msg-conv-last muted' }, last),
        ]),
        c.type === 'group'
          ? el('span', { class: 'msg-conv-tag' }, 'Group')
          : el('span', { class: `msg-conv-presence ${isOnline(presenceById[other]) ? 'is-online' : ''}`, title: presenceExact(presenceById[other]) }, presenceListLabel(other)),
      ]);
      row.addEventListener('click', () => openConv(c.id));
      listBox.append(row);
    }
  }

  async function openConv(id) {
    activeId = id;
    drawList();
    host.classList.add('msg-show-chat');
    if (msgUnsub) { msgUnsub(); msgUnsub = null; }
    clear(chatPane);
    const c = convs.find((x) => x.id === id) || await getConversation(id);
    if (!c) { chatPane.append(el('p', { class: 'muted' }, 'Conversation not found.')); return; }
    const title = convTitle(c);

    const back = el('button', { class: 'btn btn--ghost btn--sm msg-back', title: 'Back', onclick: () => { host.classList.remove('msg-show-chat'); activeId = null; drawList(); } }, icon('arrow-left'));
    const titleEl = (c.type === 'direct' && onOpenUser)
      ? el('button', { class: 'msg-chat-title msg-chat-title--link', onclick: () => onOpenUser(otherOf(c)) }, title)
      : el('div', { class: 'msg-chat-title' }, title);
    // Live online/offline status for a direct chat, shown under the name.
    const statusEl = c.type === 'direct' ? el('div', { class: 'msg-chat-status muted' }) : null;
    activeOtherUid = c.type === 'direct' ? otherOf(c) : null;
    activeStatusEl = statusEl;
    if (activeOtherUid) { ensurePresence(activeOtherUid); refreshActivePresence(); }
    const head = el('div', { class: 'msg-chat-head' }, [
      back,
      convAvatar(c),   // no presence dot here — the status line below already shows Online/Last seen
      el('div', { class: 'msg-chat-titlewrap' }, [titleEl, statusEl]),
      c.type === 'group' ? el('span', { class: 'msg-conv-tag' }, `${(c.members || []).length} members`) : null,
    ]);

    const thread = el('div', { class: 'msg-thread' }, el('p', { class: 'muted' }, 'Loading…'));
    const input = el('textarea', { class: 'msg-input', rows: '1', placeholder: 'Write a message…' });
    const fileInput = el('input', { type: 'file', style: 'display:none' });
    const attachB = el('button', { class: 'btn btn--ghost msg-attach', type: 'button', title: 'Attach a file' }, icon('paperclip'));
    const lockB = el('button', { class: 'btn btn--ghost msg-lock', type: 'button', title: 'Encrypt messages' }, icon('lock'));
    const sendB = el('button', { class: 'btn btn--primary msg-send', title: 'Send' }, icon('send'));
    const attachRow = el('div', { class: 'msg-attach-chip', style: 'display:none' });
    const encBanner = el('div', { class: 'msg-enc-banner', style: 'display:none' });
    let pendingFile = null;   // the File picked but not yet sent
    let sending = false;
    let encState = null;      // { algo, key } while encryption is enabled

    // In-memory decryption caches for this open conversation. Keys never persist.
    const decrypted = new Map();   // messageId -> plaintext
    const keyRing = [];            // [{ algo, key }] keys that have worked here

    const clearPending = () => { pendingFile = null; fileInput.value = ''; clear(attachRow); attachRow.style.display = 'none'; };
    const showPending = (f) => {
      pendingFile = f;
      clear(attachRow);
      attachRow.style.display = '';
      const remove = el('button', { class: 'msg-attach-x', type: 'button', title: 'Remove' }, icon('x'));
      remove.addEventListener('click', clearPending);
      attachRow.append(icon('paperclip'), el('span', { class: 'msg-attach-name' }, `${f.name} (${Math.round(f.size / 1024)} KB)`), remove);
    };
    attachB.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      // Images get compressed on send, so only cap non-image files up front.
      const isImage = (f.type || '').startsWith('image/');
      if (!isImage && f.size > MAX_ATTACHMENT_BYTES) { toast('File is too large (max 800 KB for non-images).', 'error'); fileInput.value = ''; return; }
      showPending(f);
    });

    // Toggle / configure encryption for outgoing messages.
    const refreshEncUI = () => {
      lockB.classList.toggle('is-active', !!encState);
      input.placeholder = encState ? `Write a message (encrypted · ${algoLabel(encState.algo)})…` : 'Write a message…';
      clear(encBanner);
      if (encState) {
        encBanner.style.display = '';
        const off = el('button', { class: 'msg-enc-banner-x', type: 'button', title: 'Turn off encryption' }, icon('x'));
        off.addEventListener('click', () => { encState = null; refreshEncUI(); });
        const change = el('button', { class: 'msg-enc-banner-change', type: 'button' }, 'Change');
        change.addEventListener('click', () => openEncSetup(encState));
        encBanner.append(icon('lock'), el('span', {}, `Encrypting with ${algoLabel(encState.algo)}`), change, off);
      } else {
        encBanner.style.display = 'none';
      }
    };
    // Enabling encryption is ROMIO Pro. (Free users can still DECRYPT messages
    // they receive — only turning it on for outgoing messages is gated.)
    lockB.addEventListener('click', () => {
      if (encState) { encState = null; refreshEncUI(); return; }
      if (!viewerIsPro()) { proGate('Chat encryption'); return; }
      openEncSetup(null);
    });
    refreshEncUI();

    const submit = async () => {
      const t = input.value.trim();
      if ((!t && !pendingFile) || sending) return;
      if (encState && !t) { toast('Type a message to encrypt.', 'error'); return; }
      sending = true; sendB.disabled = true; attachB.disabled = true;
      const file = pendingFile;
      const enc = encState;   // snapshot; user may toggle while sending
      input.value = ''; input.style.height = '';
      try {
        const attachment = file ? await buildAttachment(file) : null;
        clearPending();
        let encPayload = null;
        if (enc && t) {
          const cipher = await encryptMessage(enc.algo, enc.key, t);
          encPayload = { algo: enc.algo, cipher };
          // Remember the key so our own sent message auto-decrypts on screen.
          if (!keyRing.some((k) => k.algo === enc.algo && k.key === enc.key)) keyRing.push({ algo: enc.algo, key: enc.key });
        }
        await sendMessage(id, user, t, { attachment, enc: encPayload });
        primeAudio(); playSound('send');
        // Notify the other members so they get a Messages badge + bell entry.
        // Never include the plaintext of an encrypted message in the notification.
        const me = user.displayName || user.email;
        const body = encPayload ? 'Sent an encrypted message' : (t || (attachment ? `Attachment: ${attachment.name}` : ''));
        (c.members || []).filter((u) => u !== user.uid).forEach((uid) => notify(uid, {
          type: 'message',
          title: c.type === 'group' ? `${me} · ${convTitle(c)}` : `New message from ${me}`,
          body: body.slice(0, 80), actorId: user.uid, actorName: me,
          link: { view: 'messages', arg: id },
        }));
      } catch (e) { toast(e.message || 'Could not send.', 'error'); input.value = t; }
      finally { sending = false; sendB.disabled = false; attachB.disabled = false; }
    };
    sendB.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(120, input.scrollHeight)}px`; });
    chatPane.append(head, thread, el('div', { class: 'msg-composer' }, [
      fileInput,
      encBanner,
      attachRow,
      el('div', { class: 'msg-composer-row' }, [attachB, lockB, input, sendB]),
    ]));

    // The "choose type + set key" dialog. `preset` pre-fills when changing.
    function openEncSetup(preset) {
      const { body, close } = openModal({ title: 'Encrypt messages', iconName: 'lock' });
      let algo = (preset && preset.algo) || ENCRYPTIONS[0].id;
      const keyInput = el('input', { class: 'input', type: 'text', value: (preset && preset.key) || '', autocomplete: 'off' });
      const hint = el('p', { class: 'muted msg-enc-hint' }, '');
      const keyLabel = el('label', { class: 'msg-enc-label' }, '');
      const typeList = el('div', { class: 'msg-enc-types' });
      const syncType = () => {
        const meta = ENCRYPTIONS.find((e) => e.id === algo) || ENCRYPTIONS[0];
        keyLabel.textContent = meta.keyLabel;
        keyInput.placeholder = meta.keyPh;
        hint.textContent = meta.hint;
        for (const btn of typeList.children) btn.classList.toggle('is-chosen', btn.dataset.algo === algo);
      };
      ENCRYPTIONS.forEach((e) => {
        const btn = el('button', { class: 'msg-enc-type', type: 'button' }, [
          el('span', { class: 'msg-enc-type-label' }, e.label),
          el('span', { class: 'msg-enc-type-hint muted' }, e.hint),
        ]);
        btn.dataset.algo = e.id;
        btn.addEventListener('click', () => { algo = e.id; syncType(); keyInput.focus(); });
        typeList.append(btn);
      });
      const enableBtn = el('button', { class: 'btn btn--primary' }, 'Enable encryption');
      const cancelBtn = el('button', { class: 'btn btn--ghost' }, 'Cancel');
      const apply = () => {
        const key = keyInput.value.trim();
        if (!key) { toast('Enter a key first.', 'error'); keyInput.focus(); return; }
        encState = { algo, key };
        refreshEncUI();
        close();
        input.focus();
      };
      enableBtn.addEventListener('click', apply);
      cancelBtn.addEventListener('click', close);
      keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
      body.append(
        el('p', { class: 'muted msg-enc-intro' }, 'Pick a method and a secret key. The other person must know the same method and key to read it — share the key with them another way.'),
        typeList,
        el('div', { class: 'msg-enc-field' }, [keyLabel, keyInput, hint]),
        el('div', { class: 'msg-enc-actions' }, [cancelBtn, enableBtn]),
      );
      syncType();
      keyInput.focus();
    }

    // Prompt for a key to decrypt one received message; caches the key on success.
    function openDecryptPrompt(m) {
      const { body, close } = openModal({ title: `Decrypt · ${algoLabel(m.encAlgo)}`, iconName: 'lock-open' });
      const meta = ENCRYPTIONS.find((e) => e.id === m.encAlgo) || {};
      const keyInput = el('input', { class: 'input', type: 'text', placeholder: meta.keyPh || 'Key', autocomplete: 'off' });
      const err = el('p', { class: 'msg-enc-err', style: 'display:none' }, '');
      const okBtn = el('button', { class: 'btn btn--primary' }, 'Decrypt');
      const cancelBtn = el('button', { class: 'btn btn--ghost' }, 'Cancel');
      const attempt = async () => {
        const key = keyInput.value.trim();
        if (!key) { keyInput.focus(); return; }
        try {
          const plain = await decryptMessage(m.encAlgo, key, m.cipher);
          decrypted.set(m.id, plain);
          if (!keyRing.some((k) => k.algo === m.encAlgo && k.key === key)) keyRing.push({ algo: m.encAlgo, key });
          close();
          renderThread(lastMsgs);
        } catch (e) { err.textContent = e.message || 'Could not decrypt.'; err.style.display = ''; }
      };
      okBtn.addEventListener('click', attempt);
      cancelBtn.addEventListener('click', close);
      keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); attempt(); } });
      body.append(
        el('p', { class: 'muted' }, `Enter the ${(meta.keyLabel || 'key').toLowerCase()} the sender used.`),
        keyInput, err,
        el('div', { class: 'msg-enc-actions' }, [cancelBtn, okBtn]),
      );
      keyInput.focus();
    }

    // Try every cached key against still-locked messages; re-render if any open.
    async function tryAutoDecrypt(msgs) {
      let changed = false;
      for (const m of msgs) {
        if (!m.encrypted || decrypted.has(m.id)) continue;
        for (const k of keyRing) {
          if (k.algo !== m.encAlgo) continue;
          try { decrypted.set(m.id, await decryptMessage(m.encAlgo, k.key, m.cipher)); changed = true; break; } catch { /* key doesn't fit */ }
        }
      }
      if (changed) renderThread(lastMsgs);
    }

    let lastMsgs = [];
    function renderThread(msgs) {
      lastMsgs = msgs;
      clear(thread);
      if (!msgs.length) { thread.append(el('p', { class: 'muted msg-empty' }, 'No messages yet. Say hi!')); return; }
      let lastSender = null;
      for (const m of msgs) {
        const mine = m.senderId === user.uid;
        const grouped = m.senderId === lastSender;
        lastSender = m.senderId;
        const when = m.createdAt?.toDate ? timeAgo(m.createdAt.toDate()) : '';
        thread.append(el('div', { class: `msg-bubble-row ${mine ? 'is-mine' : ''}` }, [
          el('div', { class: 'msg-bubble' }, [
            (!mine && c.type === 'group' && !grouped) ? el('div', { class: 'msg-bubble-name' }, m.senderName || '') : null,
            ...encryptedBubbleBody(m),
            m.attachment ? attachmentNode(m.attachment) : null,
            el('div', { class: 'msg-bubble-time' }, when),
          ]),
        ]));
      }
      thread.scrollTop = thread.scrollHeight;
      tryAutoDecrypt(msgs);
    }

    // Returns the text portion of a bubble: plain text, decrypted text, or a
    // locked placeholder with a Decrypt button for still-encrypted messages.
    function encryptedBubbleBody(m) {
      if (!m.encrypted) return m.text ? [el('div', { class: 'msg-bubble-text' }, linkifyText(m.text))] : [];
      const plain = decrypted.get(m.id);
      if (plain != null) {
        return [
          el('div', { class: 'msg-enc-tag' }, [icon('lock-open'), `Decrypted · ${algoLabel(m.encAlgo)}`]),
          el('div', { class: 'msg-bubble-text' }, linkifyText(plain)),
        ];
      }
      const btn = el('button', { class: 'msg-enc-decrypt', type: 'button' }, [icon('key'), 'Decrypt']);
      btn.addEventListener('click', () => openDecryptPrompt(m));
      return [
        el('div', { class: 'msg-enc-locked' }, [icon('lock'), `Encrypted · ${algoLabel(m.encAlgo)}`]),
        btn,
      ];
    }

    msgUnsub = listenMessages(id, renderThread);
  }

  function openNewMessage() {
    const { body, close } = openModal({ title: 'New message', iconName: 'edit' });
    const search = el('input', { class: 'input', placeholder: 'Search people…', autofocus: 'autofocus' });
    const results = el('div', { class: 'msg-people' }, el('p', { class: 'muted' }, 'Loading people…'));
    body.append(search, results);
    let all = [];
    const loaded = Object.values(usersById);
    const seed = (u) => { all = u.filter((x) => x.uid !== user.uid); draw(''); };
    if (loaded.length) seed(loaded);
    else listAllUsers().then((u) => { for (const x of u) usersById[x.uid] = x; seed(u); }).catch(() => { clear(results); results.append(el('p', { class: 'muted' }, 'Could not load people.')); });
    function draw(q) {
      clear(results);
      const ql = q.trim().toLowerCase();
      const list = all.filter((u) => !ql || (u.displayName || '').toLowerCase().includes(ql) || (u.username || '').toLowerCase().includes(ql)).slice(0, 25);
      if (!list.length) { results.append(el('p', { class: 'muted' }, 'No people found.')); return; }
      for (const u of list) {
        const b = el('button', { class: 'msg-person', type: 'button' }, [
          avatarNode(u.displayName || u.username, u.photoURL, 'msg-avatar'),
          el('div', { class: 'msg-person-main' }, [el('div', {}, u.displayName || u.username || 'User'), u.username ? el('div', { class: 'muted' }, `@${u.username}`) : null]),
        ]);
        b.addEventListener('click', async () => {
          close();
          try {
            const id = await ensureDirectConversation(
              { uid: user.uid, name: user.displayName || user.email },
              { uid: u.uid, name: u.displayName || u.username || u.email, photoURL: u.photoURL },
            );
            openConv(id);
          } catch (e) { toast(e.message || 'Could not start chat.', 'error'); }
        });
        results.append(b);
      }
    }
    search.addEventListener('input', () => draw(search.value));
  }

  // Load all users once for current names/photos (also powers New-message search).
  listAllUsers().then((list) => { for (const u of list) usersById[u.uid] = u; drawList(); }).catch(() => {});

  const convUnsub = listenConversations(user.uid, (list) => {
    convs = list;
    for (const c of list) {
      if (c.type === 'group' && c.workspaceId) ensureWs(c.workspaceId);
      if (c.type === 'direct') ensurePresence(otherOf(c));   // live online/offline dot
    }
    drawList();
    // Refresh the open thread's header once its conversation metadata arrives.
    if (activeId && convs.find((c) => c.id === activeId) && !chatPane.querySelector('.msg-thread')) openConv(activeId);
  });

  if (initialConvId) openConv(initialConvId);

  return () => {
    if (convUnsub) convUnsub();
    if (msgUnsub) msgUnsub();
    clearInterval(presenceTick);
    for (const un of presenceUnsubs.values()) { try { un(); } catch { /* ignore */ } }
    presenceUnsubs.clear();
  };
}
