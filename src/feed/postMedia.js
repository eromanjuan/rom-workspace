// Renders the type-specific content of a feed post: image galleries, embedded
// video, file attachments, link cards, question badges and interactive polls.
import { updateDoc } from 'firebase/firestore';
import { el, icon, toast } from '../ui/dom.js';

function videoEmbed(url) {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { type: 'iframe', src: `https://www.youtube.com/embed/${yt[1]}` };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { type: 'iframe', src: `https://player.vimeo.com/video/${vm[1]}` };
  if (/\.(mp4|webm|ogg)(\?|#|$)/i.test(url)) return { type: 'video', src: url };
  return { type: 'link', src: url };
}
const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

// Returns an element with the post's media/link/poll/file, or null for plain text.
export function renderPostExtras(p, ref, user) {
  const type = p.type || 'post';

  if (Array.isArray(p.images) && p.images.length) {
    return el('div', { class: `post-images n-${Math.min(p.images.length, 4)}` },
      p.images.map((src) => {
        const im = el('img', { class: 'post-image', src, alt: '', loading: 'lazy' });
        im.addEventListener('click', () => openLightbox(src));
        return im;
      }));
  }

  if (p.media && p.media.kind === 'video' && p.media.url) {
    const e = videoEmbed(p.media.url);
    if (e.type === 'iframe') return el('div', { class: 'post-video' }, el('iframe', { src: e.src, allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture', allowfullscreen: 'true', frameborder: '0' }));
    if (e.type === 'video') return el('div', { class: 'post-video' }, el('video', { src: e.src, controls: 'true', preload: 'metadata' }));
    return linkCard(p.media.url, '');
  }

  if (p.file && p.file.dataURL) {
    const kb = Math.round((p.file.size || 0) / 1024);
    const a = el('a', { class: 'post-file', href: p.file.dataURL, download: p.file.name || 'file' }, [
      el('span', { class: 'post-file-ic' }, icon('file')),
      el('span', { class: 'post-file-meta' }, [
        el('span', { class: 'post-file-name' }, p.file.name || 'Attachment'),
        el('span', { class: 'post-file-size muted' }, `${kb} KB · click to download`),
      ]),
      el('span', { class: 'post-file-dl' }, icon('download')),
    ]);
    return a;
  }

  if (p.link && p.link.url) return linkCard(p.link.url, p.link.title);

  if (type === 'poll' && p.poll && Array.isArray(p.poll.options)) return renderPoll(p, ref, user);

  return null;
}

function linkCard(url, title) {
  const card = el('a', { class: 'post-linkcard', href: url, target: '_blank', rel: 'noopener noreferrer' }, [
    el('span', { class: 'post-linkcard-ic' }, icon('link')),
    el('span', { class: 'post-linkcard-meta' }, [
      el('span', { class: 'post-linkcard-title' }, title || url),
      el('span', { class: 'post-linkcard-host muted' }, hostOf(url)),
    ]),
  ]);
  return card;
}

function renderPoll(p, ref, user) {
  const votes = Array.isArray(p.pollVotes) ? p.pollVotes : [];
  const myVote = votes.find((v) => v.uid === user.uid);
  const total = votes.length;
  const box = el('div', { class: 'post-poll' });
  p.poll.options.forEach((opt) => {
    const count = votes.filter((v) => v.optionId === opt.id).length;
    const pct = total ? Math.round((count / total) * 100) : 0;
    const chosen = myVote && myVote.optionId === opt.id;
    const row = el('button', { class: `poll-opt ${chosen ? 'is-chosen' : ''}`, type: 'button' }, [
      el('span', { class: 'poll-opt-fill', style: `width:${pct}%` }),
      el('span', { class: 'poll-opt-label' }, [chosen ? icon('circle-check') : null, opt.text]),
      el('span', { class: 'poll-opt-pct' }, total ? `${pct}%` : ''),
    ]);
    row.addEventListener('click', async () => {
      const next = votes.filter((v) => v.uid !== user.uid);
      if (!myVote || myVote.optionId !== opt.id) next.push({ uid: user.uid, optionId: opt.id });
      try { await updateDoc(ref, { pollVotes: next }); }
      catch (err) { toast(err.message || 'Could not vote.', 'error'); }
    });
    box.append(row);
  });
  box.append(el('div', { class: 'poll-total muted' }, `${total} vote${total === 1 ? '' : 's'}`));
  return box;
}

// Simple full-screen image viewer.
function openLightbox(src) {
  const overlay = el('div', { class: 'lightbox' }, el('img', { src, alt: '' }));
  overlay.addEventListener('click', () => overlay.remove());
  document.body.append(overlay);
}
