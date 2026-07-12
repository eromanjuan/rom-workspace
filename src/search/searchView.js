// Global search: People, Posts, and Workspaces. People open a public profile,
// posts are fully interactive (like/comment), and workspaces you're not in get
// an "Ask to join" button (a join request the owner approves).
import { el, clear, icon, toast } from '../ui/dom.js';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase.js';
import {
  listAllUsers, listAllWorkspaces, listMyWorkspaces,
  requestToJoin, getMyJoinRequest, cancelJoinRequest, setCurrentWorkspace,
} from '../workspaces/data.js';
import { roleLabel } from '../workspaces/roles.js';
import { postCard } from '../feed/feed.js';

const initials = (name) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

export function renderSearch(host, user, initialTerm, { onOpenUser, onOpenWorkspace }) {
  clear(host);
  let users = [];
  let workspaces = [];
  let myWs = new Map();
  let lastDocs = [];
  const expanded = new Set();
  const drafts = new Map();

  const input = el('input', { class: 'input search-input', type: 'search', placeholder: 'Search people, posts, workspaces…', value: initialTerm || '' });
  const peopleBox = el('div', { class: 'search-results' });
  const wsBox = el('div', { class: 'search-results' });
  const postsBox = el('div', { class: 'search-results search-posts' });

  const section = (title, ic, box) => el('section', { class: 'search-section' }, [
    el('h3', { class: 'search-section-title' }, [icon(ic), ' ', title]),
    box,
  ]);

  host.append(el('div', { class: 'search-page' }, [
    el('div', { class: 'search-bar' }, [icon('search'), input]),
    section('People', 'users', peopleBox),
    section('Workspaces', 'building-store', wsBox),
    section('Posts', 'news', postsBox),
  ]));

  const term = () => input.value.trim().toLowerCase();

  // ---------- People ----------
  function renderPeople() {
    const q = term();
    clear(peopleBox);
    if (!q) { peopleBox.append(hint('Type to search people.')); return; }
    const res = users.filter((u) => u.uid !== user.uid && matchUser(u, q)).slice(0, 20);
    if (!res.length) { peopleBox.append(empty('No people found.')); return; }
    for (const u of res) {
      const name = u.displayName || u.email || 'User';
      peopleBox.append(el('button', { class: 'search-row', onclick: () => onOpenUser(u.uid) }, [
        el('span', { class: 'search-avatar' }, initials(name)),
        el('span', { class: 'search-row-main' }, [
          el('b', {}, name),
          el('span', { class: 'muted' }, u.username ? `@${u.username}` : (u.email || '')),
        ]),
        el('span', { class: 'search-go muted' }, icon('chevron-right')),
      ]));
    }
  }

  // ---------- Workspaces ----------
  function renderWorkspaces() {
    const q = term();
    clear(wsBox);
    if (!q) { wsBox.append(hint('Type to find workspaces to join.')); return; }
    const res = workspaces.filter((w) => (w.name || '').toLowerCase().includes(q)).slice(0, 20);
    if (!res.length) { wsBox.append(empty('No workspaces found.')); return; }
    for (const w of res) wsBox.append(workspaceRow(w));
  }

  function workspaceRow(w) {
    const avatar = w.imageUrl
      ? el('span', { class: 'search-avatar search-avatar--img' }, el('img', { src: w.imageUrl, alt: '' }))
      : el('span', { class: 'search-avatar', style: `background:${w.color || '#5b8cff'}` }, icon(w.icon || 'layout-dashboard'));
    const action = el('span', { class: 'search-action' });
    const row = el('div', { class: 'search-row search-row--static' }, [
      avatar,
      el('span', { class: 'search-row-main' }, [el('b', {}, w.name || 'Workspace'), el('span', { class: 'muted' }, w.description || 'Workspace')]),
      action,
    ]);

    const myRole = myWs.get(w.id);
    if (myRole) {
      const open = el('button', { class: 'btn btn--ghost btn--sm' }, [icon('arrow-up-right'), ' Open']);
      open.addEventListener('click', async () => { try { await setCurrentWorkspace(user.uid, w.id); onOpenWorkspace(); } catch (e) { toast(e.message, 'error'); } });
      action.append(el('span', { class: 'pill pill--editor' }, roleLabel(myRole)), open);
    } else {
      const joinBtn = el('button', { class: 'btn btn--primary btn--sm' }, [icon('user-plus'), ' Ask to join']);
      const setRequested = () => { clear(action).append(el('span', { class: 'pill pill--viewer' }, 'Requested'), el('button', { class: 'link-danger', title: 'Cancel request', onclick: async () => { try { await cancelJoinRequest(w.id, user.uid); clear(action).append(joinBtn); } catch (e) { toast(e.message, 'error'); } } }, icon('x'))); };
      joinBtn.addEventListener('click', async () => {
        joinBtn.disabled = true;
        try { await requestToJoin(w.id, user); setRequested(); toast('Join request sent to the owner.', 'success'); }
        catch (e) { toast(e.message, 'error'); joinBtn.disabled = false; }
      });
      action.append(joinBtn);
      getMyJoinRequest(w.id, user.uid).then((r) => { if (r) setRequested(); }).catch(() => {});
    }
    return row;
  }

  // ---------- Posts (live) ----------
  function renderPosts() {
    const q = term();
    clear(postsBox);
    if (!q) { postsBox.append(hint('Type to search posts.')); return; }
    const vis = lastDocs.filter((d) => {
      const p = d.data();
      return (p.hidden !== true || p.authorId === user.uid) && (p.text || '').toLowerCase().includes(q);
    }).slice(0, 20);
    if (!vis.length) { postsBox.append(empty('No posts match.')); return; }
    for (const d of vis) postsBox.append(postCard(d, user, { expanded, drafts, paint: renderPosts }));
  }

  // debounced refine
  let t = null;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { renderPeople(); renderWorkspaces(); renderPosts(); }, 200); });
  setTimeout(() => input.focus(), 0);

  // fetch data
  renderPeople(); renderWorkspaces(); renderPosts();
  listAllUsers().then((u) => { users = u; renderPeople(); }).catch(() => {});
  Promise.all([listAllWorkspaces(), listMyWorkspaces(user.uid)])
    .then(([all, mine]) => { workspaces = all; myWs = new Map(mine.map((w) => [w.id, w.myRole])); renderWorkspaces(); })
    .catch(() => {});
  const unsub = onSnapshot(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(200)), (snap) => { lastDocs = snap.docs; renderPosts(); }, () => {});

  return () => { if (unsub) unsub(); };
}

function matchUser(u, q) {
  return (u.displayName || '').toLowerCase().includes(q)
    || (u.username || '').toLowerCase().includes(q)
    || (u.email || '').toLowerCase().includes(q);
}
function hint(text) { return el('p', { class: 'muted search-hint' }, text); }
function empty(text) { return el('p', { class: 'muted search-empty' }, text); }
