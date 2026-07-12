// Firebase initialization. Reads the public web config from Vite env vars (see .env.example).
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

// The Firebase WEB config is a set of public identifiers (safe to ship in the
// browser bundle — access is enforced by Firestore/Storage rules). Env vars
// (from .env.local or the host) take precedence; otherwise we fall back to the
// ROM project's config so the app works on any deploy without extra setup.
// These fallback values match the ones hardcoded in the embedded module bridge.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyDgJai9t4UxicjzaIyHdc-hk5pTyAVF0bI',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'rom-database-0909.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'rom-database-0909',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'rom-database-0909.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '192979949981',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:192979949981:web:162d2e67ffe5cb4a8e3774',
};

export const configReady = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

const app = configReady ? initializeApp(firebaseConfig) : null;

export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
