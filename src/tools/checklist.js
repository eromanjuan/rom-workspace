// Checklist tool: PERSONAL checklists for the signed-in user. Everyone can
// freely create checklists, add items, and mark done/undone — no workspace or
// permission gating. Data lives at users/{uid}/checklists. A workspace
// Checklist tile can snapshot a chosen checklist onto a dashboard.
import { el, clear, icon, toast } from '../ui/dom.js';
import { addUserDoc, subscribeUserDocs, updateUserDoc, deleteUserDoc } from '../workspaces/data.js';

export function renderChecklist(host, user) {
  clear(host);

  const nameInput = el('input', { class: 'input', placeholder: 'New checklist title' });
  const createBtn = el('button', { class: 'btn btn--primary' }, [icon('plus'), ' Create checklist']);
  createBtn.addEventListener('click', async () => {
    const title = nameInput.value.trim();
    if (!title) return;
    createBtn.disabled = true;
    try { await addUserDoc(user.uid, 'checklists', { title, items: [] }); nameInput.value = ''; }
    catch (err) { toast(err.message, 'error'); }
    finally { createBtn.disabled = false; }
  });

  const list = el('div', { class: 'cl-grid' }, el('p', { class: 'muted' }, 'Loading…'));

  host.append(el('div', { class: 'checklist-page' }, [
    el('h2', { class: 'section__title' }, 'Checklist'),
    el('div', { class: 'row cl-create' }, [nameInput, createBtn]),
    list,
  ]));

  function card(cl) {
    const items = Array.isArray(cl.items) ? cl.items : [];
    const done = items.filter((i) => i.done).length;
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;

    async function saveItems(next) { try { await updateUserDoc(user.uid, 'checklists', cl.id, { items: next }); } catch (e) { toast(e.message, 'error'); } }

    const itemsEl = el('div', { class: 'cl-items' }, items.map((it, i) => {
      const cb = el('input', { type: 'checkbox', ...(it.done ? { checked: 'checked' } : {}) });
      cb.addEventListener('change', () => saveItems(items.map((x, j) => j === i ? { ...x, done: cb.checked } : x)));
      return el('div', { class: `cl-item ${it.done ? 'cl-item--done' : ''}` }, [
        cb, el('span', { class: 'cl-item-text' }, it.text),
        el('button', { class: 'link-danger', onclick: () => saveItems(items.filter((_, j) => j !== i)) }, icon('x')),
      ]);
    }));

    const addInput = el('input', { class: 'input input--sm', placeholder: 'Add item…' });
    const addForm = el('form', { class: 'cl-additem', onsubmit: (e) => { e.preventDefault(); const t = addInput.value.trim(); if (!t) return; addInput.value = ''; saveItems([...items, { text: t, done: false }]); } }, [
      addInput, el('button', { class: 'btn btn--primary btn--sm', type: 'submit' }, icon('plus')),
    ]);

    return el('div', { class: 'cl-card card' }, [
      el('div', { class: 'cl-head' }, [
        el('div', { class: 'cl-title' }, cl.title),
        el('button', { class: 'link-danger', title: 'Delete', onclick: async () => { if (!confirm(`Delete "${cl.title}"?`)) return; try { await deleteUserDoc(user.uid, 'checklists', cl.id); } catch (e) { toast(e.message, 'error'); } } }, icon('trash')),
      ]),
      el('div', { class: 'cl-progress' }, [
        el('div', { class: 'cl-progress-track' }, el('div', { class: 'cl-progress-bar', style: `width:${pct}%` })),
        el('span', { class: 'muted' }, `${done}/${items.length}`),
      ]),
      itemsEl,
      addForm,
    ]);
  }

  return subscribeUserDocs(user.uid, 'checklists', (lists) => {
    clear(list);
    if (!lists.length) { list.append(el('p', { class: 'muted' }, 'No checklists yet. Create one above.')); return; }
    for (const cl of lists) list.append(card(cl));
  }, (err) => { clear(list); list.append(el('p', { class: 'error-text' }, err.message)); });
}
