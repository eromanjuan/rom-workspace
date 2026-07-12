// The "Create your own app" builder — modelled on quest-hq:
//   Add-app modal -> create form (name, description, type, icon, color)
//   -> app view (colored header + Items / Fields / Reports / Automations / Settings)
//   -> Fields palette to design what data the app stores.
import { el, clear, icon, escapeHtml, toast, openModal, downloadFile } from '../ui/dom.js';
import {
  createApp, getApp, updateApp, deleteApp,
  addRecord, listRecords, deleteRecord, addFeedPost,
  publishToMarket, listMarketApps, unpublishMarketApp,
} from './data.js';
import { isMaster } from './roles.js';

// A portable app definition (no items/data) for export, file install, and the market.
function appToDefinition(app) {
  return {
    rom_app: true, version: 1,
    name: app.name, description: app.description || '', type: app.type || '',
    icon: app.icon || 'apps', color: app.color || '#e0552d',
    fields: app.fields || [], reports: app.reports || [], automations: app.automations || [],
  };
}
function definitionToCreate(def) {
  return {
    name: def.name || 'Imported app', description: def.description || '', type: def.type || '',
    icon: def.icon || 'apps', color: def.color || '#e0552d',
    fields: Array.isArray(def.fields) ? def.fields : [],
    reports: Array.isArray(def.reports) ? def.reports : [],
    automations: Array.isArray(def.automations) ? def.automations : [],
  };
}

// ---- option sets (match the screenshots) ----
export const APP_TYPES = ['Contacts', 'Tasks', 'Projects', 'Records', 'Inventory', 'Documents', 'Calendar', 'Tickets', 'Invoices', 'Custom'];

export const APP_COLORS = ['#e0552d', '#2563eb', '#7c3aed', '#0d9488', '#16a34a', '#d97706', '#db2777', '#0891b2', '#dc2626', '#4f46e5'];

// A generous set of Tabler icons for the searchable picker.
export const APP_ICONS = [
  'address-book', 'checklist', 'folder', 'calendar', 'clipboard-text', 'bug', 'shopping-cart', 'id', 'truck-delivery', 'file',
  'phone', 'flask', 'briefcase', 'building', 'building-bank', 'chart-line', 'home', 'users', 'user', 'users-group',
  'mail', 'message', 'message-circle', 'clipboard-list', 'clipboard-check', 'file-text', 'note', 'book', 'bookmark', 'tag',
  'tags', 'star', 'heart', 'flag', 'target', 'map', 'world', 'package', 'box', 'affiliate',
  'shield', 'lock', 'key', 'cloud', 'database', 'server', 'device-desktop', 'device-mobile', 'printer', 'cpu',
  'code', 'terminal', 'bulb', 'atom', 'microscope', 'school', 'trophy', 'compass', 'anchor', 'brush',
  'palette', 'pencil', 'scissors', 'calculator', 'coffee', 'cup', 'ticket', 'basket', 'apps',
];

// Field-type registry — mirrors quest-hq's WB_FIELD_TYPES (label, icon, color, desc).
// `soon` types are shown in the palette but depend on infrastructure not built yet.
export const FIELD_TYPES = {
  text: { label: 'Text', icon: 'letter-case', color: '#2563eb', desc: 'Single line of text' },
  textarea: { label: 'Text Area', icon: 'align-left', color: '#2563eb', desc: 'Long multi-line text' },
  number: { label: 'Number', icon: 'number-9', color: '#0d9488', desc: 'Numeric value' },
  money: { label: 'Money', icon: 'currency-dollar', color: '#16a34a', desc: 'Currency amount' },
  duration: { label: 'Duration', icon: 'clock-hour-4', color: '#0d9488', desc: 'Length of time (hrs / mins)' },
  progress: { label: 'Progress', icon: 'progress', color: '#7c3aed', desc: 'Percent complete (0–100%)' },
  checklist: { label: 'Checklist', icon: 'list-check', color: '#16a34a', desc: 'Checkable steps with live progress' },
  date: { label: 'Date', icon: 'calendar', color: '#7c3aed', desc: 'Date picker' },
  category: { label: 'Category / Dropdown', icon: 'list', color: '#d97706', desc: 'Choose from options' },
  status: { label: 'Status', icon: 'flag', color: '#16a34a', desc: 'Colored workflow state' },
  user: { label: 'User Assignment', icon: 'user', color: '#e0552d', desc: 'Assign a person' },
  url: { label: 'Link / URL', icon: 'world-www', color: '#2563eb', desc: 'A web link — open, copy, or QR it' },
  email: { label: 'Email', icon: 'mail', color: '#2563eb', desc: 'Email address' },
  phone: { label: 'Phone Number', icon: 'phone', color: '#16a34a', desc: 'Phone number' },
  location: { label: 'Location', icon: 'map-pin', color: '#dc2626', desc: 'Address or place' },
  yesno: { label: 'Yes / No', icon: 'checkbox', color: '#0d9488', desc: 'True or false toggle' },
  relationship: { label: 'Relationship', icon: 'link', color: '#0891b2', desc: 'Link to items in another app', soon: true },
  file: { label: 'File Attachment', icon: 'paperclip', color: '#6b7280', desc: 'Attach documents', soon: true },
  image: { label: 'Image', icon: 'photo', color: '#0891b2', desc: 'Circular picture, like an avatar', soon: true },
  calculation: { label: 'Calculation', icon: 'math-function', color: '#7c3aed', desc: 'Formula over number fields', soon: true },
};
export const FIELD_ORDER = ['text', 'textarea', 'number', 'money', 'duration', 'progress', 'checklist', 'date', 'category', 'status', 'user', 'url', 'email', 'phone', 'location', 'yesno', 'relationship', 'file', 'image', 'calculation'];

const fieldMeta = (id) => FIELD_TYPES[id] ? { id, ...FIELD_TYPES[id] } : { id: 'text', ...FIELD_TYPES.text };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'field';

/* ============================ Add-app modal ============================ */

export function openAddAppModal(wsId, user, onCreated) {
  const { body, close, iconEl } = openModal({ title: 'Add an app', iconName: 'apps', iconColor: '#e0552d', wide: true });

  const optionCard = (ic, color, title, desc, onclick, soon) => el('button', {
    class: `addapp-option${soon ? ' addapp-option--soon' : ''}`, onclick,
  }, [
    el('div', { class: 'addapp-option-ic', style: `background:${color}` }, icon(ic)),
    el('div', { class: 'addapp-option-txt' }, [
      el('div', { class: 'addapp-option-title' }, [title, soon ? el('span', { class: 'sb-soon' }, 'soon') : null]),
      el('div', { class: 'muted' }, desc),
    ]),
    icon('chevron-right'),
  ]);

  body.append(el('div', { class: 'addapp-options' }, [
    optionCard('pencil', '#e0552d', 'Create your own app', 'Start from a blank canvas and design fields, reports and automations.',
      () => renderCreateForm(body, wsId, user, onCreated, close, iconEl)),
    optionCard('file-import', '#16a34a', 'Install from a file', 'Upload a .rom.json you downloaded to recreate that app here.',
      () => renderInstallFromFile(body, wsId, user, onCreated, close)),
    optionCard('building-store', '#0891b2', 'ROM App Market', 'Browse apps shared by anyone and copy one into this workspace.',
      () => renderAppMarket(body, wsId, user, onCreated, close)),
  ]));
}

/* ---- Install from a file (.rom.json) ---- */

function renderInstallFromFile(body, wsId, user, onCreated, close) {
  clear(body);
  let def = null;
  const fileInput = el('input', { type: 'file', accept: '.json,.rom.json,application/json', style: 'display:none' });
  const pickBtn = el('button', { class: 'btn btn--ghost' }, [icon('file-upload'), ' Choose a .rom.json file']);
  pickBtn.addEventListener('click', () => fileInput.click());
  const preview = el('div', { class: 'install-preview' });
  const installBtn = el('button', { class: 'btn btn--primary', disabled: 'disabled' }, [icon('plus'), ' Install app']);

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0]; if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      if (!parsed || !parsed.rom_app || !Array.isArray(parsed.fields)) throw new Error('Not a valid ROM app file.');
      def = parsed;
      clear(preview).append(
        el('div', { class: 'install-card' }, [
          el('div', { class: 'app-ic', style: `background:${def.color || '#e0552d'}` }, icon(def.icon || 'apps')),
          el('div', {}, [
            el('div', { class: 'install-name' }, def.name || 'Imported app'),
            el('div', { class: 'muted' }, `${def.fields.length} fields · ${(def.reports || []).length} reports · ${(def.automations || []).length} automations`),
          ]),
        ]),
      );
      installBtn.disabled = false;
    } catch (err) {
      def = null; installBtn.disabled = true;
      clear(preview).append(el('p', { class: 'error-text' }, err.message || 'Could not read that file.'));
    }
  });

  installBtn.addEventListener('click', async () => {
    if (!def) return;
    installBtn.disabled = true;
    try { const id = await createApp(wsId, definitionToCreate(def), user.uid); close(); onCreated(id); }
    catch (err) { toast(err.message, 'error'); installBtn.disabled = false; }
  });

  body.append(el('div', { class: 'field-modal' }, [
    el('p', { class: 'muted' }, 'Upload a .rom.json file exported from any ROM app to recreate its structure (fields, reports, automations) here. Items are not included.'),
    pickBtn, fileInput, preview,
    el('div', { class: 'app-create-foot' }, [installBtn]),
  ]));
}

/* ---- ROM App Market ---- */

async function renderAppMarket(body, wsId, user, onCreated, close) {
  clear(body);
  const search = el('input', { class: 'input', placeholder: 'Search the app market…' });
  const list = el('div', { class: 'market-list' }, el('p', { class: 'muted' }, 'Loading…'));
  body.append(el('div', { class: 'field-modal' }, [search, list]));

  let apps = [];
  try { apps = await listMarketApps(); } catch (err) { clear(list).append(el('p', { class: 'error-text' }, err.message)); return; }

  function draw() {
    const q = search.value.trim().toLowerCase();
    const shown = apps.filter((a) => !q || (a.name || '').toLowerCase().includes(q) || (a.type || '').toLowerCase().includes(q));
    clear(list);
    if (!shown.length) { list.append(el('div', { class: 'market-empty' }, [el('div', { class: 'placeholder-icon' }, icon('building-store')), el('p', { class: 'muted' }, q ? 'No apps match your search.' : 'No apps have been shared yet. Share one from an app’s Settings.')])); return; }
    for (const a of shown) {
      const canRemove = a.publishedBy === user.uid || isMaster(user);
      list.append(el('div', { class: 'market-card card' }, [
        el('div', { class: 'app-ic', style: `background:${a.color || '#e0552d'}` }, icon(a.icon || 'apps')),
        el('div', { class: 'market-meta' }, [
          el('div', { class: 'market-name' }, a.name),
          el('div', { class: 'muted' }, `${(a.fields || []).length} fields · by ${a.publisherName || 'someone'}`),
        ]),
        el('div', { class: 'market-actions' }, [
          el('button', { class: 'btn btn--primary btn--sm', onclick: async (e) => {
            e.currentTarget.disabled = true;
            try { const id = await createApp(wsId, definitionToCreate(a), user.uid); close(); onCreated(id); }
            catch (err) { toast(err.message, 'error'); e.currentTarget.disabled = false; }
          } }, [icon('download'), ' Install']),
          canRemove ? el('button', { class: 'link-danger', title: 'Unpublish', onclick: async (ev) => {
            if (!confirm(`Remove "${a.name}" from the market?`)) return;
            try { await unpublishMarketApp(a.id); apps = apps.filter((x) => x.id !== a.id); draw(); }
            catch (err) { toast(err.message, 'error'); }
          } }, icon('x')) : null,
        ]),
      ]));
    }
  }
  search.addEventListener('input', draw);
  draw();
}

/* ============================ Create form ============================ */

function renderCreateForm(body, wsId, user, onCreated, close, iconEl) {
  clear(body);
  const state = { icon: APP_ICONS[0], color: APP_COLORS[0] };
  // The modal's header icon is the live preview (recolors as you pick), like quest-hq.
  function refreshPreview() { if (iconEl) { iconEl.style.background = state.color; clear(iconEl).append(icon(state.icon)); } }
  refreshPreview();

  const nameInput = el('input', { class: 'input', placeholder: 'e.g. Leads, Projects, Inspections' });
  const descInput = el('textarea', { class: 'input', rows: '3', placeholder: 'What does this app track?' });
  const typeSelect = el('select', { class: 'input' }, [
    el('option', { value: '' }, '— Select a type —'),
    ...APP_TYPES.map((t) => el('option', { value: t }, t)),
  ]);

  // icon search + grid
  const search = el('input', { class: 'input', placeholder: 'Search icons…' });
  const grid = el('div', { class: 'icon-grid' });
  function drawGrid() {
    const q = search.value.trim().toLowerCase();
    clear(grid);
    for (const name of APP_ICONS.filter((n) => !q || n.includes(q))) {
      grid.append(el('button', {
        class: `icon-cell ${name === state.icon ? 'icon-cell--active' : ''}`, type: 'button',
        onclick: () => { state.icon = name; drawGrid(); refreshPreview(); },
      }, icon(name)));
    }
  }
  search.addEventListener('input', drawGrid);

  // color swatches + custom
  const swatches = el('div', { class: 'color-row' });
  const custom = el('input', { type: 'color', class: 'color-custom', value: state.color });
  function drawSwatches() {
    clear(swatches);
    for (const c of APP_COLORS) {
      swatches.append(el('button', {
        class: `swatch ${c === state.color ? 'swatch--active' : ''}`, type: 'button',
        style: `background:${c}`, onclick: () => { state.color = c; custom.value = c; drawSwatches(); refreshPreview(); },
      }));
    }
    swatches.append(el('label', { class: 'swatch swatch--custom', title: 'Custom color' }, [icon('plus'), custom]));
  }
  custom.addEventListener('input', () => { state.color = custom.value; drawSwatches(); refreshPreview(); });

  drawGrid(); drawSwatches();

  const createBtn = el('button', { class: 'btn btn--primary' }, [icon('plus'), ' Create app']);
  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return toast('Give the app a name.', 'error');
    createBtn.disabled = true;
    try {
      const id = await createApp(wsId, {
        name, description: descInput.value.trim(), type: typeSelect.value,
        icon: state.icon, color: state.color, fields: [],
      }, user.uid);
      close();
      onCreated(id);
    } catch (err) { toast(err.message, 'error'); createBtn.disabled = false; }
  });

  body.append(el('div', { class: 'app-create' }, [
    el('label', { class: 'form-label' }, 'App name'),
    nameInput,
    el('label', { class: 'form-label' }, ['Description ', el('span', { class: 'muted' }, '(optional)')]),
    descInput,
    el('label', { class: 'form-label' }, ['App type ', el('span', { class: 'muted' }, '(optional)')]),
    typeSelect,
    el('label', { class: 'form-label' }, 'Icon'),
    search, grid,
    el('label', { class: 'form-label' }, 'Color'),
    swatches,
    el('div', { class: 'app-create-foot' }, [createBtn]),
  ]));
}

/* ============================ App view (TEST QR look) ============================ */

export async function renderApp(host, wsId, user, appId, writer, onBack) {
  clear(host);
  let app = await getApp(wsId, appId);
  if (!app) { host.append(el('p', { class: 'error-text' }, 'App not found.')); return; }

  const header = el('div', { class: 'app-view-head' });
  const tabsBar = el('div', { class: 'tabs' });
  const panel = el('div', { class: 'tab-panel' });
  host.append(el('div', { class: 'app-view' }, [header, tabsBar, panel]));

  function drawHeader() {
    clear(header).append(
      el('div', { class: 'app-ic', style: `background:${app.color || '#e0552d'}` }, icon(app.icon || 'apps')),
      el('div', { class: 'app-view-meta' }, [
        el('div', { class: 'app-view-title' }, app.name),
        app.description ? el('div', { class: 'muted' }, app.description) : null,
      ]),
      writer ? el('button', { class: 'btn btn--primary', onclick: () => select('fields') }, [icon('plus'), ' Add field']) : null,
    );
  }

  const tabs = [
    { id: 'items', label: () => `Items ${recordCount}` , render: () => renderItems(panel, wsId, user, app, writer) },
    { id: 'fields', label: () => `Fields ${(app.fields || []).length}`, render: () => renderFields(panel, wsId, app, writer, refreshApp) },
    { id: 'reports', label: () => `Reports ${(app.reports || []).length || ''}`.trim(), render: () => renderReports(panel, wsId, app, writer, refreshApp) },
    { id: 'automations', label: () => `Automations ${(app.automations || []).length}`, render: () => renderAutomations(panel, wsId, app, writer, refreshApp) },
    { id: 'settings', label: () => 'Settings', render: () => renderSettings(panel, wsId, app, writer, user, refreshApp, onBack) },
  ];
  let recordCount = 0;
  let active = 'items';

  function select(id) {
    active = id;
    clear(tabsBar);
    for (const t of tabs) {
      tabsBar.append(el('button', { class: `tab ${t.id === active ? 'tab--active' : ''}`, onclick: () => select(t.id) }, t.label()));
    }
    clear(panel);
    tabs.find((t) => t.id === active).render();
  }
  async function refreshApp() { app = await getApp(wsId, appId) || app; drawHeader(); select(active); }

  drawHeader();
  // Back link above the tabs.
  header.prepend(el('button', { class: 'btn btn--ghost app-back', onclick: onBack }, [icon('arrow-left'), ' Apps']));
  // prime record count then render
  listRecords(wsId, appId).then((r) => { recordCount = r.length; select('items'); }).catch(() => select('items'));
}

function comingSoon(panel, title, desc) {
  clear(panel);
  panel.append(el('div', { class: 'placeholder' }, [
    el('div', { class: 'placeholder-icon' }, icon('tools')),
    el('h3', {}, title), el('p', { class: 'muted' }, desc),
  ]));
}

/* ---- Fields tab (palette) ---- */

function renderFields(panel, wsId, app, writer, refreshApp) {
  clear(panel);
  const fields = [...(app.fields || [])];

  const listWrap = el('div', { class: 'fields-canvas' });
  function drawList() {
    clear(listWrap);
    if (!fields.length) {
      listWrap.append(el('div', { class: 'fields-empty' }, [
        el('div', { class: 'placeholder-icon' }, icon('layout-grid')),
        el('h3', {}, 'Design your app'),
        el('p', { class: 'muted' }, 'Add fields from the palette to shape what data this app stores.'),
      ]));
      return;
    }
    for (const [i, f] of fields.entries()) {
      const meta = fieldMeta(f.type);
      listWrap.append(el('div', {
        class: 'field-item card', ...(writer ? { role: 'button' } : {}),
        onclick: writer ? () => openFieldModal({ type: f.type, field: f, appFields: fields, onSave: (nf) => { fields[i] = nf; persist(); } }) : null,
      }, [
        el('div', { class: 'field-item-ic', style: `background:${meta.color}22;color:${meta.color}` }, icon(meta.icon)),
        el('div', { class: 'field-item-meta' }, [
          el('div', { class: 'field-item-label' }, f.label),
          el('div', { class: 'muted' }, fieldSummary(f, meta)),
        ]),
        writer ? el('button', {
          class: 'link-danger', title: 'Remove field',
          onclick: (e) => { e.stopPropagation(); fields.splice(i, 1); persist(); },
        }, icon('x')) : null,
      ]));
    }
  }

  async function persist() { try { await updateApp(wsId, app.id, { fields }); app.fields = fields; drawList(); refreshApp(); } catch (e) { toast(e.message, 'error'); } }

  function addField(type) {
    const meta = fieldMeta(type);
    if (meta.soon) { toast(`${meta.label} fields are coming soon.`, 'info'); return; }
    openFieldModal({
      type, field: null, appFields: fields,
      onSave: (nf) => { nf.key = uniqueKey(slug(nf.label), fields); fields.push(nf); persist(); },
    });
  }

  const palette = el('div', { class: 'field-palette card' }, [
    el('div', { class: 'field-palette-head' }, [el('h4', {}, 'Add a field'), el('p', { class: 'muted' }, 'Click to configure and add.')]),
    ...FIELD_ORDER.map((id) => {
      const ft = fieldMeta(id);
      return el('button', {
        class: `palette-item${ft.soon ? ' palette-item--soon' : ''}`, disabled: !writer ? 'disabled' : null,
        onclick: () => writer && addField(id),
      }, [
        el('div', { class: 'palette-ic', style: `background:${ft.color}22;color:${ft.color}` }, icon(ft.icon)),
        el('div', {}, [
          el('div', { class: 'palette-label' }, [ft.label, ft.soon ? el('span', { class: 'sb-soon' }, 'soon') : null]),
          el('div', { class: 'muted' }, ft.desc),
        ]),
      ]);
    }),
  ]);

  drawList();
  panel.append(el('div', { class: 'fields-layout' }, [listWrap, palette]));
}

// One-line summary of a field's config for the field list.
function fieldSummary(f, meta) {
  const c = f.config || {};
  if ((f.type === 'category' || f.type === 'status') && c.options?.length) return `${meta.label} · ${c.options.map((o) => o.label).join(', ')}`;
  if (f.type === 'money' && c.currency) return `${meta.label} · ${c.currency}`;
  if (f.type === 'number' && c.unit) return `${meta.label} · ${c.unit}`;
  if (f.type === 'checklist' && c.steps?.length) return `${meta.label} · ${c.steps.length} steps`;
  return meta.label;
}

function uniqueKey(base, fields) {
  let key = base, n = 1;
  const has = (k) => fields.some((f) => f.key === k);
  while (has(key)) key = `${base}_${++n}`;
  return key;
}

/* ---- Items tab (records) ---- */

async function renderItems(panel, wsId, user, app, writer) {
  clear(panel);
  const fields = app.fields || [];
  if (!fields.length) {
    panel.append(el('div', { class: 'placeholder' }, [
      el('div', { class: 'placeholder-icon' }, icon('database')),
      el('h3', {}, 'No fields yet'),
      el('p', { class: 'muted' }, writer ? 'Add fields in the Fields tab, then add items here.' : 'This app has no fields yet.'),
    ]));
    return;
  }
  const recordsBox = el('div', { class: 'records' }, el('p', { class: 'muted' }, 'Loading…'));

  if (writer) {
    const inputs = {};
    const form = el('form', { class: 'record-form card' });
    for (const f of fields) { const inp = fieldInput(f); inputs[f.key] = inp; form.append(labeledField(f, inp)); }
    const addBtn = el('button', { class: 'btn btn--primary', type: 'submit' }, [icon('plus'), ' Add item']);
    form.append(addBtn);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = {};
      for (const f of fields) values[f.key] = readField(f, inputs[f.key]);
      // Run automations: set-field actions mutate values; notify actions post to the feed.
      const notes = runAutomations(app, values);
      addBtn.disabled = true;
      try {
        await addRecord(wsId, app.id, values, user.uid);
        for (const msg of notes) { try { await addFeedPost(wsId, { mode: 'post', text: msg }, user); } catch { /* ignore */ } }
        form.reset(); load();
      } catch (err) { toast(err.message, 'error'); }
      finally { addBtn.disabled = false; }
    });
    panel.append(form);
  }
  panel.append(recordsBox);

  async function load() {
    try {
      const records = await listRecords(wsId, app.id);
      clear(recordsBox);
      if (!records.length) { recordsBox.append(el('p', { class: 'muted' }, 'No items yet.')); return; }
      const table = el('table', { class: 'table' });
      table.append(el('tr', {}, [...fields.map((f) => el('th', {}, f.label)), writer ? el('th', {}, '') : null]));
      for (const r of records) {
        table.append(el('tr', {}, [
          ...fields.map((f) => el('td', {}, fieldDisplay(f, r.values?.[f.key]))),
          writer ? el('td', {}, el('button', { class: 'link-danger', onclick: async () => {
            try { await deleteRecord(wsId, app.id, r.id); load(); } catch (err) { toast(err.message, 'error'); }
          } }, icon('x'))) : null,
        ]));
      }
      recordsBox.append(table);
    } catch (err) { clear(recordsBox); recordsBox.append(el('p', { class: 'error-text' }, err.message)); }
  }
  load();
}

function labeledField(f, inp) {
  return el('label', { class: 'record-field' }, [el('span', { class: 'muted' }, f.label), inp]);
}

// Build an input element appropriate to the field type + its config.
function fieldInput(f) {
  const c = f.config || {};
  switch (f.type) {
    case 'textarea': return el('textarea', { class: 'input', rows: '2', placeholder: c.placeholder || f.label });
    case 'number': return el('input', { class: 'input', type: 'number', placeholder: c.unit || f.label });
    case 'money': return el('input', { class: 'input', type: 'number', step: '0.01', placeholder: '0.00' });
    case 'progress': return el('input', { class: 'input', type: 'number', min: '0', max: '100', placeholder: '0–100' });
    case 'duration': return el('input', { class: 'input', type: 'text', placeholder: 'e.g. 2h 30m' });
    case 'date': return el('input', { class: 'input', type: 'date' });
    case 'url': return el('input', { class: 'input', type: 'url', placeholder: c.placeholder || 'https://' });
    case 'email': return el('input', { class: 'input', type: 'email', placeholder: 'name@email.com' });
    case 'phone': return el('input', { class: 'input', type: 'tel', placeholder: 'Phone' });
    case 'yesno': return el('input', { type: 'checkbox' });
    case 'category':
    case 'status':
      return el('select', { class: 'input' }, [el('option', { value: '' }, '—'), ...(c.options || []).map((o) => el('option', { value: o.label }, o.label))]);
    case 'checklist': {
      const box = el('div', { class: 'checklist-input' });
      for (const step of (c.steps || [])) {
        box.append(el('label', { class: 'checklist-step' }, [el('input', { type: 'checkbox' }), ' ' + step]));
      }
      if (!(c.steps || []).length) box.append(el('span', { class: 'muted' }, 'No steps configured.'));
      return box;
    }
    default: return el('input', { class: 'input', type: 'text', placeholder: c.placeholder || f.label });
  }
}

function readField(f, inp) {
  if (f.type === 'yesno') return inp.checked ? 'Yes' : 'No';
  if (f.type === 'checklist') {
    const steps = (f.config?.steps || []);
    const checks = [...inp.querySelectorAll('input[type=checkbox]')];
    return steps.map((s, i) => ({ step: s, done: !!checks[i]?.checked }));
  }
  return inp.value;
}

function fieldDisplay(f, value) {
  const c = f.config || {};
  if (f.type === 'checklist') {
    const arr = Array.isArray(value) ? value : [];
    if (!arr.length) return el('span', { class: 'muted' }, '—');
    const done = arr.filter((s) => s.done).length;
    return el('span', {}, `${done}/${arr.length} · ${Math.round((done / arr.length) * 100)}%`);
  }
  if (value == null || value === '') return el('span', { class: 'muted' }, '—');
  if (f.type === 'url') return el('a', { href: value, target: '_blank', rel: 'noopener' }, value);
  if (f.type === 'email') return el('a', { href: `mailto:${value}` }, value);
  if (f.type === 'money') return el('span', {}, `${c.currency || '$'}${value}`);
  if (f.type === 'number') return el('span', {}, c.unit ? `${value} ${c.unit}` : String(value));
  if (f.type === 'progress') return el('span', {}, `${value}%`);
  if (f.type === 'status') {
    const opt = (c.options || []).find((o) => o.label === value);
    return el('span', { class: 'status-pill', style: opt ? `background:${opt.color}22;color:${opt.color}` : '' }, value);
  }
  return el('span', { html: escapeHtml(String(value)) });
}

/* ============================ Reports ============================ */

const NUMERIC_TYPES = ['number', 'money', 'progress'];
const fieldByKey = (app, key) => (app.fields || []).find((f) => f.key === key);
const uid12 = () => 'r' + Math.abs(Date.now() % 1e9).toString(36) + Math.round(performance.now()).toString(36);

async function renderReports(panel, wsId, app, writer, refreshApp) {
  clear(panel);
  const reports = [...(app.reports || [])];
  const fields = app.fields || [];

  if (writer) {
    panel.append(el('button', { class: 'btn btn--primary reports-add', onclick: () => openReportModal({ app, onSave: (r) => { reports.push(r); persist(); } }) }, [icon('plus'), ' New report']));
  }
  if (!fields.length) { panel.append(el('p', { class: 'muted' }, 'Add fields first, then build reports over them.')); return; }
  const box = el('div', { class: 'reports-grid' }, el('p', { class: 'muted' }, 'Loading…'));
  panel.append(box);

  async function persist() { try { await updateApp(wsId, app.id, { reports }); app.reports = reports; refreshApp(); } catch (e) { toast(e.message, 'error'); } }

  let items = [];
  try { items = await listRecords(wsId, app.id); } catch { items = []; }
  clear(box);
  if (!reports.length) { box.append(el('p', { class: 'muted' }, 'No reports yet.')); return; }
  for (const [i, r] of reports.entries()) box.append(renderReportCard(r, app, items, writer, () => { reports.splice(i, 1); persist(); }));
}

function renderReportCard(r, app, items, writer, onDelete) {
  const groupF = fieldByKey(app, r.groupBy);
  const sumF = r.metric === 'sum' ? fieldByKey(app, r.sumField) : null;
  // aggregate
  const buckets = new Map();
  for (const it of items) {
    const key = (it.values?.[r.groupBy] ?? '—') || '—';
    const add = r.metric === 'sum' ? (parseFloat(it.values?.[r.sumField]) || 0) : 1;
    buckets.set(String(key), (buckets.get(String(key)) || 0) + add);
  }
  const rows = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...rows.map((x) => x[1]));

  return el('div', { class: 'report-card card' }, [
    el('div', { class: 'report-head' }, [
      el('div', {}, [
        el('div', { class: 'report-title' }, r.title || 'Report'),
        el('div', { class: 'muted' }, `${r.metric === 'sum' ? `Sum of ${sumF?.label || '?'}` : 'Count'} by ${groupF?.label || '?'}`),
      ]),
      writer ? el('button', { class: 'link-danger', onclick: onDelete }, icon('x')) : null,
    ]),
    rows.length ? el('div', { class: 'report-bars' }, rows.map(([label, val]) => el('div', { class: 'wb-report-row' }, [
      el('div', { class: 'wb-report-label' }, label),
      el('div', { class: 'wb-report-track' }, el('div', { class: 'wb-report-bar', style: `width:${Math.round((val / max) * 100)}%` })),
      el('div', { class: 'wb-report-count' }, r.metric === 'sum' ? formatNum(val, sumF) : String(val)),
    ]))) : el('p', { class: 'muted' }, 'No items yet.'),
  ]);
}

function formatNum(v, f) {
  if (f?.type === 'money') return `${f.config?.currency || '$'}${v}`;
  return String(v);
}

function openReportModal({ app, onSave }) {
  const { body, close } = openModal({ title: 'New report', iconName: 'chart-bar' });
  const title = el('input', { class: 'input', placeholder: 'Report title' });
  const groupable = (app.fields || []).filter((f) => ['category', 'status', 'yesno', 'text', 'date'].includes(f.type));
  const numeric = (app.fields || []).filter((f) => NUMERIC_TYPES.includes(f.type));
  const groupBy = el('select', { class: 'input' }, groupable.map((f) => el('option', { value: f.key }, f.label)));
  const metric = el('select', { class: 'input' }, [el('option', { value: 'count' }, 'Count of items'), ...(numeric.length ? [el('option', { value: 'sum' }, 'Sum of a number field')] : [])]);
  const sumWrap = el('div', {});
  const sumField = el('select', { class: 'input' }, numeric.map((f) => el('option', { value: f.key }, f.label)));
  function drawSum() { clear(sumWrap); if (metric.value === 'sum') sumWrap.append(el('label', { class: 'form-label' }, 'Field to sum'), sumField); }
  metric.addEventListener('change', drawSum); drawSum();

  const save = el('button', { class: 'btn btn--primary' }, 'Create report');
  save.addEventListener('click', () => {
    if (!groupable.length) return toast('Add a category, status, text, or date field first.', 'error');
    onSave({ id: uid12(), title: title.value.trim() || 'Report', groupBy: groupBy.value, metric: metric.value, sumField: metric.value === 'sum' ? sumField.value : '' });
    close();
  });
  body.append(el('div', { class: 'field-modal' }, [
    el('label', { class: 'form-label' }, 'Title'), title,
    el('label', { class: 'form-label' }, 'Group by'), groupBy,
    el('label', { class: 'form-label' }, 'Metric'), metric, sumWrap,
    el('div', { class: 'app-create-foot' }, [el('button', { class: 'btn btn--ghost', onclick: close }, 'Cancel'), save]),
  ]));
}

/* ============================ Automations ============================ */

// Numeric comparison operators (mirrors quest-hq WB_TRIG_OPS).
const TRIG_OPS = [['==', 'equals'], ['!=', 'not equal'], ['>', 'greater than'], ['<', 'less than'], ['>=', 'at least'], ['<=', 'at most']];

function automationSummary(a, app) {
  const f = fieldByKey(app, a.trigger.fieldKey);
  const opLabel = NUMERIC_TYPES.includes(f?.type) ? (TRIG_OPS.find((o) => o[0] === a.trigger.op)?.[1] || 'is') : 'is';
  const acts = a.actions.map((ac) => ac.type === 'notify' ? `notify "${ac.message}"` : `set ${fieldByKey(app, ac.fieldKey)?.label || '?'} = ${ac.value}`).join(', ');
  return `When ${f?.label || '?'} ${opLabel} ${a.trigger.value} → ${acts || 'do nothing'}`;
}

function renderAutomations(panel, wsId, app, writer, refreshApp) {
  clear(panel);
  const autos = [...(app.automations || [])];
  const fields = app.fields || [];
  if (writer) {
    panel.append(el('button', { class: 'btn btn--primary', onclick: () => openAutomationModal({ app, onSave: (a) => { autos.push(a); persist(); } }) }, [icon('plus'), ' New automation']));
  }
  if (!fields.length) { panel.append(el('p', { class: 'muted' }, 'Add fields first, then automate them.')); return; }
  const list = el('div', { class: 'auto-list' });
  panel.append(list);

  async function persist() { try { await updateApp(wsId, app.id, { automations: autos }); app.automations = autos; refreshApp(); } catch (e) { toast(e.message, 'error'); } }

  if (!autos.length) { list.append(el('p', { class: 'muted' }, 'No automations yet. They run when a new item is added.')); return; }
  for (const [i, a] of autos.entries()) {
    list.append(el('div', { class: 'auto-card card' }, [
      el('div', { class: 'auto-icon' }, icon('bolt')),
      el('div', { class: 'auto-text' }, automationSummary(a, app)),
      writer ? el('button', { class: 'link-danger', onclick: () => { autos.splice(i, 1); persist(); } }, icon('x')) : null,
    ]));
  }
}

function openAutomationModal({ app, onSave }) {
  const { body, close } = openModal({ title: 'New automation', iconName: 'bolt', wide: true });
  const usableTrigFields = (app.fields || []).filter((f) => !['file', 'image', 'checklist'].includes(f.type));
  if (!usableTrigFields.length) { body.append(el('p', { class: 'muted' }, 'Add a field to trigger on.')); return; }

  const trigger = { fieldKey: usableTrigFields[0].key, op: '==', value: '' };
  const actions = [];

  const trigWrap = el('div', { class: 'trig-wrap' });
  function drawTrigger() {
    clear(trigWrap);
    const fSel = el('select', { class: 'input' }, usableTrigFields.map((f) => el('option', { value: f.key, ...(f.key === trigger.fieldKey ? { selected: 'selected' } : {}) }, f.label)));
    fSel.addEventListener('change', () => { trigger.fieldKey = fSel.value; trigger.value = ''; drawTrigger(); });
    const f = fieldByKey(app, trigger.fieldKey);
    const controls = [fSel];
    if (NUMERIC_TYPES.includes(f.type)) {
      const opSel = el('select', { class: 'input', style: 'max-width:150px' }, TRIG_OPS.map(([v, l]) => el('option', { value: v, ...(v === trigger.op ? { selected: 'selected' } : {}) }, l)));
      opSel.addEventListener('change', () => { trigger.op = opSel.value; });
      const val = el('input', { class: 'input', type: 'number', step: 'any', placeholder: 'Value', value: trigger.value });
      val.addEventListener('input', () => { trigger.value = val.value; });
      controls.push(opSel, val);
    } else if (f.type === 'category' || f.type === 'status') {
      const val = el('select', { class: 'input' }, [el('option', { value: '' }, '— value —'), ...(f.config?.options || []).map((o) => el('option', { value: o.label, ...(o.label === trigger.value ? { selected: 'selected' } : {}) }, o.label))]);
      val.addEventListener('change', () => { trigger.value = val.value; });
      controls.push(val);
    } else if (f.type === 'yesno') {
      const val = el('select', { class: 'input' }, [el('option', { value: 'Yes' }, 'Yes'), el('option', { value: 'No' }, 'No')]);
      val.value = trigger.value || 'Yes'; trigger.value = val.value;
      val.addEventListener('change', () => { trigger.value = val.value; });
      controls.push(val);
    } else {
      const val = el('input', { class: 'input', type: f.type === 'date' ? 'date' : 'text', placeholder: 'Exact value', value: trigger.value });
      val.addEventListener('input', () => { trigger.value = val.value; });
      controls.push(val);
    }
    trigWrap.append(el('div', { class: 'trig-row' }, controls));
  }
  drawTrigger();

  const actionsWrap = el('div', { class: 'actions-wrap' });
  function drawActions() {
    clear(actionsWrap);
    actions.forEach((ac, i) => actionsWrap.append(buildActionRow(app, ac, () => { actions.splice(i, 1); drawActions(); })));
  }
  function addAction() { actions.push({ type: 'notify', message: '' }); drawActions(); }

  const save = el('button', { class: 'btn btn--primary' }, 'Create automation');
  save.addEventListener('click', () => {
    if (trigger.value === '' || trigger.value == null) return toast('Set a trigger value.', 'error');
    if (!actions.length) return toast('Add at least one action.', 'error');
    onSave({ id: uid12(), trigger: { ...trigger }, actions: actions.map((a) => ({ ...a })) });
    close();
  });

  body.append(el('div', { class: 'field-modal' }, [
    el('label', { class: 'form-label' }, 'When a new item has…'), trigWrap,
    el('label', { class: 'form-label' }, 'Do these actions'), actionsWrap,
    el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: addAction }, [icon('plus'), ' Add action']),
    el('div', { class: 'app-create-foot' }, [el('button', { class: 'btn btn--ghost', onclick: close }, 'Cancel'), save]),
  ]));
  addAction();
}

function buildActionRow(app, ac, onRemove) {
  const settable = (app.fields || []).filter((f) => ['text', 'textarea', 'status', 'category', 'number', 'money', 'yesno', 'date', 'email', 'phone', 'location'].includes(f.type));
  const typeSel = el('select', { class: 'input', style: 'max-width:180px' }, [
    el('option', { value: 'notify', ...(ac.type === 'notify' ? { selected: 'selected' } : {}) }, 'Post a notification'),
    el('option', { value: 'set', ...(ac.type === 'set' ? { selected: 'selected' } : {}) }, 'Set a field value'),
  ]);
  const cfg = el('div', { class: 'action-cfg' });
  function drawCfg() {
    clear(cfg);
    if (ac.type === 'notify') {
      const msg = el('input', { class: 'input', placeholder: 'Message for the feed', value: ac.message || '' });
      msg.addEventListener('input', () => { ac.message = msg.value; });
      cfg.append(msg);
    } else {
      const fSel = el('select', { class: 'input' }, settable.length ? settable.map((f) => el('option', { value: f.key, ...(f.key === ac.fieldKey ? { selected: 'selected' } : {}) }, f.label)) : [el('option', { value: '' }, '(add a settable field)')]);
      if (!ac.fieldKey && settable[0]) ac.fieldKey = settable[0].key;
      fSel.addEventListener('change', () => { ac.fieldKey = fSel.value; ac.value = ''; drawCfg(); });
      const f = fieldByKey(app, ac.fieldKey);
      let valEl;
      if (f && (f.type === 'category' || f.type === 'status')) {
        valEl = el('select', { class: 'input' }, [el('option', { value: '' }, '— value —'), ...(f.config?.options || []).map((o) => el('option', { value: o.label, ...(o.label === ac.value ? { selected: 'selected' } : {}) }, o.label))]);
      } else if (f && f.type === 'yesno') {
        valEl = el('select', { class: 'input' }, [el('option', { value: 'Yes' }, 'Yes'), el('option', { value: 'No' }, 'No')]);
        valEl.value = ac.value || 'Yes';
      } else {
        valEl = el('input', { class: 'input', placeholder: 'Value to set', value: ac.value || '' });
      }
      valEl.addEventListener('input', () => { ac.value = valEl.value; });
      valEl.addEventListener('change', () => { ac.value = valEl.value; });
      cfg.append(fSel, valEl);
    }
  }
  typeSel.addEventListener('change', () => { ac.type = typeSel.value; drawCfg(); });
  drawCfg();
  return el('div', { class: 'action-row' }, [typeSel, cfg, el('button', { class: 'link-danger', type: 'button', onclick: onRemove }, icon('x'))]);
}

// Evaluate automations against a new item's values. Mutates values for set-actions;
// returns notification messages to post to the feed.
function runAutomations(app, values) {
  const notes = [];
  for (const a of (app.automations || [])) {
    const f = fieldByKey(app, a.trigger.fieldKey);
    if (!f) continue;
    const actual = values[a.trigger.fieldKey];
    if (!triggerMatches(f, a.trigger, actual)) continue;
    for (const ac of a.actions) {
      if (ac.type === 'set' && ac.fieldKey) values[ac.fieldKey] = ac.value;
      else if (ac.type === 'notify' && ac.message) notes.push(interpolate(ac.message, app, values));
    }
  }
  return notes;
}

function triggerMatches(f, trig, actual) {
  if (NUMERIC_TYPES.includes(f.type)) {
    const a = parseFloat(actual), b = parseFloat(trig.value);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    switch (trig.op) {
      case '!=': return a !== b; case '>': return a > b; case '<': return a < b;
      case '>=': return a >= b; case '<=': return a <= b; default: return a === b;
    }
  }
  return String(actual ?? '') === String(trig.value ?? '');
}

function interpolate(msg, app, values) {
  return msg.replace(/\{([^}]+)\}/g, (m, name) => {
    const f = (app.fields || []).find((x) => x.label.toLowerCase() === name.trim().toLowerCase());
    return f ? String(values[f.key] ?? '') : m;
  });
}

/* ---- Field config modal (replaces the native prompt) ---- */

function openFieldModal({ type, field, appFields, onSave }) {
  const meta = fieldMeta(type);
  const { body, close } = openModal({ title: field ? 'Edit field' : `New ${meta.label} field`, iconName: meta.icon });
  const config = field?.config ? JSON.parse(JSON.stringify(field.config)) : {};

  const labelInput = el('input', { class: 'input', placeholder: 'Field label', value: field?.label || '' });
  const cfg = el('div', { class: 'field-cfg' });
  const readers = []; // each returns a partial config object, merged on save
  const muted = (t) => el('span', { class: 'muted' }, t);

  if (meta.soon) {
    cfg.append(el('p', { class: 'muted' }, `${meta.label} fields are coming soon.`));
  } else if (['text', 'textarea', 'url'].includes(type)) {
    const ph = el('input', { class: 'input', value: config.placeholder || '', placeholder: type === 'url' ? 'https://…' : 'Hint shown in the input' });
    cfg.append(el('label', { class: 'form-label' }, ['Placeholder ', muted('(optional)')]), ph);
    readers.push(() => ({ placeholder: ph.value.trim() }));
  } else if (type === 'number') {
    const u = el('input', { class: 'input', value: config.unit || '', placeholder: 'e.g. sq ft, hrs', style: 'max-width:220px' });
    cfg.append(el('label', { class: 'form-label' }, ['Unit / suffix ', muted('(optional)')]), u);
    readers.push(() => ({ unit: u.value.trim() }));
  } else if (type === 'money') {
    const cur = el('input', { class: 'input', value: config.currency || '$', maxlength: '3', style: 'max-width:120px' });
    cfg.append(el('label', { class: 'form-label' }, 'Currency symbol'), cur);
    readers.push(() => ({ currency: cur.value.trim() || '$' }));
  } else if (type === 'category' || type === 'status') {
    const ed = buildOptionsEditor(config.options?.length ? config.options : [{ label: 'Option A', color: '#2563eb' }, { label: 'Option B', color: '#16a34a' }]);
    cfg.append(el('label', { class: 'form-label' }, 'Options'), ed.el);
    readers.push(() => ({ options: ed.read() }));
  } else if (type === 'checklist') {
    const ta = el('textarea', { class: 'input', rows: '4', placeholder: 'Site inspection\nMaterial order\nInstall\nFinal walkthrough' });
    ta.value = Array.isArray(config.steps) ? config.steps.join('\n') : '';
    cfg.append(el('label', { class: 'form-label' }, ['Default steps ', muted('(one per line)')]), ta);
    readers.push(() => ({ steps: ta.value.split('\n').map((s) => s.trim()).filter(Boolean) }));
  } else {
    cfg.append(el('p', { class: 'muted' }, 'No extra configuration needed for this field type.'));
  }

  const saveBtn = el('button', { class: 'btn btn--primary' }, field ? 'Save field' : [icon('plus'), ' Add field']);
  saveBtn.addEventListener('click', () => {
    const label = labelInput.value.trim();
    if (!label) return toast('Give the field a label.', 'error');
    const newConfig = {};
    for (const r of readers) Object.assign(newConfig, r());
    if ((type === 'category' || type === 'status') && !(newConfig.options || []).length) return toast('Add at least one option.', 'error');
    onSave({ key: field?.key || slug(label), label, type, config: newConfig });
    close();
  });

  body.append(el('div', { class: 'field-modal' }, [
    el('label', { class: 'form-label' }, 'Field label'), labelInput,
    cfg,
    el('div', { class: 'app-create-foot' }, [
      el('button', { class: 'btn btn--ghost', onclick: close }, 'Cancel'),
      meta.soon ? null : saveBtn,
    ]),
  ]));
}

// Options editor for category/status fields: colored rows + add/remove.
function buildOptionsEditor(initial) {
  const list = el('div', { class: 'opt-list' });
  const rows = [];
  function addRow(o) {
    const color = el('input', { type: 'color', class: 'opt-color', value: o.color || '#2563eb' });
    const label = el('input', { class: 'input opt-label', value: o.label || '', placeholder: 'Option label' });
    const row = el('div', { class: 'opt-row' }, [color, label,
      el('button', { class: 'link-danger', type: 'button', onclick: () => { const i = rows.indexOf(entry); if (i >= 0) { rows.splice(i, 1); row.remove(); } } }, icon('x')),
    ]);
    const entry = { read: () => ({ label: label.value.trim(), color: color.value }), row };
    rows.push(entry); list.append(row);
  }
  (initial || []).forEach(addRow);
  const addBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', onclick: () => addRow({ label: '', color: '#2563eb' }) }, [icon('plus'), ' Add option']);
  return { el: el('div', {}, [list, addBtn]), read: () => rows.map((r) => r.read()).filter((o) => o.label) };
}

/* ---- Settings tab ---- */

function renderSettings(panel, wsId, app, writer, user, refreshApp, onBack) {
  clear(panel);
  if (!writer) { panel.append(el('p', { class: 'muted' }, 'You have view-only access to this app.')); return; }
  const name = el('input', { class: 'input', value: app.name });
  const desc = el('textarea', { class: 'input', rows: '2' }); desc.value = app.description || '';
  const save = el('button', { class: 'btn btn--primary' }, 'Save changes');
  save.addEventListener('click', async () => {
    try { await updateApp(wsId, app.id, { name: name.value.trim() || app.name, description: desc.value.trim() }); toast('Saved', 'success'); refreshApp(); }
    catch (err) { toast(err.message, 'error'); }
  });
  // Export the app definition (structure only) as a .rom.json file.
  const exportBtn = el('button', { class: 'btn btn--ghost' }, [icon('download'), ' Export (.rom.json)']);
  exportBtn.addEventListener('click', () => {
    const fname = (app.name || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.rom.json';
    downloadFile(fname, JSON.stringify(appToDefinition(app), null, 2));
    toast('Exported', 'success');
  });

  // Share the app to the ROM App Market so others can install it.
  const shareBtn = el('button', { class: 'btn btn--ghost' }, [icon('building-store'), ' Share to App Market']);
  shareBtn.addEventListener('click', async () => {
    shareBtn.disabled = true;
    try { await publishToMarket(user, appToDefinition(app)); toast('Shared to the App Market.', 'success'); }
    catch (err) { toast(err.message, 'error'); }
    finally { shareBtn.disabled = false; }
  });

  const del = el('button', { class: 'btn btn--danger' }, [icon('trash'), ' Delete app']);
  del.addEventListener('click', async () => {
    if (!confirm(`Delete app "${app.name}"? This removes its fields and items.`)) return;
    try { await deleteApp(wsId, app.id); toast('App deleted', 'success'); onBack(); }
    catch (err) { toast(err.message, 'error'); }
  });
  panel.append(el('div', { class: 'app-settings' }, [
    el('label', { class: 'form-label' }, 'App name'), name,
    el('label', { class: 'form-label' }, 'Description'), desc,
    el('div', { class: 'row' }, [save]),
    el('label', { class: 'form-label' }, 'Share & export'),
    el('div', { class: 'row' }, [exportBtn, shareBtn]),
    el('div', { class: 'app-settings-danger' }, [del]),
  ]));
}
