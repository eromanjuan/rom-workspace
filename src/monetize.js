// Monetization hub. Fill in the values below to switch each stream ON — nothing
// shows to users until it's configured, so this is safe to ship empty.
//
//  • supportUrl    – a hosted tip/donation link (Ko-fi, PayPal.me, Stripe Payment
//                    Link, Lemon Squeezy). Shows a "Support ROMIO" button.
//  • proCheckoutUrl– a hosted checkout link for "ROMIO Pro" (Lemon Squeezy /
//                    Stripe Payment Link). Shows the "Upgrade to Pro" button.
//  • adsenseClient – your AdSense publisher id, e.g. "ca-pub-1234567890123456".
//                    Ads then render for non-Pro users. (Needs AdSense approval.)
//
// How Pro unlocks (no backend needed to start): a user pays via proCheckoutUrl,
// then you (a master) flip them to Pro in Settings → Control panel. Later, a
// Stripe/Lemon Squeezy webhook + Cloud Function can automate that.
import { el, icon, openModal } from './ui/dom.js';
import { isNativeApp, WEB_APP_URL } from './platform.js';

export const MONETIZE = {
  // Which checkout provider proCheckoutUrl / supportUrl point at. This only
  // controls how the buyer's email + uid are prefilled onto the link:
  //   'lemonsqueezy' | 'stripe' | 'gumroad' | 'kofi' | 'paypal' | 'generic'
  provider: 'gumroad',
  supportUrl: '',        // a tip/donation link (add a "pay what you want" Gumroad product if you want tips)
  proCheckoutUrl: 'https://eugenio88.gumroad.com/l/parnex',   // "Romio pro" on Gumroad
  proPriceLabel: '',     // e.g. '$5 / month' — shown on the button; leave blank to hide the price
  adsenseClient: '',     // e.g. 'ca-pub-1234567890123456'
  adsenseSlot: '',       // optional ad-unit slot id
};

// Build the checkout URL for a user, prefilling email + attaching the ROMIO uid
// so payments are traceable and a webhook can auto-match the buyer. The query
// params differ per provider.
export function proCheckoutUrlFor(user) {
  const base = MONETIZE.proCheckoutUrl;
  if (!base || !user) return base;
  try {
    const u = new URL(base);
    const set = (k, v) => { if (v) u.searchParams.set(k, v); };
    switch (MONETIZE.provider) {
      case 'lemonsqueezy':
        set('checkout[email]', user.email); set('checkout[custom][uid]', user.uid); set('checkout[name]', user.displayName);
        break;
      case 'stripe': // Stripe Payment Links
        set('prefilled_email', user.email); set('client_reference_id', user.uid);
        break;
      case 'gumroad':
        set('email', user.email); set('uid', user.uid);
        break;
      default: // kofi / paypal / generic — no reliable prefill, use the link as-is
        break;
    }
    return u.toString();
  } catch { return base; }
}

// The perks a Pro subscription unlocks (shown on the upgrade page).
export const PRO_PERKS = [
  ['ad_off', 'Ad-free', 'No ads anywhere in ROMIO.'],
  ['badge', 'Pro badge', 'A Pro badge on your profile.'],
  ['support', 'Support ROMIO', 'Keep the app running and growing.'],
  ['priority', 'Early features', 'First access to new features.'],
];

// Whether a loaded profile is Pro (a flag set by an admin or, later, a webhook).
export function isPro(profile) {
  if (!profile) return false;
  if (profile.pro === true) return true;
  const until = profile.proUntil;
  if (until && typeof until.toMillis === 'function') return until.toMillis() > Date.now();
  return false;
}

// The signed-in viewer (set from main.js) — drives every Pro gate below.
const viewer = { user: null, pro: false };
export function setViewer(user, pro) { viewer.user = user || null; viewer.pro = !!pro; }
// Back-compat: older call sites just set the boolean.
export function setViewerPro(v) { viewer.pro = !!v; }
// Is the signed-in viewer Pro? (master accounts are always Pro — set in main.js)
export function viewerIsPro() { return viewer.pro; }

// The plan matrix, for the Free-vs-Pro comparison shown on the upgrade page.
export const PLAN_MATRIX = [
  ['Workspaces', 'Just 1', 'Unlimited'],
  ['Avatar frame', 'Default blue only', 'All presets + custom color, gradient & thickness'],
  ['Profile theme', 'Colors & presets', 'Fully custom — incl. photo background'],
  ['Chat encryption', '—', 'End-to-end encrypted messages'],
  ['Ads', 'Shown', 'Ad-free'],
  ['Pro badge', '—', 'On your profile'],
];

// Gate a Pro-only feature. Returns true if the viewer may use it; otherwise it
// pops an upgrade modal and returns false. Use as: if (!proGate('Chat encryption')) return;
export function proGate(feature) {
  if (viewer.pro) return true;
  try {
    const { body, close } = openModal({ title: 'A ROMIO Pro feature', iconName: 'crown', wide: true });
    const rows = PLAN_MATRIX.map(([label, free, pro]) => el('div', { class: 'pro-gate-row' }, [
      el('span', { class: 'pro-gate-feat' }, label),
      el('span', { class: 'pro-gate-free muted' }, free),
      el('span', { class: 'pro-gate-pro' }, pro),
    ]));
    const upgradeUrl = proCheckoutUrlFor(viewer.user) || MONETIZE.proCheckoutUrl;
    // On the native Android app, Play Billing policy means no external checkout
    // button — point to the web instead (plain text, not a purchase link).
    const upgradeCta = isNativeApp()
      ? el('span', { class: 'muted' }, `Upgrade at ${WEB_APP_URL}`)
      : (upgradeUrl
        ? el('a', { class: 'btn btn--primary', href: upgradeUrl, target: '_blank', rel: 'noopener', onclick: close }, [icon('crown'), ' Upgrade to Pro'])
        : el('span', { class: 'muted' }, 'Upgrade coming soon'));
    const actions = el('div', { class: 'pro-gate-actions' }, [
      el('button', { class: 'btn btn--ghost', type: 'button', onclick: close }, 'Maybe later'),
      upgradeCta,
    ]);
    body.append(
      el('p', { class: 'pro-gate-lead' }, [el('b', {}, feature), ' is part of ', el('b', {}, 'ROMIO Pro'), '.']),
      el('div', { class: 'pro-gate-grid' }, [
        el('div', { class: 'pro-gate-row pro-gate-head' }, [el('span', {}, ''), el('span', { class: 'muted' }, 'Free'), el('span', {}, 'Pro')]),
        ...rows,
      ]),
      actions,
    );
  } catch { /* modal unavailable — fail closed silently */ }
  return false;
}

// Which avatar frames a Free user may use (everything else is Pro-gated).
export const FREE_FRAMES = ['', 'none', 'blue'];

// --- ads (Google AdSense) ---
let adsLoaded = false;
function ensureAdsenseLoaded() {
  if (adsLoaded || !MONETIZE.adsenseClient) return;
  adsLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${MONETIZE.adsenseClient}`;
  s.crossOrigin = 'anonymous';
  s.onerror = () => { /* ad blocker or offline — ignore */ };
  document.head.appendChild(s);
}

// An ad unit, or null when ads are off (not configured, or the viewer is Pro).
export function adSlotNode() {
  if (!MONETIZE.adsenseClient || viewer.pro) return null;
  ensureAdsenseLoaded();
  const ins = el('ins', {
    class: 'adsbygoogle', style: 'display:block',
    'data-ad-client': MONETIZE.adsenseClient,
    ...(MONETIZE.adsenseSlot ? { 'data-ad-slot': MONETIZE.adsenseSlot } : {}),
    'data-ad-format': 'auto', 'data-full-width-responsive': 'true',
  });
  const wrap = el('div', { class: 'ad-slot' }, [el('span', { class: 'ad-slot-label muted' }, 'Advertisement'), ins]);
  setTimeout(() => { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* ignore */ } }, 0);
  return wrap;
}
