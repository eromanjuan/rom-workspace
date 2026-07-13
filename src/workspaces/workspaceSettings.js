// Owner-only Workspace Settings: General (name/desc/icon/color), Members
// (view/invite/remove), and Roles & Permissions (per-member role + custom matrix).
import { el, clear, icon, escapeHtml, toast, openModal, confirmModal } from '../ui/dom.js';
import {
  getWorkspace, updateWorkspace, listMembers, removeMember, setMemberRole,
  createInvite, listInvites, revokeInvite, listAllUsers, addMemberDirect,
  listJoinRequests, approveJoinRequest, declineJoinRequest,
} from './data.js';
import { APP_ICONS, APP_COLORS } from './appBuilder.js';
import { WS_PERMISSIONS, ROLE_PRESETS, ASSIGNABLE_ROLES, resolvePerms, roleLabel, isMaster } from './roles.js';
import { PALETTE_VARS, BG_PATTERNS } from '../ui/theme.js';

const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

export async function openWorkspaceSettings(wsId, user, onChanged = () => {}) {
  let ws;
  try { ws = await getWorkspace(wsId); } catch { ws = null; }
  if (!ws) return toast('Could not load workspace.', 'error');

  const { body, close, iconEl } = openModal({ title: 'Workspace settings', iconName: 'settings', wide: true });
  const tabsBar = el('div', { class: 'tabs modal-tabs' });
  const panel = el('div', { class: 'tab-panel' });
  body.append(tabsBar, panel);

  const tabs = [
    { id: 'general', label: 'General', render: () => renderGeneral(panel, wsId, ws, iconEl, onChanged) },
    { id: 'members', label: 'Members', render: () => renderMembers(panel, wsId, user) },
    { id: 'roles', label: 'Roles & Permissions', render: () => renderRoles(panel, wsId, user) },
    { id: 'theme', label: 'Theme', render: () => renderTheme(panel, wsId, ws, onChanged) },
  ];
  function select(id) {
    clear(tabsBar);
    for (const t of tabs) tabsBar.append(el('button', { class: `tab ${t.id === id ? 'tab--active' : ''}`, onclick: () => select(t.id) }, t.label));
    clear(panel);
    tabs.find((t) => t.id === id).render();
  }
  select('general');
}

/* ---------- General ---------- */

function renderGeneral(panel, wsId, ws, iconEl, onChanged) {
  clear(panel);
  const state = { icon: ws.icon || 'layout-dashboard', color: ws.color || '#5b8cff' };
  // Local preview of the workspace's own icon/color (the modal header stays a themed gear).
  const preview = el('span', { class: 'icon-preview', style: `background:${state.color};color:#fff` }, icon(state.icon));
  function refreshHeader() { preview.style.background = state.color; clear(preview).append(icon(state.icon)); }

  const nameInput = el('input', { class: 'input', value: ws.name || '' });
  const descInput = el('textarea', { class: 'input', rows: '2' }); descInput.value = ws.description || '';

  const search = el('input', { class: 'input', placeholder: 'Search icons…' });
  const grid = el('div', { class: 'icon-grid' });
  function drawGrid() {
    const q = search.value.trim().toLowerCase();
    clear(grid);
    for (const n of APP_ICONS.filter((x) => !q || x.includes(q))) {
      grid.append(el('button', { class: `icon-cell ${n === state.icon ? 'icon-cell--active' : ''}`, type: 'button', onclick: () => { state.icon = n; drawGrid(); refreshHeader(); } }, icon(n)));
    }
  }
  search.addEventListener('input', drawGrid);
  const swatches = el('div', { class: 'color-row' });
  const custom = el('input', { type: 'color', class: 'color-custom', value: state.color });
  function drawSwatches() {
    clear(swatches);
    for (const c of APP_COLORS) swatches.append(el('button', { class: `swatch ${c === state.color ? 'swatch--active' : ''}`, type: 'button', style: `background:${c}`, onclick: () => { state.color = c; custom.value = c; drawSwatches(); refreshHeader(); } }));
    swatches.append(el('label', { class: 'swatch swatch--custom' }, [icon('plus'), custom]));
  }
  custom.addEventListener('input', () => { state.color = custom.value; drawSwatches(); refreshHeader(); });
  drawGrid(); drawSwatches();

  const save = el('button', { class: 'btn btn--primary' }, 'Save changes');
  save.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return toast('Workspace needs a name.', 'error');
    save.disabled = true;
    try {
      await updateWorkspace(wsId, { name, description: descInput.value.trim(), icon: state.icon, color: state.color });
      toast('Saved. Reloading workspace…', 'success');
      onChanged();
    } catch (err) { toast(err.message, 'error'); save.disabled = false; }
  });

  panel.append(el('div', { class: 'field-modal' }, [
    el('label', { class: 'form-label' }, 'Workspace name'), nameInput,
    el('label', { class: 'form-label' }, ['Description ', el('span', { class: 'muted' }, '(optional)')]), descInput,
    el('label', { class: 'form-label' }, ['Icon ', preview]), search, grid,
    el('label', { class: 'form-label' }, 'Color'), swatches,
    el('div', { class: 'app-create-foot' }, [save]),
  ]));
}

/* ---------- Theme (per-workspace look for the dashboard) ---------- */

function renderTheme(panel, wsId, ws, onChanged) {
  clear(panel);
  const existing = ws.theme && typeof ws.theme === 'object' ? ws.theme : null;
  const t = {
    on: !!existing,
    mode: existing?.mode === 'light' ? 'light' : 'dark',
    palette: { ...(existing?.palette || {}) },
    appearance: { cardStyle: 'solid', cardBlur: 10, cardOpacity: 65, bgType: 'none', bgPattern: '', ...(existing?.appearance || {}) },
  };
  const colorFor = (v) => t.palette[v.var] || v.def[t.mode];

  const enable = el('input', { type: 'checkbox', ...(t.on ? { checked: 'checked' } : {}) });
  const controls = el('div', { class: 'ws-theme-controls' });

  function drawControls() {
    controls.style.display = t.on ? '' : 'none';
    clear(controls);
    if (!t.on) return;
    // Mode
    const modeRow = el('div', { class: 'row' }, ['light', 'dark'].map((m) => {
      const b = el('button', { type: 'button', class: `btn btn--sm ${t.mode === m ? 'btn--primary' : 'btn--ghost'}` }, m === 'light' ? 'Light' : 'Dark');
      b.addEventListener('click', () => { t.mode = m; drawControls(); });
      return b;
    }));
    // Colors
    const colorWrap = el('div', { class: 'ws-theme-colors' });
    for (const v of PALETTE_VARS) {
      const inp = el('input', { type: 'color', value: colorFor(v) });
      inp.addEventListener('input', () => { t.palette[v.var] = inp.value; });
      colorWrap.append(el('label', { class: 'ws-theme-color' }, [inp, el('span', {}, v.label)]));
    }
    // Card style
    const glass = t.appearance.cardStyle === 'glass';
    const cardRow = el('div', { class: 'row' }, ['solid', 'glass'].map((s) => {
      const b = el('button', { type: 'button', class: `btn btn--sm ${((s === 'glass') === glass) ? 'btn--primary' : 'btn--ghost'}` }, s === 'glass' ? 'Glass' : 'Solid');
      b.addEventListener('click', () => { t.appearance.cardStyle = s; drawControls(); });
      return b;
    }));
    // Background
    const bgWrap = el('div', { class: 'ws-theme-bg' });
    const noneBtn = el('button', { type: 'button', class: `swatch ${t.appearance.bgType !== 'pattern' ? 'swatch--active' : ''}` }, 'None');
    noneBtn.addEventListener('click', () => { t.appearance.bgType = 'none'; t.appearance.bgPattern = ''; drawControls(); });
    bgWrap.append(noneBtn);
    for (const p of BG_PATTERNS) {
      const active = t.appearance.bgType === 'pattern' && t.appearance.bgPattern === p.id;
      const b = el('button', { type: 'button', class: `swatch ${active ? 'swatch--active' : ''}` }, p.label);
      b.addEventListener('click', () => { t.appearance.bgType = 'pattern'; t.appearance.bgPattern = p.id; drawControls(); });
      bgWrap.append(b);
    }
    controls.append(
      el('label', { class: 'form-label' }, 'Mode'), modeRow,
      el('label', { class: 'form-label' }, 'Colors'), colorWrap,
      el('label', { class: 'form-label' }, 'Cards'), cardRow,
      el('label', { class: 'form-label' }, 'Background'), bgWrap,
    );
  }
  enable.addEventListener('change', () => { t.on = enable.checked; drawControls(); });
  drawControls();

  const save = el('button', { class: 'btn btn--primary' }, 'Save theme');
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      let theme = null;
      if (t.on) {
        // Store a complete palette so the workspace theme fully defines the look.
        const palette = {};
        for (const v of PALETTE_VARS) palette[v.var] = t.palette[v.var] || v.def[t.mode];
        theme = { mode: t.mode, palette, appearance: t.appearance };
      }
      await updateWorkspace(wsId, { theme });
      ws.theme = theme;
      toast('Workspace theme saved. Reopen the workspace to see it.', 'success');
      onChanged();
    } catch (err) { toast(err.message, 'error'); }
    finally { save.disabled = false; }
  });

  panel.append(el('div', { class: 'field-modal' }, [
    el('p', { class: 'muted' }, 'Give this workspace its own look. The theme applies to the workspace dashboard for everyone who opens it. Leave it off to inherit each viewer\'s personal theme.'),
    el('label', { class: 'ws-perm' }, [enable, ' Use a custom theme for this workspace']),
    controls,
    el('div', { class: 'app-create-foot' }, [save]),
  ]));
}

/* ---------- Members (view / invite / remove) ---------- */

function renderMembers(panel, wsId, user) {
  clear(panel);
  const emailInput = el('input', { class: 'input', type: 'email', placeholder: 'invitee@email.com' });
  const roleSelect = el('select', { class: 'input' }, ['editor', 'viewer'].map((r) => el('option', { value: r }, roleLabel(r))));
  const inviteBtn = el('button', { class: 'btn btn--primary' }, [icon('mail'), ' Invite']);
  inviteBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim().toLowerCase();
    if (!email) return;
    inviteBtn.disabled = true;
    try {
      const id = await createInvite(wsId, email, roleSelect.value, user.uid);
      emailInput.value = '';
      try { await navigator.clipboard.writeText(`${location.origin}/?invite=${id}`); } catch { /* ignore */ }
      toast('Invite created — link copied.', 'success');
      loadInvites();
    } catch (err) { toast(err.message, 'error'); }
    finally { inviteBtn.disabled = false; }
  });

  const memberList = el('div', { class: 'ws-member-list' }, el('p', { class: 'muted' }, 'Loading…'));
  const inviteList = el('div', { class: 'ws-invite-list' });
  const requestList = el('div', { class: 'ws-member-list' });

  // Add existing ROM users directly (no invite needed).
  const searchInput = el('input', { class: 'input', placeholder: 'Search users by name or email…' });
  const addRoleSelect = el('select', { class: 'input input--sm' }, ['editor', 'viewer'].map((r) => el('option', { value: r }, roleLabel(r))));
  const searchResults = el('div', { class: 'ws-user-results' });
  let allUsers = [];
  let memberUids = new Set();
  function drawResults() {
    const q = searchInput.value.trim().toLowerCase();
    clear(searchResults);
    const candidates = allUsers.filter((u) => !memberUids.has(u.uid) && (!q
      || (u.displayName || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)));
    if (!q) { return; } // only show results while searching
    if (!candidates.length) { searchResults.append(el('p', { class: 'muted' }, 'No matching users.')); return; }
    for (const u of candidates.slice(0, 8)) {
      const addBtn = el('button', { class: 'btn btn--primary btn--sm' }, [icon('plus'), ' Add']);
      addBtn.addEventListener('click', async () => {
        addBtn.disabled = true;
        try { await addMemberDirect(wsId, u, addRoleSelect.value, { notify: true }); toast(`Added ${u.displayName || u.email}`, 'success'); searchInput.value = ''; await loadMembers(); }
        catch (err) { toast(err.message, 'error'); addBtn.disabled = false; }
      });
      searchResults.append(el('div', { class: 'ws-member-row' }, [
        el('div', { class: 'ws-avatar ws-avatar--sm' }, initials(u.displayName || u.email)),
        el('div', { class: 'ws-member-meta' }, [el('div', { class: 'ws-member-name' }, u.displayName || u.email), el('div', { class: 'muted' }, u.email || '')]),
        addBtn,
      ]));
    }
  }
  searchInput.addEventListener('input', drawResults);
  listAllUsers().then((u) => { allUsers = u; drawResults(); }).catch(() => {});

  panel.append(el('div', { class: 'field-modal' }, [
    el('label', { class: 'form-label' }, 'Add existing users'),
    el('div', { class: 'row' }, [searchInput, addRoleSelect]),
    searchResults,
    el('label', { class: 'form-label' }, 'Or invite by email'),
    el('div', { class: 'row' }, [emailInput, roleSelect, inviteBtn]),
    el('label', { class: 'form-label' }, 'Join requests'), requestList,
    el('label', { class: 'form-label' }, 'Members'), memberList,
    el('label', { class: 'form-label' }, 'Pending invites'), inviteList,
  ]));

  async function loadRequests() {
    try {
      const reqs = await listJoinRequests(wsId);
      clear(requestList);
      if (!reqs.length) { requestList.append(el('p', { class: 'muted' }, 'No join requests.')); return; }
      for (const r of reqs) {
        const roleSel = el('select', { class: 'input input--sm' }, ['viewer', 'editor'].map((x) => el('option', { value: x }, roleLabel(x))));
        requestList.append(el('div', { class: 'ws-member-row' }, [
          el('div', { class: 'ws-avatar ws-avatar--sm' }, initials(r.displayName || r.email)),
          el('div', { class: 'ws-member-meta' }, [el('div', { class: 'ws-member-name' }, r.displayName || r.email), el('div', { class: 'muted' }, r.email)]),
          roleSel,
          el('button', { class: 'btn btn--primary btn--sm', onclick: async () => { try { await approveJoinRequest(wsId, r, roleSel.value); toast(`Added ${r.displayName || r.email}`, 'success'); loadRequests(); loadMembers(); } catch (err) { toast(err.message, 'error'); } } }, 'Approve'),
          el('button', { class: 'link-danger', onclick: async () => { try { await declineJoinRequest(wsId, r.uid); loadRequests(); } catch (err) { toast(err.message, 'error'); } } }, 'Decline'),
        ]));
      }
    } catch (err) { clear(requestList); requestList.append(el('p', { class: 'error-text' }, err.message)); }
  }

  async function loadMembers() {
    try {
      const members = await listMembers(wsId);
      memberUids = new Set(members.map((m) => m.uid));
      drawResults();
      clear(memberList);
      for (const m of members) {
        const isOwnerRow = m.role === 'owner';
        memberList.append(el('div', { class: 'ws-member-row' }, [
          el('div', { class: 'ws-avatar ws-avatar--sm' }, initials(m.displayName || m.email)),
          el('div', { class: 'ws-member-meta' }, [el('div', { class: 'ws-member-name' }, m.displayName || m.email), el('div', { class: 'muted' }, `${m.email} · ${roleLabel(m.role)}`)]),
          isOwnerRow ? null : el('button', {
            class: 'link-danger', onclick: async () => {
              if (!(await confirmModal({ title: 'Remove member?', message: `${m.email} will lose access to this workspace.`, confirmLabel: 'Remove', danger: true }))) return;
              try { await removeMember(wsId, m.uid); loadMembers(); } catch (err) { toast(err.message, 'error'); }
            },
          }, 'Remove'),
        ]));
      }
    } catch (err) { clear(memberList); memberList.append(el('p', { class: 'error-text' }, err.message)); }
  }
  async function loadInvites() {
    try {
      const invites = await listInvites(wsId);
      clear(inviteList);
      if (!invites.length) { inviteList.append(el('p', { class: 'muted' }, 'No pending invites.')); return; }
      for (const inv of invites) {
        inviteList.append(el('div', { class: 'ws-member-row' }, [
          el('div', { class: 'ws-member-meta' }, [el('div', {}, inv.email), el('div', { class: 'muted' }, `${roleLabel(inv.role)} · ${inv.status}`)]),
          el('button', { class: 'btn btn--ghost btn--sm', onclick: async () => { try { await navigator.clipboard.writeText(`${location.origin}/?invite=${inv.id}`); toast('Link copied', 'success'); } catch { /* ignore */ } } }, 'Copy link'),
          el('button', { class: 'link-danger', onclick: async () => { try { await revokeInvite(inv.id); loadInvites(); } catch (err) { toast(err.message, 'error'); } } }, 'Revoke'),
        ]));
      }
    } catch (err) { clear(inviteList); inviteList.append(el('p', { class: 'error-text' }, err.message)); }
  }
  loadMembers(); loadInvites(); loadRequests();
}

/* ---------- Roles & Permissions ---------- */

function renderRoles(panel, wsId, user) {
  clear(panel);
  const list = el('div', { class: 'ws-role-list' }, el('p', { class: 'muted' }, 'Loading…'));

  // Apply-a-role-to-all control.
  const bulkRole = el('select', { class: 'input' }, ['editor', 'viewer'].map((r) => el('option', { value: r }, roleLabel(r))));
  const bulkBtn = el('button', { class: 'btn btn--ghost' }, 'Apply to all non-owners');

  panel.append(el('div', { class: 'field-modal' }, [
    el('p', { class: 'muted' }, 'Owner has full access. Set each member\'s role, or choose Custom to pick exact permissions.' ),
    el('div', { class: 'row' }, [bulkRole, bulkBtn]),
    list,
  ]));

  let members = [];
  async function load() {
    try { members = await listMembers(wsId); } catch (err) { clear(list); list.append(el('p', { class: 'error-text' }, err.message)); return; }
    clear(list);
    for (const m of members) list.append(roleRow(m));
  }

  function roleRow(m) {
    const isOwnerRow = m.role === 'owner';
    const roleSel = el('select', { class: 'input input--sm' }, ASSIGNABLE_ROLES.map((r) => el('option', { value: r, ...(r === m.role ? { selected: 'selected' } : {}) }, roleLabel(r) === r ? (r === 'custom' ? 'Custom' : r) : roleLabel(r))));
    const permsWrap = el('div', { class: 'ws-perms' });
    function drawPerms() {
      clear(permsWrap);
      if (roleSel.value !== 'custom') { permsWrap.style.display = 'none'; return; }
      permsWrap.style.display = '';
      const cur = resolvePerms({ role: 'custom', perms: m.perms }, null);
      for (const p of WS_PERMISSIONS) {
        const cb = el('input', { type: 'checkbox', ...(cur[p.key] ? { checked: 'checked' } : {}) });
        cb.dataset.k = p.key;
        permsWrap.append(el('label', { class: 'ws-perm' }, [cb, ' ' + p.label]));
      }
    }
    async function save() {
      const role = roleSel.value;
      let perms;
      if (role === 'custom') {
        perms = {};
        for (const cb of permsWrap.querySelectorAll('input[type=checkbox]')) perms[cb.dataset.k] = cb.checked;
      }
      try { await setMemberRole(wsId, m.uid, role, perms); m.role = role; m.perms = perms; toast(`Updated ${m.displayName || m.email}`, 'success'); }
      catch (err) { toast(err.message, 'error'); }
    }
    roleSel.addEventListener('change', () => { drawPerms(); if (roleSel.value !== 'custom') save(); });
    permsWrap.addEventListener('change', () => save());
    drawPerms();

    return el('div', { class: 'ws-role-row' }, [
      el('div', { class: 'ws-role-head' }, [
        el('div', { class: 'ws-avatar ws-avatar--sm' }, initials(m.displayName || m.email)),
        el('div', { class: 'ws-member-meta' }, [el('div', { class: 'ws-member-name' }, m.displayName || m.email), el('div', { class: 'muted' }, m.email)]),
        isOwnerRow ? el('span', { class: 'pill pill--owner' }, 'Owner') : roleSel,
      ]),
      isOwnerRow ? null : permsWrap,
    ]);
  }

  bulkBtn.addEventListener('click', async () => {
    if (!(await confirmModal({ title: 'Bulk change roles?', message: `Set all non-owner members to ${roleLabel(bulkRole.value)}?`, confirmLabel: 'Apply' }))) return;
    bulkBtn.disabled = true;
    try {
      for (const m of members) { if (m.role !== 'owner') await setMemberRole(wsId, m.uid, bulkRole.value); }
      toast('Applied to all members.', 'success'); load();
    } catch (err) { toast(err.message, 'error'); }
    finally { bulkBtn.disabled = false; }
  });

  load();
}
