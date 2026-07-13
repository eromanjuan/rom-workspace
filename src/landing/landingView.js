// ROMIO marketing landing page (shown at "/" when signed out). Scrollytelling
// with lightweight CSS-3D objects. Performance: reveals via IntersectionObserver,
// parallax rAF-throttled and skipped for touch / reduced-motion. Returns a
// cleanup function that disconnects observers + listeners.
import './landing.css';
import { el, icon } from '../ui/dom.js';

const line = (w) => el('div', { class: `lp-mini-line ${w}` });
const icBox = (bg, txt) => el('div', { class: 'lp-mini-ic', style: `background:${bg}` }, txt);

function heroStage() {
  const cube = el('div', { class: 'lp-shape lp-shape--cube' },
    [0, 1, 2, 3, 4, 5].map(() => el('div', { class: 'lp-cube-face' })));
  // A mini ROMIO app mockup across three floating cards.
  const mainCard = el('div', { class: 'lp-card3d lp-card3d--main' }, [
    el('div', { class: 'lp-mini-row' }, [icBox('linear-gradient(135deg,#5b8cff,#8a5bff)', 'R'), line('w60')]),
    el('span', { class: 'lp-mini-chip' }, 'Feed'),
    el('div', { style: 'margin-top:14px; display:flex; flex-direction:column; gap:10px' }, [
      el('div', { class: 'lp-mini-row' }, [icBox('#21d0c3'), line('w80')]),
      line('w100'), line('w60'),
      el('div', { style: 'height:70px; border-radius:12px; margin-top:4px; background:linear-gradient(135deg,#5b8cff33,#8a5bff22); border:1px solid #232b3a' }),
      el('div', { class: 'lp-mini-row' }, [icBox('#ff5b9a'), line('w40')]),
    ]),
  ]);
  const sideCard = el('div', { class: 'lp-card3d lp-card3d--side' }, [
    el('span', { class: 'lp-mini-chip' }, 'Workspace'),
    el('div', { style: 'margin-top:12px; display:grid; grid-template-columns:1fr 1fr; gap:8px' },
      ['#5b8cff', '#8a5bff', '#21d0c3', '#ff5b9a'].map((c) =>
        el('div', { style: `height:38px; border-radius:10px; background:${c}` }))),
  ]);
  const chatCard = el('div', { class: 'lp-card3d lp-card3d--chat' }, [
    el('span', { class: 'lp-mini-chip' }, 'Messages'),
    el('div', { style: 'margin-top:12px' }, [
      el('div', { class: 'lp-bubble' }, 'Ship the new dashboard?'),
      el('div', { class: 'lp-bubble me' }, 'On it — live in ROMIO 🚀'),
    ]),
  ]);
  const scene = el('div', { class: 'lp-scene' }, [
    el('div', { class: 'lp-shape lp-shape--ring' }), mainCard, sideCard, chatCard, cube,
  ]);
  return el('div', { class: 'lp-stage' }, scene);
}

function tick() { return el('span', { class: 'tick' }, icon('check')); }

function feature({ rev, kicker, title, body, points, visual }) {
  const text = el('div', { class: 'lp-reveal' }, [
    el('div', { class: 'lp-kicker' }, kicker),
    el('h2', { class: 'lp-h2' }, title),
    el('p', { class: 'lp-p' }, body),
    el('ul', { class: 'lp-list' }, points.map((p) => el('li', {}, [tick(), p]))),
  ]);
  const vis = el('div', { class: 'lp-feature-visual lp-reveal d1' }, visual);
  return el('section', { class: 'lp-section' },
    el('div', { class: `lp-feature ${rev ? 'lp-feature--rev' : ''}` }, [text, vis]));
}

function panel(children) {
  return el('div', { class: 'lp-panel3d' }, [el('div', { class: 'lp-panel-glow' }), ...children]);
}

export function renderLanding(root, { onLogin, onSignup } = {}) {
  const go = (fn) => (e) => { if (e) e.preventDefault(); fn && fn(); };

  const nav = el('nav', { class: 'lp-nav' }, [
    el('div', { class: 'lp-brand' }, [el('img', { src: '/logo.svg', alt: '' }), 'ROMIO']),
    el('div', { class: 'lp-nav-actions' }, [
      el('button', { class: 'lp-btn lp-btn--ghost', onclick: go(onLogin) }, 'Log in'),
      el('button', { class: 'lp-btn lp-btn--primary', onclick: go(onSignup) }, 'Get started'),
    ]),
  ]);

  const hero = el('section', { class: 'lp-hero' }, [
    el('div', { class: 'lp-reveal is-in' }, [
      el('span', { class: 'lp-eyebrow' }, [el('span', { class: 'dot' }), 'All-in-one social workspace']),
      el('h1', { class: 'lp-h1' }, [
        'Your feed, your ', el('span', { class: 'grad' }, 'workspaces'), ', your apps.',
      ]),
      el('p', { class: 'lp-sub' }, 'ROMIO brings a social feed, team messaging, and a no-code app builder into one place — connect with people and run your work from a single, customizable command center.'),
      el('div', { class: 'lp-cta' }, [
        el('button', { class: 'lp-btn lp-btn--primary lp-btn--lg', onclick: go(onSignup) }, ['Create your account', icon('arrow-right')]),
        el('button', { class: 'lp-btn lp-btn--ghost lp-btn--lg', onclick: go(onLogin) }, 'I already have one'),
      ]),
      el('div', { class: 'lp-trust' }, [
        el('span', {}, [el('span', { class: 'dot' }), 'Free to start']),
        el('span', {}, [el('span', { class: 'dot' }), 'No code required']),
        el('span', {}, [el('span', { class: 'dot' }), 'Works on any device']),
      ]),
    ]),
    el('div', { class: 'lp-reveal is-in d1' }, heroStage()),
  ]);

  const feed = feature({
    kicker: 'Social feed', title: 'Post, react, and stay in the loop',
    body: 'Share text, images, video, files, links, questions and polls. Like, comment and @mention people — with a live feed that never makes you lose your place.',
    points: ['Rich posts & polls', '@mentions and notifications', 'Comment threads'],
    visual: panel([
      el('div', { class: 'lp-mini-row' }, [icBox('linear-gradient(135deg,#5b8cff,#8a5bff)', 'R'), line('w60')]),
      el('div', { style: 'display:flex; flex-direction:column; gap:12px; margin-top:6px' }, [
        line('w100'), line('w80'),
        el('div', { style: 'height:110px; border-radius:14px; background:linear-gradient(135deg,#5b8cff2e,#ff5b9a22); border:1px solid #232b3a; transform:translateZ(30px)' }),
        el('div', { style: 'display:flex; gap:10px' }, [el('span', { class: 'lp-mini-chip' }, '♥ 24'), el('span', { class: 'lp-mini-chip' }, '💬 8')]),
      ]),
    ]),
  });

  const chat = feature({
    rev: true, kicker: 'Messaging', title: 'Chat 1:1 or with the whole workspace',
    body: 'Direct messages and automatic group chats for every workspace, so conversations live right next to the work.',
    points: ['Direct & group chat', 'Auto workspace channels', 'Photos & files'],
    visual: panel([
      el('div', { style: 'display:flex; flex-direction:column; gap:2px' }, [
        el('div', { class: 'lp-bubble' }, 'Standup in 5?'),
        el('div', { class: 'lp-bubble me' }, 'Joining now'),
        el('div', { class: 'lp-bubble' }, 'Dropped the designs in the workspace'),
        el('div', { class: 'lp-bubble me' }, 'Looks 🔥 — shipping today'),
      ]),
    ]),
  });

  const apps = feature({
    kicker: 'No-code app builder', title: 'Build the tools your team needs',
    body: 'Spin up custom apps, dashboards and trackers inside a workspace — 24 field types, records, reports and automations. No developers required.',
    points: ['CRMs, trackers, logs & more', 'Dashboards, calendars & checklists', 'Roles, invites & permissions'],
    visual: panel([
      el('div', { class: 'lp-tiles' },
        [['#5b8cff', 'grid-dots'], ['#8a5bff', 'layout-dashboard'], ['#21d0c3', 'checklist'],
         ['#ff5b9a', 'chart-bar'], ['#f0b429', 'calendar'], ['#16a34a', 'apps']].map(([c, ic]) =>
          el('div', { class: 'lp-tile', style: `background:linear-gradient(135deg,${c},${c}bb)` }, icon(ic)))),
    ]),
  });

  const themes = feature({
    rev: true, kicker: 'Make it yours', title: 'Themes that follow you everywhere',
    body: 'Light or dark, a fully custom color palette, frosted-glass cards and your own backgrounds — saved to your account and synced across devices.',
    points: ['Custom palette & glass cards', 'Per-workspace themes', 'Synced across devices'],
    visual: panel([
      el('div', { style: 'display:flex; flex-direction:column; gap:12px' }, [
        line('w40'),
        el('div', { class: 'lp-swatches' }, ['#5b8cff', '#8a5bff', '#21d0c3', '#ff5b9a', '#f0b429'].map((c) =>
          el('div', { class: 'lp-sw', style: `background:${c}` }))),
        el('div', { style: 'height:80px; border-radius:14px; margin-top:4px; background:linear-gradient(135deg,#5b8cff44,#8a5bff33); border:1px solid #232b3a; backdrop-filter:blur(6px); transform:translateZ(30px)' }),
      ]),
    ]),
  });

  const stats = el('section', { class: 'lp-section' }, el('div', { class: 'lp-stats lp-reveal' }, [
    ['1', 'Command center'], ['24', 'App field types'], ['∞', 'Custom apps'], ['0', 'Lines of code'],
  ].map(([b, s]) => el('div', { class: 'lp-stat' }, [el('b', {}, b), el('span', {}, s)]))));

  const finalCta = el('section', { class: 'lp-final lp-reveal' }, [
    el('div', { class: 'lp-kicker' }, 'Ready when you are'),
    el('h2', { class: 'lp-h2' }, 'Bring your community and your work together.'),
    el('p', { class: 'lp-p', style: 'margin-left:auto;margin-right:auto' }, 'Create your free ROMIO account and start posting, chatting and building in minutes.'),
    el('div', { class: 'lp-cta' }, [
      el('button', { class: 'lp-btn lp-btn--primary lp-btn--lg', onclick: go(onSignup) }, ['Get started free', icon('arrow-right')]),
      el('button', { class: 'lp-btn lp-btn--ghost lp-btn--lg', onclick: go(onLogin) }, 'Log in'),
    ]),
  ]);

  const footer = el('footer', { class: 'lp-footer' }, [
    el('div', { class: 'lp-brand', style: 'font-size:16px' }, [el('img', { src: '/logo.svg', alt: '', style: 'width:22px;height:22px' }), 'ROMIO']),
    el('div', {}, `© ${2026} ROMIO — your all-in-one social workspace.`),
  ]);

  const page = el('div', { class: 'lp' }, [
    el('div', { class: 'lp-ambient' }, [
      el('div', { class: 'lp-orb lp-orb--1' }), el('div', { class: 'lp-orb lp-orb--2' }), el('div', { class: 'lp-orb lp-orb--3' }),
    ]),
    el('div', { class: 'lp-grid' }),
    el('div', { class: 'lp-main' }, [nav, hero, feed, chat, apps, themes, stats, finalCta, footer]),
  ]);
  root.append(page);

  // --- scroll reveals ---
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });
  page.querySelectorAll('.lp-reveal:not(.is-in)').forEach((n) => io.observe(n));

  // --- pointer parallax on the hero 3D scene (rAF-throttled, pointer devices only) ---
  const scene = page.querySelector('.lp-scene');
  const orbs = page.querySelectorAll('.lp-orb');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches;
  let raf = 0, tx = -16, ty = 8;
  const onMove = (ev) => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const cx = (ev.clientX / window.innerWidth - 0.5);
      const cy = (ev.clientY / window.innerHeight - 0.5);
      tx = -16 - cx * 14; ty = 8 - cy * 12;
      if (scene) scene.style.setProperty('--rx', `${tx}deg`);
      if (scene) scene.style.setProperty('--ry', `${ty}deg`);
    });
  };
  let sraf = 0;
  const onScroll = () => {
    if (sraf) return;
    sraf = requestAnimationFrame(() => {
      sraf = 0;
      const y = window.scrollY;
      orbs.forEach((o, i) => { o.style.transform = `translate3d(0, ${y * (0.04 + i * 0.03)}px, 0)`; });
    });
  };
  if (scene && fine && !reduce) window.addEventListener('pointermove', onMove, { passive: true });
  if (!reduce) window.addEventListener('scroll', onScroll, { passive: true });

  return () => {
    io.disconnect();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('scroll', onScroll);
    if (raf) cancelAnimationFrame(raf);
    if (sraf) cancelAnimationFrame(sraf);
  };
}
