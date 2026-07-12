// Lists the workspaces the user belongs to and lets them create new ones.
import { el, clear, toast } from '../ui/dom.js';
import { roleLabel } from './roles.js';
import { createWorkspace, listMyWorkspaces } from './data.js';

export async function renderWorkspaces(root, user, onOpen) {
  clear(root);

  const nameInput = el('input', { class: 'input', placeholder: 'New workspace name' });
  const createBtn = el('button', { class: 'btn btn--primary' }, 'Create workspace');
  const grid = el('div', { class: 'ws-grid' }, el('p', { class: 'muted' }, 'Loading…'));

  createBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    createBtn.disabled = true;
    try {
      const id = await createWorkspace(user, name);
      nameInput.value = '';
      toast('Workspace created', 'success');
      onOpen(id);
    } catch (err) {
      toast(err.message || 'Could not create workspace.', 'error');
    } finally {
      createBtn.disabled = false;
    }
  });

  root.append(
    el('div', { class: 'workspaces' }, [
      el('h2', { class: 'section__title' }, 'Workspaces'),
      el('div', { class: 'ws-create card' }, [nameInput, createBtn]),
      grid,
    ]),
  );

  try {
    const spaces = await listMyWorkspaces(user.uid);
    clear(grid);
    if (!spaces.length) {
      grid.append(el('p', { class: 'muted' }, 'No workspaces yet. Create one above to get started.'));
      return;
    }
    for (const ws of spaces) {
      grid.append(
        el('button', {
          class: 'ws-card card', onclick: () => onOpen(ws.id),
        }, [
          el('div', { class: 'ws-card__name' }, ws.name),
          el('div', { class: 'ws-card__meta muted' }, `Your role: ${roleLabel(ws.myRole)}`),
        ]),
      );
    }
  } catch (err) {
    clear(grid);
    grid.append(el('p', { class: 'error-text' }, `Could not load workspaces: ${err.message}`));
  }
}
