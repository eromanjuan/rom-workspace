// The workspace "builder home" — a faithful reimplementation of the quest-hq
// Workspace Builder core: an Activity feed (Post/File/Link/Question + Create task),
// a Customize + Apps sidebar, and the app builder. Everything respects the
// viewer's role (owner / editor / viewer); the master account is treated as owner.
import { el, clear, icon, escapeHtml, timeAgo, toast, openModal } from '../ui/dom.js';
import { canWrite, canManage, roleLabel, INVITABLE_ROLES } from './roles.js';
import {
  getWorkspace, getMyRole, renameWorkspace,
  listMembers, changeMemberRole, removeMember,
  createInvite, listInvites, revokeInvite,
  addFeedPost, subscribeFeed, deleteFeedPost,
  addTile, subscribeTiles, updateTile, deleteTile,
  addTask, subscribeTasks, toggleTask, deleteTask, appRecordCounts,
  listApps,
} from './data.js';
import { openAddAppModal, renderApp } from './appBuilder.js';

export async function renderWorkspace(root, user, wsId, onBack) {
  clear(root);
  root.append(el('p', { class: 'muted' }, 'Loading workspace…'));

  let ws, myRole;
  try {
    ws = await getWorkspace(wsId);
    myRole = await getMyRole(wsId, user.uid);
  } catch (err) {
    clear(root);
    root.append(el('p', { class: 'error-text' }, `Could not open workspace: ${err.message}`));
    return;
  }
  if (!ws || !myRole) {
    clear(root);
    root.append(el('p', { class: 'error-text' }, 'Workspace not found or you are not a member.'));
    return;
  }

  clear(root);
  const writer = canWrite(myRole);
  const manager = canManage(myRole);
  let unsubs = [];
  const stop = () => { unsubs.forEach((u) => u && u()); unsubs = []; };

  // --- top app-tab bar (Activity + one tab per app + Add app) ---
  const region = el('div', { class: 'wb-region' });
  const apptabs = el('div', { class: 'wb-apptabs' });
  let apps = [];
  let activeTab = 'home'; // 'home' | 'members' | 'invites' | app id

  const addAppBtn = writer
    ? el('button', { class: 'wb-topbar-add', onclick: () => openAddApp() }, [icon('plus'), ' Add app'])
    : null;

  const topbar = el('div', { class: 'wb-topbar' }, [
    apptabs,
    el('div', { class: 'wb-topbar-right' }, [
      el('button', { class: 'wb-topbar-link', onclick: () => openMembers() }, 'Members'),
      el('button', { class: 'wb-topbar-link', onclick: () => openInvites() }, 'Invites'),
      addAppBtn,
      el('button', { class: 'btn btn--ghost', onclick: () => { stop(); onBack(); } }, 'Workspaces'),
    ]),
  ]);

  function drawTabs() {
    clear(apptabs);
    apptabs.append(el('button', {
      class: `wb-apptab ${activeTab === 'home' ? 'wb-apptab--active' : ''}`, onclick: () => openHome(),
    }, [icon('activity'), ' Activity']));
    for (const a of apps) {
      apptabs.append(el('button', {
        class: `wb-apptab ${activeTab === a.id ? 'wb-apptab--active' : ''}`, onclick: () => openAppView(a.id),
      }, [el('span', { class: 'wb-apptab-ic', style: `background:${a.color || '#e0552d'}` }, icon(a.icon || 'apps')), ' ' + a.name]));
    }
  }
  async function loadTabs() {
    try { apps = await listApps(wsId); } catch { apps = []; }
    drawTabs();
  }

  // --- header ---
  const titleSpan = el('span', {}, ws.name);
  const subEl = el('div', { class: 'wb-sub' }, `Build customizable, no-code dashboards for ${ws.name}.`);
  const header = el('div', { class: 'wb-header' }, [
    el('div', { class: 'wb-header-icon' }, icon('layout-dashboard')),
    el('div', {}, [
      el('div', { class: 'wb-title' }, [
        titleSpan,
        el('span', { class: `pill pill--${myRole}` }, roleLabel(myRole)),
      ]),
      subEl,
    ]),
  ]);

  root.append(el('div', { class: 'ws-detail' }, [topbar, header, region]));

  // Rename via a modal (no native prompt).
  function openRenameModal() {
    const { body, close } = openModal({ title: 'Rename workspace', iconName: 'edit' });
    const input = el('input', { class: 'input', value: ws.name });
    const save = el('button', { class: 'btn btn--primary' }, 'Save');
    save.addEventListener('click', async () => {
      const name = input.value.trim();
      if (!name || name === ws.name) return close();
      try {
        await renameWorkspace(wsId, name);
        ws.name = name; titleSpan.textContent = name;
        subEl.textContent = `Build customizable, no-code dashboards for ${name}.`;
        toast('Renamed', 'success'); close();
      } catch (err) { toast(err.message, 'error'); }
    });
    body.append(el('div', { class: 'field-modal' }, [
      el('label', { class: 'form-label' }, 'Workspace name'), input,
      el('div', { class: 'app-create-foot' }, [el('button', { class: 'btn btn--ghost', onclick: close }, 'Cancel'), save]),
    ]));
  }

  function openHome() { activeTab = 'home'; drawTabs(); stop(); clear(region); renderHome(region); }
  function openMembers() { activeTab = 'members'; drawTabs(); stop(); clear(region); renderMembers(region, user, wsId, ws, manager); }
  function openInvites() { activeTab = 'invites'; drawTabs(); stop(); clear(region); renderInvites(region, user, wsId, writer); }
  function openAppView(appId) { activeTab = appId; drawTabs(); stop(); clear(region); renderApp(region, wsId, user, appId, writer, () => { loadTabs(); openHome(); }); }
  function openAddApp() { openAddAppModal(wsId, user, (id) => { loadTabs().then(() => openAppView(id)); }); }

  loadTabs();

  // --- the Activity home: feed column + sidebar ---
  function renderHome(host) {
    const feedCol = el('div', { class: 'wb-feedcol' });
    if (writer) feedCol.append(buildComposer(wsId, user));
    const stream = el('div', { class: 'wb-feed' }, el('p', { class: 'muted' }, 'Loading activity…'));
    feedCol.append(stream);

    // A live container for the user-defined dashboard tiles.
    const tilesWrap = el('div', { class: 'wb-tiles' });
    const sidebar = el('aside', { class: 'wb-sidebar' }, [
      el('button', {
        class: 'wb-customize',
        onclick: (e) => {
          if (!manager) return toast('Only the owner can customize this workspace.', 'error');
          openCustomizeMenu(e.currentTarget);
        },
      }, [icon('settings'), ' Customize']),
      tilesWrap,
    ]);

    host.append(el('div', { class: 'wb-body' }, [feedCol, sidebar]));

    // live feed
    unsubs.push(subscribeFeed(wsId, (posts) => {
      clear(stream);
      if (!posts.length) { stream.append(el('p', { class: 'muted' }, 'No activity yet.')); return; }
      for (const p of posts) stream.append(renderFeedPost(p, user, myRole, wsId));
    }, (err) => {
      clear(stream);
      stream.append(el('p', { class: 'error-text' }, `Feed error: ${err.message}`));
    }));

    // live tiles — inner tile listeners (e.g. Tasks) are tracked so they get
    // torn down whenever the tile list re-renders or we leave the workspace.
    const tileSubs = [];
    unsubs.push(() => { tileSubs.forEach((u) => u && u()); tileSubs.length = 0; });
    unsubs.push(subscribeTiles(wsId, (tiles) => {
      tileSubs.forEach((u) => u && u()); tileSubs.length = 0;
      clear(tilesWrap);
      for (const t of tiles) tilesWrap.append(renderTile(t, wsId, user, writer, tileSubs));
    }, () => { /* ignore tile errors */ }));
  }

  // Customize: add a tile or rename the workspace.
  function openCustomizeMenu(anchor) {
    const menu = el('div', { class: 'wb-menu' }, [
      el('div', { class: 'wb-menu-title' }, 'Add a tile'),
      tileMenuItem('note', 'Text / Welcome', () => addAndClose({ type: 'text', title: 'Welcome!', body: '' })),
      tileMenuItem('checklist', 'Tasks', () => addAndClose({ type: 'tasks', title: 'Workspace tasks' })),
      tileMenuItem('chart-bar', 'Report', () => addAndClose({ type: 'report', title: 'Report' })),
      el('div', { class: 'wb-menu-sep' }),
      tileMenuItem('edit', 'Rename workspace', () => { closeMenu(); openRenameModal(); }),
    ]);
    function tileMenuItem(ic, label, onclick) {
      return el('button', { class: 'wb-menu-item', onclick }, [icon(ic), el('span', {}, label)]);
    }
    async function addAndClose(tile) {
      closeMenu();
      try { await addTile(wsId, tile, user.uid); toast('Tile added', 'success'); }
      catch (err) { toast(err.message, 'error'); }
    }
    function closeMenu() { menu.remove(); document.removeEventListener('click', onDoc, true); }
    function onDoc(e) { if (!menu.contains(e.target) && e.target !== anchor) closeMenu(); }
    anchor.parentElement.insertBefore(menu, anchor.nextSibling);
    setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  }

  openHome();
}

function tileIcon(type) { return { text: 'note', tasks: 'checklist', report: 'chart-bar' }[type] || 'square'; }
function tileLabel(type) { return { text: 'Text', tasks: 'Tasks', report: 'Report' }[type] || 'Tile'; }

// Render a single dashboard tile by type. Pushes any live listener into `subs`.
function renderTile(tile, wsId, user, writer, subs) {
  const head = el('div', { class: 'wb-tile-head' }, [
    el('span', {}, [icon(tileIcon(tile.type)), ' ' + (tile.title || tileLabel(tile.type))]),
    writer ? el('button', {
      class: 'wb-tile-add', title: 'Remove tile',
      onclick: async () => {
        if (!confirm('Remove this tile?')) return;
        try { await deleteTile(wsId, tile.id); } catch (err) { toast(err.message, 'error'); }
      },
    }, icon('x')) : null,
  ]);
  const body = el('div', { class: 'wb-tile-body' });
  if (tile.type === 'text') renderTextTile(body, tile, wsId, writer);
  else if (tile.type === 'tasks') renderTasksTile(body, tile, wsId, writer, user, subs);
  else if (tile.type === 'report') renderReportTile(body, wsId);
  return el('div', { class: 'wb-tile card' }, [head, body]);
}

/* ------------------------------ tile bodies ------------------------------ */

function renderTextTile(body, tile, wsId, writer) {
  const view = el('div', { class: 'wb-text' }, tile.body
    ? el('div', { html: escapeHtml(tile.body).replace(/\n/g, '<br>') })
    : el('span', { class: 'muted' }, writer ? 'Click edit to add text.' : 'No text yet.'));
  body.append(view);
  if (!writer) return;
  const editBtn = el('button', { class: 'wb-text-edit link', onclick: () => {
    const ta = el('textarea', { class: 'input', rows: '3' });
    ta.value = tile.body || '';
    const save = el('button', { class: 'btn btn--primary btn--sm', onclick: async () => {
      try { await updateTile(wsId, tile.id, { body: ta.value }); toast('Saved', 'success'); }
      catch (err) { toast(err.message, 'error'); }
    } }, 'Save');
    clear(body).append(ta, save);
  } }, 'Edit');
  body.append(editBtn);
}

function renderTasksTile(body, tile, wsId, writer, user, subs) {
  const list = el('div', { class: 'wb-tasklist' }, el('span', { class: 'muted' }, 'Loading…'));
  body.append(list);
  if (writer) {
    const input = el('input', { class: 'input input--sm', placeholder: 'Add a task…' });
    const form = el('form', { class: 'wb-taskadd', onsubmit: async (e) => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      input.value = '';
      try { await addTask(wsId, title, user.uid); } catch (err) { toast(err.message, 'error'); }
    } }, [input, el('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, icon('plus'))]);
    body.append(form);
  }
  // live tasks (tracked so the listener is torn down on re-render / leave)
  const unsub = subscribeTasks(wsId, (tasks) => {
    clear(list);
    if (!tasks.length) { list.append(el('span', { class: 'muted' }, 'No tasks yet.')); return; }
    for (const t of tasks) {
      const chk = el('input', { type: 'checkbox', ...(t.done ? { checked: 'checked' } : {}) });
      chk.disabled = !writer;
      chk.addEventListener('change', () => toggleTask(wsId, t.id, chk.checked).catch((e) => toast(e.message, 'error')));
      list.append(el('div', { class: `wb-task ${t.done ? 'wb-task--done' : ''}` }, [
        chk, el('span', { class: 'wb-task-title' }, t.title),
        writer ? el('button', { class: 'link-danger', onclick: () => deleteTask(wsId, t.id).catch((e) => toast(e.message, 'error')) }, icon('x')) : null,
      ]));
    }
  }, () => {});
  if (subs) subs.push(unsub);
}

async function renderReportTile(body, wsId) {
  clear(body).append(el('span', { class: 'muted' }, 'Loading…'));
  try {
    const rows = await appRecordCounts(wsId);
    clear(body);
    if (!rows.length) { body.append(el('span', { class: 'muted' }, 'No apps to report on yet.')); return; }
    const max = Math.max(1, ...rows.map((r) => r.count));
    for (const r of rows) {
      body.append(el('div', { class: 'wb-report-row' }, [
        el('div', { class: 'wb-report-label' }, [icon(r.icon), ' ' + r.name]),
        el('div', { class: 'wb-report-track' }, el('div', { class: 'wb-report-bar', style: `width:${Math.round((r.count / max) * 100)}%` })),
        el('div', { class: 'wb-report-count' }, `${r.count}`),
      ]));
    }
  } catch (err) {
    clear(body).append(el('span', { class: 'error-text' }, err.message));
  }
}

/* ------------------------------ composer ------------------------------ */

const COMPOSE_MODES = [
  { id: 'post', label: 'Post', icon: 'message' },
  { id: 'file', label: 'File', icon: 'paperclip' },
  { id: 'link', label: 'Link', icon: 'link' },
  { id: 'question', label: 'Question', icon: 'help' },
];

function buildComposer(wsId, user) {
  let mode = 'post';
  const wrap = el('div', { class: 'wb-composer card' });

  function draw() {
    clear(wrap);
    const tabs = el('div', { class: 'wb-compose-tabs' }, COMPOSE_MODES.map((m) => el('button', {
      class: `wb-compose-tab ${m.id === mode ? 'wb-compose-tab--active' : ''}`,
      type: 'button', onclick: () => { mode = m.id; draw(); },
    }, [icon(m.icon), ' ' + m.label])));

    const urlInput = el('input', {
      class: 'input', type: 'url',
      placeholder: mode === 'file' ? 'Paste a file link (URL)' : 'Paste a link (URL)',
    });
    const text = el('textarea', {
      class: 'wb-compose-text', rows: '2',
      placeholder: mode === 'question' ? 'Ask a question…' : 'Share something. Use @ to mention individuals.',
    });

    const taskChk = el('input', { type: 'checkbox', id: `task-${wsId}` });
    const shareBtn = el('button', { class: 'btn btn--primary', type: 'button' }, [icon('send'), ' Share']);

    shareBtn.addEventListener('click', async () => {
      const body = text.value.trim();
      const url = (mode === 'link' || mode === 'file') ? urlInput.value.trim() : '';
      if (!body && !url) return;
      shareBtn.disabled = true;
      try {
        await addFeedPost(wsId, { mode, text: body, url, isTask: taskChk.checked }, user);
        text.value = ''; if (urlInput) urlInput.value = ''; taskChk.checked = false;
      } catch (err) { toast(err.message, 'error'); }
      finally { shareBtn.disabled = false; }
    });

    wrap.append(
      tabs,
      (mode === 'link' || mode === 'file') ? urlInput : null,
      text,
      el('div', { class: 'wb-compose-foot' }, [
        el('label', { class: 'wb-compose-task' }, [taskChk, icon('checkbox'), ' Create task']),
        shareBtn,
      ]),
    );
  }
  draw();
  return wrap;
}

function renderFeedPost(p, user, myRole, wsId) {
  const when = p.createdAt?.toDate ? timeAgo(p.createdAt.toDate()) : '';
  const modeMeta = COMPOSE_MODES.find((m) => m.id === p.mode) || COMPOSE_MODES[0];
  const canDelete = p.authorId === user.uid || myRole === 'owner';

  return el('div', { class: 'wb-post card' }, [
    el('div', { class: 'wb-post-head' }, [
      el('span', { class: 'wb-post-author' }, p.authorName || 'Someone'),
      p.mode && p.mode !== 'post' ? el('span', { class: 'wb-post-badge' }, [icon(modeMeta.icon), ' ' + modeMeta.label]) : null,
      p.isTask ? el('span', { class: 'wb-post-badge wb-post-badge--task' }, [icon('check'), ' Task']) : null,
      el('span', { class: 'wb-post-time muted' }, when),
    ]),
    p.text ? el('div', { class: 'wb-post-body', html: escapeHtml(p.text).replace(/\n/g, '<br>') }) : null,
    p.url ? el('a', { class: 'wb-post-link', href: p.url, target: '_blank', rel: 'noopener' }, p.url) : null,
    canDelete ? el('button', {
      class: 'wb-post-del', title: 'Delete',
      onclick: async () => { try { await deleteFeedPost(wsId, p.id); } catch (err) { toast(err.message, 'error'); } },
    }, icon('x')) : null,
  ]);
}

/* ------------------------------ Members ------------------------------ */

async function renderMembers(host, user, wsId, ws, manager) {
  host.append(el('h3', { class: 'wb-section-title' }, 'Members'));
  const box = el('div', { class: 'members' }, el('p', { class: 'muted' }, 'Loading members…'));
  host.append(box);
  try {
    const members = await listMembers(wsId);
    clear(box);
    for (const m of members) {
      const isSelf = m.uid === user.uid;
      const isOwnerRow = m.role === 'owner';
      let control = el('span', { class: `pill pill--${m.role}` }, roleLabel(m.role));
      if (manager && !isOwnerRow) {
        const select = el('select', { class: 'input input--sm' }, ['editor', 'viewer'].map(
          (r) => el('option', { value: r, ...(r === m.role ? { selected: 'selected' } : {}) }, roleLabel(r)),
        ));
        select.addEventListener('change', async () => {
          try { await changeMemberRole(wsId, m.uid, select.value); toast('Role updated', 'success'); }
          catch (err) { toast(err.message, 'error'); }
        });
        control = select;
      }
      box.append(el('div', { class: 'member-row card' }, [
        el('div', {}, [
          el('div', { class: 'member-row__name' }, m.displayName || m.email),
          el('div', { class: 'muted' }, m.email + (isSelf ? ' (you)' : '')),
        ]),
        el('div', { class: 'member-row__control' }, [
          control,
          (manager && !isOwnerRow) ? el('button', {
            class: 'link-danger', onclick: async () => {
              if (!confirm(`Remove ${m.email}?`)) return;
              try { await removeMember(wsId, m.uid); renderMembers(clear(host), user, wsId, ws, manager); }
              catch (err) { toast(err.message, 'error'); }
            },
          }, 'Remove') : null,
        ]),
      ]));
    }
  } catch (err) {
    clear(box);
    box.append(el('p', { class: 'error-text' }, err.message));
  }
}

/* ------------------------------ Invites ------------------------------ */

async function renderInvites(host, user, wsId, writer) {
  host.append(el('h3', { class: 'wb-section-title' }, 'Invites'));

  if (writer) {
    const emailInput = el('input', { class: 'input', type: 'email', placeholder: 'invitee@email.com' });
    const roleSelect = el('select', { class: 'input' }, INVITABLE_ROLES.map((r) => el('option', { value: r }, roleLabel(r))));
    const sendBtn = el('button', { class: 'btn btn--primary' }, 'Create invite');
    sendBtn.addEventListener('click', async () => {
      const email = emailInput.value.trim().toLowerCase();
      if (!email) return;
      sendBtn.disabled = true;
      try {
        const id = await createInvite(wsId, email, roleSelect.value, user.uid);
        const link = `${location.origin}/?invite=${id}`;
        emailInput.value = '';
        toast('Invite created — link copied', 'success');
        try { await navigator.clipboard.writeText(link); } catch { /* clipboard may be blocked */ }
        load();
      } catch (err) { toast(err.message, 'error'); }
      finally { sendBtn.disabled = false; }
    });
    host.append(el('div', { class: 'invite-create card' }, [
      el('p', { class: 'muted' }, 'Invite by email + role. Share the generated link; when they log in with that email they can accept.'),
      el('div', { class: 'row' }, [emailInput, roleSelect, sendBtn]),
    ]));
  }

  const box = el('div', { class: 'invites' }, el('p', { class: 'muted' }, 'Loading invites…'));
  host.append(box);

  async function load() {
    try {
      const invites = await listInvites(wsId);
      clear(box);
      if (!invites.length) { box.append(el('p', { class: 'muted' }, 'No invites yet.')); return; }
      for (const inv of invites) {
        const link = `${location.origin}/?invite=${inv.id}`;
        box.append(el('div', { class: 'invite-row card' }, [
          el('div', {}, [
            el('div', {}, inv.email),
            el('div', { class: 'muted' }, `${roleLabel(inv.role)} · ${inv.status}`),
          ]),
          el('div', { class: 'invite-row__actions' }, [
            el('button', {
              class: 'btn btn--ghost', onclick: async () => {
                try { await navigator.clipboard.writeText(link); toast('Link copied', 'success'); }
                catch { toast(link, 'info'); }
              },
            }, 'Copy link'),
            writer ? el('button', {
              class: 'link-danger', onclick: async () => {
                try { await revokeInvite(inv.id); load(); } catch (err) { toast(err.message, 'error'); }
              },
            }, 'Revoke') : null,
          ]),
        ]));
      }
    } catch (err) {
      clear(box);
      box.append(el('p', { class: 'error-text' }, err.message));
    }
  }
  load();
}
