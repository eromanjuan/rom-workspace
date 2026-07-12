// Messages: a two-pane chat (conversation list + active thread). Direct chats
// and workspace group chats live in the same list. New DMs are started by
// searching people. On mobile, selecting a conversation slides in the thread.
import { el, clear, icon, toast, timeAgo, openModal } from '../ui/dom.js';
import { listAllUsers, notify } from '../workspaces/data.js';
import { avatarNode } from '../profile/avatar.js';
import { listenConversations, listenMessages, sendMessage, getConversation, ensureDirectConversation } from './messagesData.js';

export function renderMessages(host, user, { initialConvId, onOpenUser } = {}) {
  clear(host);
  let convs = [];
  let activeId = null;
  let msgUnsub = null;

  const otherOf = (c) => (c.members || []).find((u) => u !== user.uid);
  const convTitle = (c) => (c.type === 'group' ? (c.name || 'Workspace') : ((c.memberNames && c.memberNames[otherOf(c)]) || 'Direct message'));
  const convPhoto = (c) => (c.type === 'group' ? '' : (c.memberPhotos && c.memberPhotos[otherOf(c)]) || '');
  const convAvatar = (c) => (c.type === 'group'
    ? el('div', { class: 'msg-avatar msg-avatar--group' }, icon('users'))
    : avatarNode(convTitle(c), convPhoto(c), 'msg-avatar'));

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
      const row = el('button', { class: `msg-conv ${c.id === activeId ? 'is-active' : ''}` }, [
        convAvatar(c),
        el('div', { class: 'msg-conv-main' }, [
          el('div', { class: 'msg-conv-title' }, convTitle(c)),
          el('div', { class: 'msg-conv-last muted' }, last),
        ]),
        c.type === 'group' ? el('span', { class: 'msg-conv-tag' }, 'Group') : null,
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
    const head = el('div', { class: 'msg-chat-head' }, [back, convAvatar(c), titleEl, c.type === 'group' ? el('span', { class: 'msg-conv-tag' }, `${(c.members || []).length} members`) : null]);

    const thread = el('div', { class: 'msg-thread' }, el('p', { class: 'muted' }, 'Loading…'));
    const input = el('textarea', { class: 'msg-input', rows: '1', placeholder: 'Write a message…' });
    const sendB = el('button', { class: 'btn btn--primary msg-send', title: 'Send' }, icon('send'));
    const submit = async () => {
      const t = input.value.trim(); if (!t) return;
      input.value = ''; input.style.height = '';
      try {
        await sendMessage(id, user, t);
        // Notify the other members so they get a Messages badge + bell entry.
        const me = user.displayName || user.email;
        (c.members || []).filter((u) => u !== user.uid).forEach((uid) => notify(uid, {
          type: 'message',
          title: c.type === 'group' ? `${me} · ${convTitle(c)}` : `New message from ${me}`,
          body: t.slice(0, 80), actorId: user.uid, actorName: me,
          link: { view: 'messages', arg: id },
        }));
      } catch (e) { toast(e.message || 'Could not send.', 'error'); }
    };
    sendB.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(120, input.scrollHeight)}px`; });
    chatPane.append(head, thread, el('div', { class: 'msg-composer' }, [input, sendB]));

    msgUnsub = listenMessages(id, (msgs) => {
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
            el('div', { class: 'msg-bubble-text' }, m.text),
            el('div', { class: 'msg-bubble-time' }, when),
          ]),
        ]));
      }
      thread.scrollTop = thread.scrollHeight;
    });
  }

  function openNewMessage() {
    const { body, close } = openModal({ title: 'New message', iconName: 'edit' });
    const search = el('input', { class: 'input', placeholder: 'Search people…', autofocus: 'autofocus' });
    const results = el('div', { class: 'msg-people' }, el('p', { class: 'muted' }, 'Loading people…'));
    body.append(search, results);
    let all = [];
    listAllUsers().then((u) => { all = u.filter((x) => x.uid !== user.uid); draw(''); }).catch(() => { clear(results); results.append(el('p', { class: 'muted' }, 'Could not load people.')); });
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

  const convUnsub = listenConversations(user.uid, (list) => {
    convs = list;
    drawList();
    // Refresh the open thread's header once its conversation metadata arrives.
    if (activeId && convs.find((c) => c.id === activeId) && !chatPane.querySelector('.msg-thread')) openConv(activeId);
  });

  if (initialConvId) openConv(initialConvId);

  return () => { if (convUnsub) convUnsub(); if (msgUnsub) msgUnsub(); };
}
