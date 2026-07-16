// Calendar tool: a PERSONAL calendar (month / week / year) for the signed-in
// user. Everyone can freely add/manage their own events — no workspace or
// permission gating. Data lives at users/{uid}/events. A workspace Calendar
// tile can snapshot these events onto a dashboard.
import { el, clear, icon, escapeHtml, toast, openModal } from '../ui/dom.js';
import { addUserDoc, subscribeUserDocs, deleteUserDoc } from '../workspaces/data.js';
import { requestReminderPermission, primeReminderAudio } from './reminders.js';

// Reminder lead-times offered per event (days before; 0 = on the day).
const REMIND_OPTS = [[0, 'On the day'], [1, '1 day before'], [2, '2 days before'], [3, '3 days before'], [7, '1 week before']];
const remindLabel = (d) => (REMIND_OPTS.find(([v]) => v === Number(d)) || [d, `${d} days before`])[1];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => isoOf(new Date());

export function renderCalendar(host, user) {
  clear(host);
  const state = { view: 'month', cursor: new Date() };
  let events = [];

  const titleEl = el('h2', { class: 'cal-title' }, '');
  const grid = el('div', { class: 'cal-grid-wrap' });
  const segWrap = el('div', { class: 'seg-group' });
  const viewBtn = (v, label) => el('button', { class: `seg ${state.view === v ? 'seg--active' : ''}`, onclick: () => { state.view = v; draw(); } }, label);
  function drawSeg() { clear(segWrap).append(viewBtn('week', 'Week'), viewBtn('month', 'Month'), viewBtn('year', 'Year')); }

  const header = el('div', { class: 'cal-header' }, [
    el('div', { class: 'cal-nav' }, [
      el('button', { class: 'btn btn--ghost', onclick: () => { shiftCursor(-1); draw(); } }, icon('chevron-left')),
      el('button', { class: 'btn btn--ghost', onclick: () => { state.cursor = new Date(); draw(); } }, 'Today'),
      el('button', { class: 'btn btn--ghost', onclick: () => { shiftCursor(1); draw(); } }, icon('chevron-right')),
      titleEl,
    ]),
    el('div', { class: 'cal-actions' }, [
      segWrap,
      el('button', { class: 'btn btn--primary', onclick: () => openEventModal(todayIso()) }, [icon('plus'), ' Add event']),
    ]),
  ]);

  host.append(el('div', { class: 'calendar' }, [
    el('h2', { class: 'section__title' }, 'Calendar'),
    header, grid,
  ]));

  function shiftCursor(dir) {
    const c = state.cursor;
    if (state.view === 'week') c.setDate(c.getDate() + 7 * dir);
    else if (state.view === 'month') c.setMonth(c.getMonth() + dir);
    else c.setFullYear(c.getFullYear() + dir);
    state.cursor = new Date(c);
  }
  function eventsOn(iso) { return events.filter((e) => e.date === iso).sort((a, b) => (a.time || '').localeCompare(b.time || '')); }

  function dayCell(date, muted) {
    const iso = isoOf(date);
    const dayEvents = eventsOn(iso);
    return el('div', { class: `cal-day ${muted ? 'cal-day--muted' : ''} ${iso === todayIso() ? 'cal-day--today' : ''}`, onclick: () => openEventModal(iso) }, [
      el('div', { class: 'cal-daynum' }, String(date.getDate())),
      el('div', { class: 'cal-events' }, dayEvents.slice(0, 4).map((ev) => el('button', { class: 'cal-event', onclick: (e) => { e.stopPropagation(); openEventView(ev); } }, [ev.time ? el('span', { class: 'cal-event-time' }, ev.time + ' ') : null, ev.title]))),
      dayEvents.length > 4 ? el('div', { class: 'muted cal-more' }, `+${dayEvents.length - 4} more`) : null,
    ]);
  }

  function drawMonth() {
    const c = state.cursor;
    titleEl.textContent = `${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
    const first = new Date(c.getFullYear(), c.getMonth(), 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    const cells = [];
    for (let i = 0; i < 42; i += 1) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(dayCell(d, d.getMonth() !== c.getMonth())); }
    clear(grid).append(el('div', { class: 'cal-dow' }, DOW.map((d) => el('div', {}, d))), el('div', { class: 'cal-month' }, cells));
  }
  function drawWeek() {
    const c = state.cursor;
    const start = new Date(c); start.setDate(c.getDate() - c.getDay());
    const end = new Date(start); end.setDate(start.getDate() + 6);
    titleEl.textContent = `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    const cols = [];
    for (let i = 0; i < 7; i += 1) { const d = new Date(start); d.setDate(start.getDate() + i); cols.push(el('div', { class: 'cal-weekcol' }, [el('div', { class: `cal-weekhead ${isoOf(d) === todayIso() ? 'cal-day--today' : ''}` }, `${DOW[d.getDay()]} ${d.getDate()}`), dayCell(d, false)])); }
    clear(grid).append(el('div', { class: 'cal-week' }, cols));
  }
  function drawYear() {
    const c = state.cursor;
    titleEl.textContent = String(c.getFullYear());
    const months = MONTHS.map((mName, m) => {
      const first = new Date(c.getFullYear(), m, 1);
      const start = new Date(first); start.setDate(1 - first.getDay());
      const days = [];
      for (let i = 0; i < 42; i += 1) { const d = new Date(start); d.setDate(start.getDate() + i); const has = eventsOn(isoOf(d)).length; days.push(el('div', { class: `cal-mini-day ${d.getMonth() !== m ? 'cal-day--muted' : ''} ${isoOf(d) === todayIso() ? 'cal-day--today' : ''} ${has ? 'cal-mini-has' : ''}`, onclick: () => { state.cursor = d; state.view = 'month'; draw(); } }, String(d.getDate()))); }
      return el('div', { class: 'cal-mini card' }, [el('div', { class: 'cal-mini-title' }, mName), el('div', { class: 'cal-mini-dow' }, DOW.map((x) => el('div', {}, x[0]))), el('div', { class: 'cal-mini-grid' }, days)]);
    });
    clear(grid).append(el('div', { class: 'cal-year' }, months));
  }
  function draw() { drawSeg(); if (state.view === 'month') drawMonth(); else if (state.view === 'week') drawWeek(); else drawYear(); }

  function openEventModal(iso) {
    const { body, close } = openModal({ title: 'Add event', iconName: 'calendar-plus' });
    const title = el('input', { class: 'input', placeholder: 'Event title' });
    const date = el('input', { class: 'input', type: 'date', value: iso });
    const time = el('input', { class: 'input', type: 'time' });
    const note = el('textarea', { class: 'input', rows: '2', placeholder: 'Notes (optional)' });
    // Reminder lead-times (checkboxes). "On the day" is on by default.
    const remindChecks = REMIND_OPTS.map(([d, label]) => {
      const cb = el('input', { type: 'checkbox', class: 'vis-check' });
      if (d === 0) cb.checked = true;
      return { d, label, cb };
    });
    const remindRow = el('div', { class: 'cal-remind' }, remindChecks.map(({ label, cb }) => el('label', { class: 'cal-remind-opt' }, [cb, el('span', {}, label)])));
    const save = el('button', { class: 'btn btn--primary' }, [icon('plus'), ' Add event']);
    save.addEventListener('click', async () => {
      if (!title.value.trim()) return toast('Give the event a title.', 'error');
      const reminders = remindChecks.filter((x) => x.cb.checked).map((x) => x.d);
      // These need a user gesture — do it here, on the Save click.
      if (reminders.length) { requestReminderPermission(); primeReminderAudio(); }
      save.disabled = true;
      try { await addUserDoc(user.uid, 'events', { title: title.value.trim(), date: date.value, time: time.value, note: note.value.trim(), reminders }); toast('Event added', 'success'); close(); }
      catch (err) { toast(err.message, 'error'); save.disabled = false; }
    });
    body.append(el('div', { class: 'field-modal' }, [
      el('label', { class: 'form-label' }, 'Title'), title,
      el('div', { class: 'row' }, [el('div', { style: 'flex:1' }, [el('label', { class: 'form-label' }, 'Date'), date]), el('div', { style: 'flex:1' }, [el('label', { class: 'form-label' }, 'Time'), time])]),
      el('label', { class: 'form-label' }, [icon('bell'), ' Remind me']),
      remindRow,
      el('div', { class: 'muted cal-remind-hint' }, 'Alerts show in the bell and as a desktop alarm (with sound) while ROMIO is open in a tab.'),
      el('label', { class: 'form-label' }, 'Notes'), note,
      el('div', { class: 'app-create-foot' }, [save]),
    ]));
  }
  function openEventView(ev) {
    const { body, close } = openModal({ title: ev.title, iconName: 'calendar-event' });
    const reminders = Array.isArray(ev.reminders) ? ev.reminders : (ev.remind != null && ev.remind !== '' ? [ev.remind] : []);
    body.append(el('div', { class: 'field-modal' }, [
      el('p', {}, `${ev.date}${ev.time ? ' · ' + ev.time : ''}`),
      reminders.length ? el('p', { class: 'cal-remind-view' }, [icon('bell'), ` Reminders: ${reminders.map(remindLabel).join(', ')}`]) : null,
      ev.note ? el('p', { class: 'muted', html: escapeHtml(ev.note).replace(/\n/g, '<br>') }) : null,
      el('div', { class: 'app-create-foot' }, [el('button', { class: 'btn btn--danger', onclick: async () => { try { await deleteUserDoc(user.uid, 'events', ev.id); close(); } catch (e) { toast(e.message, 'error'); } } }, [icon('trash'), ' Delete'])]),
    ]));
  }

  draw();
  return subscribeUserDocs(user.uid, 'events', (list) => { events = list; draw(); }, () => {});
}
