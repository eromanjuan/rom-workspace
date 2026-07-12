// Personal widgets panel shown beside the feed. Users pick widgets from a
// catalog; the chosen set + light per-widget data persist in localStorage (a
// personal, per-browser UI preference). Each renderer may return a cleanup fn.
import { el, clear, icon, openModal } from '../ui/dom.js';

const LIST_KEY = (uid) => `romio-widgets-${uid}`;
function loadList(uid) { try { return JSON.parse(localStorage.getItem(LIST_KEY(uid)) || 'null'); } catch { return null; } }
function saveList(uid, list) { localStorage.setItem(LIST_KEY(uid), JSON.stringify(list)); }

// ---------- widget registry ----------
const WIDGETS = {
  clock: { label: 'Clock', ic: 'clock', render: wClock, config: 'clock' },
  date: { label: 'Date', ic: 'calendar-event', render: wDate },
  calendar: { label: 'Calendar', ic: 'calendar', render: wCalendar },
  calculator: { label: 'Calculator', ic: 'calculator', render: wCalc },
  notes: { label: 'Quick note', ic: 'notes', render: wNote },
  checklist: { label: 'Checklist', ic: 'checklist', render: wChecklist },
  weather: { label: 'Weather', ic: 'cloud', render: wWeather },
  // Need data we don't surface yet — shown in the catalog as "Soon".
  apps: { label: 'Apps', ic: 'apps', soon: true },
  appreports: { label: 'App reports', ic: 'chart-bar', soon: true },
  appitems: { label: 'App items', ic: 'list-details', soon: true },
  mails: { label: 'Mails', ic: 'mail', soon: true },
  notifications: { label: 'Notifications', ic: 'bell', soon: true },
};
const DEFAULTS = [{ id: 'clock' }, { id: 'calendar' }];

export function renderWidgetsPanel(host, user) {
  clear(host);
  let list = loadList(user.uid);
  if (!list) { list = DEFAULTS.slice(); saveList(user.uid, list); }
  let manage = false;        // edit mode — remove (✕) + drag only appear here
  let dragFrom = null;
  const cleanups = [];
  const body = el('div', { class: 'widgets-list' });

  const editBtn = el('button', { class: 'btn btn--ghost btn--sm' }, [icon('pencil'), ' Edit']);
  editBtn.addEventListener('click', () => {
    manage = !manage;
    editBtn.replaceChildren(icon(manage ? 'check' : 'pencil'), ' ', manage ? 'Done' : 'Edit');
    host.classList.toggle('widgets--manage', manage);
    draw();
  });
  host.append(
    el('div', { class: 'widgets-head' }, [
      el('h3', { class: 'widgets-title' }, [icon('layout-grid'), ' Widgets']),
      el('div', { class: 'widgets-actions' }, [
        editBtn,
        el('button', { class: 'btn btn--ghost btn--sm', onclick: openCatalog }, [icon('plus'), ' Add']),
      ]),
    ]),
    body,
  );

  function runCleanups() { while (cleanups.length) { const fn = cleanups.pop(); try { fn && fn(); } catch { /* ignore */ } } }

  function draw() {
    runCleanups();
    clear(body);
    const active = list.filter((w) => WIDGETS[w.id] && !WIDGETS[w.id].soon);
    if (!active.length) { body.append(el('p', { class: 'muted widgets-empty' }, 'No widgets yet. Tap “Add”.')); return; }
    list.forEach((w, i) => {
      const def = WIDGETS[w.id];
      if (!def || def.soon) return;
      const content = el('div', { class: 'widget-body' });
      const head = el('div', { class: 'widget-head' }, [
        el('span', { class: 'widget-title' }, [
          manage ? el('span', { class: 'widget-grip', title: 'Drag to reorder' }, icon('grip-vertical')) : null,
          icon(def.ic), ' ', def.label,
        ]),
        el('span', { class: 'widget-head-acts' }, [
          def.config ? el('button', { class: 'widget-cfg', title: 'Configure', onclick: () => openWidgetConfig(w) }, icon('settings')) : null,
          manage ? el('button', { class: 'widget-x', title: 'Remove', onclick: () => { list.splice(i, 1); saveList(user.uid, list); draw(); } }, icon('x')) : null,
        ]),
      ]);
      const card = el('div', { class: `widget-card card ${manage ? 'is-manage' : ''}` }, [head, content]);
      if (manage) {
        card.setAttribute('draggable', 'true');
        card.addEventListener('dragstart', (e) => { dragFrom = i; card.classList.add('dragging'); try { e.dataTransfer.effectAllowed = 'move'; } catch { /* ignore */ } });
        card.addEventListener('dragend', () => { dragFrom = null; card.classList.remove('dragging'); body.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target')); });
        card.addEventListener('dragover', (e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== i) card.classList.add('drop-target'); });
        card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
        card.addEventListener('drop', (e) => {
          e.preventDefault();
          card.classList.remove('drop-target');
          if (dragFrom === null || dragFrom === i) return;
          const [moved] = list.splice(dragFrom, 1);
          list.splice(i, 0, moved);
          saveList(user.uid, list);
          draw();
        });
      }
      body.append(card);
      cleanups.push(def.render(content, user, w));
    });
  }

  // Per-widget configuration (currently just the clock's time zone).
  function openWidgetConfig(w) {
    const def = WIDGETS[w.id];
    if (!def || def.config !== 'clock') return;
    const { body: mb, close } = openModal({ title: 'Clock time zone', iconName: 'clock' });
    const sel = el('select', { class: 'input' });
    sel.append(el('option', { value: '' }, 'Local time (this device)'));
    for (const z of timeZones()) sel.append(el('option', { value: z, ...(z === (w.tz || '') ? { selected: 'selected' } : {}) }, z.replace(/_/g, ' ')));
    const save = el('button', { class: 'btn btn--primary' }, 'Save');
    save.addEventListener('click', () => { w.tz = sel.value; saveList(user.uid, list); draw(); close(); });
    mb.append(
      el('label', { class: 'form-label' }, 'Time zone'),
      sel,
      el('div', { class: 'confirm-modal__actions', style: 'margin-top:14px' }, [save]),
    );
  }

  function openCatalog() {
    const { body: mb, close } = openModal({ title: 'Add a widget', iconName: 'layout-grid', wide: true });
    const grid = el('div', { class: 'widget-catalog' });
    for (const [id, def] of Object.entries(WIDGETS)) {
      const card = el('button', { class: `widget-cat ${def.soon ? 'is-soon' : ''}`, type: 'button', ...(def.soon ? { disabled: 'disabled' } : {}) }, [
        el('span', { class: 'widget-cat-ic' }, icon(def.ic)),
        el('span', { class: 'widget-cat-label' }, def.label),
        def.soon ? el('span', { class: 'widget-cat-soon' }, 'Soon') : null,
      ]);
      if (!def.soon) card.addEventListener('click', () => { list.push({ id }); saveList(user.uid, list); draw(); close(); });
      grid.append(card);
    }
    mb.append(el('p', { class: 'muted', style: 'margin:0 0 .75rem' }, 'Pick a widget to add to your panel.'), grid);
  }

  draw();
  return () => runCleanups();
}

/* ================= widget renderers ================= */

// All IANA time zones (fallback to a common subset on older browsers).
function timeZones() {
  try { if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone'); } catch { /* ignore */ }
  return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Africa/Cairo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Manila', 'Asia/Hong_Kong', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland'];
}

function wClock(b, user, w) {
  const tz = (w && w.tz) || '';
  const time = el('div', { class: 'w-clock-time' });
  const sub = el('div', { class: 'w-clock-sub muted' });
  const zone = tz ? el('div', { class: 'w-clock-zone' }, tz.replace(/_/g, ' ').split('/').pop()) : null;
  b.append(el('div', { class: 'w-clock' }, [time, sub, zone]));
  const tick = () => {
    const d = new Date();
    const topt = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
    const dopt = { weekday: 'long', month: 'short', day: 'numeric' };
    try {
      time.textContent = d.toLocaleTimeString([], tz ? { ...topt, timeZone: tz } : topt);
      sub.textContent = d.toLocaleDateString([], tz ? { ...dopt, timeZone: tz } : dopt);
    } catch { /* invalid tz */ }
  };
  tick();
  const iv = setInterval(tick, 1000);
  return () => clearInterval(iv);
}

function wDate(b) {
  const d = new Date();
  b.append(el('div', { class: 'w-date' }, [
    el('div', { class: 'w-date-dow muted' }, d.toLocaleDateString([], { weekday: 'long' })),
    el('div', { class: 'w-date-day' }, String(d.getDate())),
    el('div', { class: 'w-date-mo muted' }, d.toLocaleDateString([], { month: 'long', year: 'numeric' })),
  ]));
}

function wCalendar(b) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const inMonth = d.getMonth() === m;
    const today = d.toDateString() === now.toDateString();
    cells.push(el('div', { class: `w-cal-d ${inMonth ? '' : 'w-cal-muted'} ${today ? 'w-cal-today' : ''}` }, String(d.getDate())));
  }
  b.append(el('div', { class: 'w-cal' }, [
    el('div', { class: 'w-cal-mo' }, now.toLocaleDateString([], { month: 'long', year: 'numeric' })),
    el('div', { class: 'w-cal-dow' }, dow.map((x) => el('div', {}, x))),
    el('div', { class: 'w-cal-grid' }, cells),
  ]));
}

function wCalc(b) {
  let expr = '';
  const disp = el('input', { class: 'w-calc-disp', readonly: 'readonly', value: '0' });
  const upd = () => { disp.value = expr || '0'; };
  const keys = ['C', '(', ')', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '='];
  const grid = el('div', { class: 'w-calc-grid' });
  const safeEval = (e) => { if (!/^[-+*/.()\d\s]*$/.test(e) || !e.trim()) return ''; return String(Function(`"use strict";return (${e})`)()); };
  keys.forEach((k) => {
    const cls = k === '=' ? 'w-calc-eq' : '/*-+'.includes(k) ? 'w-calc-op' : k === 'C' ? 'w-calc-c' : '';
    const btn = el('button', { class: `w-calc-k ${cls}`, type: 'button' }, k);
    btn.addEventListener('click', () => {
      if (k === 'C') expr = '';
      else if (k === '=') { try { const r = safeEval(expr); expr = r === '' ? '' : r; } catch { disp.value = 'Error'; expr = ''; return; } }
      else expr += k;
      upd();
    });
    grid.append(btn);
  });
  b.append(el('div', { class: 'w-calc' }, [disp, grid]));
}

function wNote(b, user) {
  const key = `romio-w-note-${user.uid}`;
  const ta = el('textarea', { class: 'w-note', placeholder: 'Jot something down…' });
  ta.value = localStorage.getItem(key) || '';
  ta.addEventListener('input', () => localStorage.setItem(key, ta.value));
  b.append(ta);
}

function wChecklist(b, user) {
  const key = `romio-w-check-${user.uid}`;
  let items = [];
  try { items = JSON.parse(localStorage.getItem(key) || '[]'); } catch { items = []; }
  const persist = () => localStorage.setItem(key, JSON.stringify(items));
  const listEl = el('div', { class: 'w-check-list' });
  function draw() {
    clear(listEl);
    items.forEach((it, i) => {
      const cb = el('input', { type: 'checkbox', ...(it.done ? { checked: 'checked' } : {}) });
      cb.addEventListener('change', () => { items[i].done = cb.checked; persist(); draw(); });
      listEl.append(el('div', { class: `w-check-item ${it.done ? 'w-check-done' : ''}` }, [
        cb,
        el('span', { class: 'w-check-tx' }, it.text),
        el('button', { class: 'w-check-x', onclick: () => { items.splice(i, 1); persist(); draw(); } }, icon('x')),
      ]));
    });
  }
  const input = el('input', { class: 'input input--sm', placeholder: 'Add item…' });
  const form = el('form', { class: 'w-check-add', onsubmit: (e) => { e.preventDefault(); const t = input.value.trim(); if (!t) return; items.push({ text: t, done: false }); input.value = ''; persist(); draw(); } }, [
    input, el('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, icon('plus')),
  ]);
  b.append(listEl, form);
  draw();
}

const WMO = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
function wWeather(b) {
  const box = el('div', { class: 'w-weather' }, el('span', { class: 'muted' }, 'Getting your location…'));
  b.append(box);
  if (!navigator.geolocation) { box.replaceChildren(el('span', { class: 'muted' }, 'Location not supported.')); return; }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude: lat, longitude: lon } = pos.coords;
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`);
      const j = await r.json();
      const t = Math.round(j.current.temperature_2m);
      clear(box);
      box.append(
        el('div', { class: 'w-weather-t' }, `${t}°`),
        el('div', { class: 'w-weather-d muted' }, WMO[j.current.weather_code] || 'Now'),
      );
    } catch { box.replaceChildren(el('span', { class: 'muted' }, 'Weather unavailable right now.')); }
  }, () => { box.replaceChildren(el('span', { class: 'muted' }, 'Allow location access to see weather.')); }, { timeout: 8000 });
}
