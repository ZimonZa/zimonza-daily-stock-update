// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Firebase Storage Service
// ═══════════════════════════════════════════════════════════════
import { storage } from './firebase-config.js';
import {
  ref, uploadBytes, getDownloadURL, deleteObject, listAll
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

/** Upload a file blob to Firebase Storage */
export async function uploadFile(path, file) {
  const storageRef = ref(storage, path);
  const snap = await uploadBytes(storageRef, file);
  return getDownloadURL(snap.ref);
}

/** Get download URL for a path */
export async function getFileURL(path) {
  const storageRef = ref(storage, path);
  return getDownloadURL(storageRef);
}

/** Delete a file */
export async function deleteFile(path) {
  const storageRef = ref(storage, path);
  return deleteObject(storageRef);
}

/** List files in a directory */
export async function listFiles(prefix) {
  const storageRef = ref(storage, prefix);
  const res = await listAll(storageRef);
  return res.items.map(item => ({ name: item.name, fullPath: item.fullPath }));
}
