// Where is ROMIO running? Used to keep the app Google Play compliant: Play
// requires digital purchases to go through Play Billing, so the native Android
// build must NOT show the Gumroad upgrade UI. People upgrade on the web; their
// Pro carries over. On the web everything shows as normal.
import { Capacitor } from '@capacitor/core';

export const isNativeApp = () => { try { return Capacitor?.isNativePlatform?.() === true; } catch { return false; } };
export const platformName = () => { try { return Capacitor?.getPlatform?.() || 'web'; } catch { return 'web'; } };

// The public site — shown (as plain text, not a checkout deep-link) where the
// native app would otherwise offer a purchase button.
export const WEB_APP_URL = 'https://romio.web.app';
