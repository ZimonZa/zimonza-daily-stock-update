// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Authentication Module
// ═══════════════════════════════════════════════════════════════

import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

/** Require auth — redirect to login if not signed in */
export function requireAuth(callback) {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (!user) {
        window.location.replace('login.html');
        return;
      }
      if (callback) callback(user);
      resolve(user);
    });
  });
}

/** Redirect away from login if already signed in */
export function redirectIfAuth(redirectTo = 'dashboard.html') {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (user) {
        window.location.replace(redirectTo);
      }
      resolve(user);
    });
  });
}

/** Sign in with email/password */
export async function signIn(email, password) {
  await setPersistence(auth, browserLocalPersistence);
  return signInWithEmailAndPassword(auth, email, password);
}

/** Sign out */
export async function logOut() {
  await signOut(auth);
  window.location.replace('login.html');
}

/** Send password reset email */
export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

/** Get current user synchronously (may be null before onAuthStateChanged fires) */
export function currentUser() {
  return auth.currentUser;
}

/** Subscribe to auth state changes */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}
