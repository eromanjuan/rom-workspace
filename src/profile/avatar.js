// Avatar display + a self-contained image editor (zoom / pan / rotate / flip /
// crop) that exports a square JPEG data URL. Since Firebase Storage isn't
// enabled, the cropped photo is stored inline on users/{uid}.photoURL (a 400px
// JPEG is ~30-50 KB, well within Firestore's 1 MB document limit).
import { el, clear, icon, toast } from '../ui/dom.js';
import { updateUserProfile } from '../workspaces/data.js';

export function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
}

// A fresh avatar element (photo if set, else initials).
export function avatarNode(name, photoURL, cls = 'profile-avatar') {
  if (photoURL) return el('div', { class: `${cls} has-photo` }, el('img', { src: photoURL, alt: name || '' }));
  return el('div', { class: cls }, initials(name));
}

// Update an existing avatar element in place.
export function applyAvatar(node, name, photoURL) {
  if (!node) return;
  clear(node);
  if (photoURL) { node.classList.add('has-photo'); node.append(el('img', { src: photoURL, alt: name || '' })); }
  else { node.classList.remove('has-photo'); node.textContent = initials(name); }
}

// Open the crop/zoom/rotate/flip editor. Calls onSave(dataURL) with a square
// JPEG. `source` is a File or an image URL/data URL.
export function openAvatarEditor(source, { onSave, output = 400 } = {}) {
  const stage = 320;
  const canvas = el('canvas', { class: 'avatar-canvas', width: String(stage), height: String(stage) });
  const st = { img: null, scale: 1, baseScale: 1, tx: 0, ty: 0, angle: 0, flipH: false, flipV: false };

  const render = (ctx, size, k) => {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0b0e13';
    ctx.fillRect(0, 0, size, size);
    if (!st.img) return;
    ctx.save();
    ctx.translate(size / 2 + st.tx * k, size / 2 + st.ty * k);
    ctx.rotate(st.angle);
    ctx.scale((st.flipH ? -1 : 1) * st.scale * k, (st.flipV ? -1 : 1) * st.scale * k);
    ctx.drawImage(st.img, -st.img.naturalWidth / 2, -st.img.naturalHeight / 2);
    ctx.restore();
  };
  const draw = () => render(canvas.getContext('2d'), stage, 1);

  const zoom = el('input', { type: 'range', class: 'avatar-zoom' });
  zoom.addEventListener('input', () => { st.scale = Number(zoom.value); draw(); });

  const img = new Image();
  img.onload = () => {
    st.img = img;
    st.baseScale = Math.max(stage / img.naturalWidth, stage / img.naturalHeight);
    st.scale = st.baseScale;
    zoom.min = String(st.baseScale);
    zoom.max = String(st.baseScale * 5);
    zoom.step = String(st.baseScale / 100);
    zoom.value = String(st.scale);
    draw();
  };
  img.onerror = () => toast('Could not load that image.', 'error');
  if (typeof source === 'string') img.src = source;
  else { const r = new FileReader(); r.onload = () => { img.src = r.result; }; r.readAsDataURL(source); }

  // Pan by dragging.
  let dragging = false; let lx = 0; let ly = 0;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
  canvas.addEventListener('pointermove', (e) => { if (!dragging) return; st.tx += e.clientX - lx; st.ty += e.clientY - ly; lx = e.clientX; ly = e.clientY; draw(); });
  const endDrag = (e) => { dragging = false; try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.06 : 0.94;
    st.scale = Math.min(st.baseScale * 8, Math.max(st.baseScale * 0.5, st.scale * f));
    zoom.value = String(st.scale); draw();
  }, { passive: false });

  const tool = (ic, title, fn) => {
    const b = el('button', { class: 'avatar-tool', title, type: 'button', 'aria-label': title }, icon(ic));
    b.addEventListener('click', fn);
    return b;
  };
  const tools = el('div', { class: 'avatar-tools' }, [
    tool('rotate-2', 'Rotate left', () => { st.angle -= Math.PI / 2; draw(); }),
    tool('rotate-clockwise-2', 'Rotate right', () => { st.angle += Math.PI / 2; draw(); }),
    tool('flip-horizontal', 'Flip horizontal', () => { st.flipH = !st.flipH; draw(); }),
    tool('flip-vertical', 'Flip vertical', () => { st.flipV = !st.flipV; draw(); }),
    tool('refresh', 'Reset', () => { st.scale = st.baseScale; st.tx = 0; st.ty = 0; st.angle = 0; st.flipH = false; st.flipV = false; zoom.value = String(st.scale); draw(); }),
  ]);

  const overlay = el('div', { class: 'avatar-editor-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);

  const cancelBtn = el('button', { class: 'btn btn--ghost', type: 'button' }, 'Cancel');
  cancelBtn.addEventListener('click', close);
  const saveBtn = el('button', { class: 'btn btn--primary', type: 'button' }, 'Save photo');
  saveBtn.addEventListener('click', () => {
    if (!st.img) return;
    const out = document.createElement('canvas');
    out.width = output; out.height = output;
    render(out.getContext('2d'), output, output / stage);
    const dataURL = out.toDataURL('image/jpeg', 0.85);
    close();
    if (onSave) onSave(dataURL);
  });

  overlay.append(el('div', { class: 'avatar-editor-card' }, [
    el('div', { class: 'avatar-editor-title' }, 'Edit photo'),
    el('div', { class: 'avatar-stage' }, [canvas, el('div', { class: 'avatar-crop-ring' })]),
    el('div', { class: 'avatar-zoom-row' }, [icon('zoom-out'), zoom, icon('zoom-in')]),
    tools,
    el('div', { class: 'avatar-editor-actions' }, [cancelBtn, saveBtn]),
  ]));
  document.body.append(overlay);
}

// Persist a cropped photo to Firestore and broadcast rom-avatar-changed so the
// shell (topbar/sidebar) updates live. onSaved(dataURL) updates local UI.
export async function commitAvatar(user, dataURL, onSaved) {
  try {
    await updateUserProfile(user.uid, { photoURL: dataURL });
    window.dispatchEvent(new CustomEvent('rom-avatar-changed', { detail: { photoURL: dataURL } }));
    if (onSaved) onSaved(dataURL);
    toast('Profile photo updated', 'success');
  } catch (e) { toast(e.message || 'Could not save photo', 'error'); }
}

// Open a file picker → editor → save to Firestore. onSaved(dataURL) for local UI.
export function pickAndEditAvatar(user, onSaved) {
  const input = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  document.body.append(input);
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.remove();
    if (!f) return;
    openAvatarEditor(f, { onSave: (dataURL) => commitAvatar(user, dataURL, onSaved) });
  });
  input.click();
}

// Clear the saved photo (revert to initials).
export async function removeAvatar(user, onRemoved) {
  try {
    await updateUserProfile(user.uid, { photoURL: '' });
    window.dispatchEvent(new CustomEvent('rom-avatar-changed', { detail: { photoURL: '' } }));
    if (onRemoved) onRemoved();
    toast('Profile photo removed', 'info');
  } catch (e) { toast(e.message || 'Could not remove photo', 'error'); }
}
