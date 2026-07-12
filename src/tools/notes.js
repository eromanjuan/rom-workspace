// Notes tool: PERSONAL notes for the signed-in user, with basic formatting
// (bold/italic/underline + size), shown by cards, list, or grouped by tags.
// Everyone can freely create/edit their own — no workspace or permission
// gating. Data lives at users/{uid}/notes. A workspace Notes tile can pin a
// chosen note onto a dashboard.
import { el, clear, icon, toast, openModal } from '../ui/dom.js';
import { addUserDoc, subscribeUserDocs, updateUserDoc, deleteUserDoc } from '../workspaces/data.js';

const stripHtml = (html) => { const d = document.createElement('div'); d.innerHTML = html || ''; return (d.textContent || '').trim(); };

export function renderNotes(host, user) {
  clear(host);
  const state = { view: 'cards' };
  let notes = [];

  const board = el('div', { class: 'notes-board' }, el('p', { class: 'muted' }, 'Loading…'));
  const viewBtn = (v, label, ic) => el('button', { class: `seg ${state.view === v ? 'seg--active' : ''}`, onclick: () => { state.view = v; draw(); } }, [icon(ic), ' ' + label]);
  const segWrap = el('div', { class: 'seg-group' });
  function drawSeg() { clear(segWrap).append(viewBtn('cards', 'Cards', 'layout-grid'), viewBtn('list', 'List', 'list'), viewBtn('tags', 'Tags', 'tag')); }

  host.append(el('div', { class: 'notes-page' }, [
    el('div', { class: 'notes-head' }, [
      el('h2', { class: 'section__title' }, 'Notes'),
      el('div', { class: 'notes-actions' }, [segWrap, el('button', { class: 'btn btn--primary', onclick: () => openEditor(null) }, [icon('plus'), ' New note'])]),
    ]),
    board,
  ]));

  function noteCard(n) {
    return el('div', { class: 'note-card card', onclick: () => openEditor(n) }, [
      el('div', { class: 'note-card-title' }, n.title || 'Untitled'),
      el('div', { class: 'note-card-body', html: n.html || '<span class="muted">Empty note</span>' }),
      (n.tags || []).length ? el('div', { class: 'note-tags' }, n.tags.map((t) => el('span', { class: 'note-tag' }, '#' + t))) : null,
    ]);
  }
  function noteRow(n) {
    return el('div', { class: 'note-row card', onclick: () => openEditor(n) }, [
      el('div', { class: 'note-row-main' }, [
        el('div', { class: 'note-card-title' }, n.title || 'Untitled'),
        el('div', { class: 'muted note-snippet' }, stripHtml(n.html).slice(0, 120) || 'Empty note'),
      ]),
      (n.tags || []).length ? el('div', { class: 'note-tags' }, n.tags.map((t) => el('span', { class: 'note-tag' }, '#' + t))) : null,
    ]);
  }

  function draw() {
    drawSeg();
    clear(board);
    if (!notes.length) { board.append(el('p', { class: 'muted' }, 'No notes yet. Create one with New note.')); return; }
    if (state.view === 'cards') board.append(el('div', { class: 'notes-grid' }, notes.map(noteCard)));
    else if (state.view === 'list') board.append(el('div', { class: 'notes-list' }, notes.map(noteRow)));
    else {
      const byTag = new Map();
      for (const n of notes) {
        const tags = (n.tags || []).length ? n.tags : ['Untagged'];
        for (const t of tags) { if (!byTag.has(t)) byTag.set(t, []); byTag.get(t).push(n); }
      }
      for (const [tag, list] of byTag) {
        board.append(el('div', { class: 'notes-taggroup' }, [
          el('div', { class: 'notes-tagtitle' }, [icon('tag'), ' ' + tag, el('span', { class: 'muted' }, ` (${list.length})`)]),
          el('div', { class: 'notes-grid' }, list.map(noteCard)),
        ]));
      }
    }
  }

  // note editor modal
  function openEditor(note) {
    const { body, close } = openModal({ title: note ? 'Edit note' : 'New note', iconName: 'notes', wide: true });
    const title = el('input', { class: 'input', placeholder: 'Note title', value: note?.title || '' });
    const editor = el('div', { class: 'note-editor input', contenteditable: 'true' });
    editor.innerHTML = note?.html || '';
    const tags = el('input', { class: 'input', placeholder: 'tags, comma, separated', value: (note?.tags || []).join(', ') });

    const cmd = (command, val) => { document.execCommand(command, false, val); editor.focus(); };
    const fmtBtn = (ic, command, val, label) => el('button', { class: 'note-fmt', type: 'button', title: label, onmousedown: (e) => { e.preventDefault(); cmd(command, val); } }, icon(ic));
    const sizeSel = el('select', { class: 'input input--sm', onmousedown: (e) => e.stopPropagation() }, [
      el('option', { value: '3' }, 'Regular'), el('option', { value: '2' }, 'Small'), el('option', { value: '5' }, 'Large'), el('option', { value: '6' }, 'Heading'),
    ]);
    sizeSel.addEventListener('change', () => cmd('fontSize', sizeSel.value));

    const toolbar = el('div', { class: 'note-toolbar' }, [
      fmtBtn('bold', 'bold', null, 'Bold'),
      fmtBtn('italic', 'italic', null, 'Italic'),
      fmtBtn('underline', 'underline', null, 'Underline'),
      fmtBtn('list', 'insertUnorderedList', null, 'Bullet list'),
      sizeSel,
    ]);

    const save = el('button', { class: 'btn btn--primary' }, [icon('device-floppy'), ' Save note']);
    save.addEventListener('click', async () => {
      const data = { title: title.value.trim(), html: editor.innerHTML, tags: tags.value.split(',').map((t) => t.trim()).filter(Boolean) };
      save.disabled = true;
      try {
        if (note) await updateUserDoc(user.uid, 'notes', note.id, data);
        else await addUserDoc(user.uid, 'notes', data);
        toast('Saved', 'success'); close();
      } catch (err) { toast(err.message, 'error'); save.disabled = false; }
    });

    const foot = [el('button', { class: 'btn btn--ghost', onclick: close }, 'Cancel')];
    if (note) foot.push(el('button', { class: 'btn btn--danger', onclick: async () => { if (!confirm('Delete this note?')) return; try { await deleteUserDoc(user.uid, 'notes', note.id); close(); } catch (e) { toast(e.message, 'error'); } } }, [icon('trash'), ' Delete']));
    foot.push(save);

    body.append(el('div', { class: 'field-modal' }, [
      el('label', { class: 'form-label' }, 'Title'), title,
      el('label', { class: 'form-label' }, 'Note'),
      toolbar, editor,
      el('label', { class: 'form-label' }, 'Tags'), tags,
      el('div', { class: 'app-create-foot note-foot' }, foot),
    ]));
  }

  draw();
  return subscribeUserDocs(user.uid, 'notes', (list) => { notes = list; draw(); }, (err) => { clear(board); board.append(el('p', { class: 'error-text' }, err.message)); });
}
