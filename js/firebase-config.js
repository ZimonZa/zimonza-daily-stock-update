// ═══════════════════════════════════════════════════════════════
// ZIMONZA DAILY STOCK UPDATE — Firebase Configuration
// Replace the placeholder values below with your actual Firebase
// project credentials from: Firebase Console → Project Settings
// ═══════════════════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

// ⚙️ Firebase project: zimonza-sm (default)
let firebaseConfig = {
  apiKey: "AIzaSyCJyvLDCvhFyn-BORxi8VVEpETU5QPmXJE",
  authDomain: "zimonza-stock-mgmt.firebaseapp.com",
  projectId: "zimonza-stock-mgmt",
  storageBucket: "zimonza-stock-mgmt.firebasestorage.app",
  messagingSenderId: "915038749927",
  appId: "1:915038749927:web:125cdf451bf8c177364e42"
};

// Allow overriding config via Settings page (stored in localStorage)
try {
  const override = JSON.parse(localStorage.getItem('zm_firebase_config'));
  if (override && override.projectId) {
    firebaseConfig = { ...firebaseConfig, ...override };
  }
} catch {}

const app = initializeApp(firebaseConfig);

// Firebase v10 modern offline persistence — multi-tab aware
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

export const auth = getAuth(app);
export const storage = getStorage(app);

export default app;
