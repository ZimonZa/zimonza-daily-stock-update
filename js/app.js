// ═══════════════════════════════════════════════════════════════
// ZIMONZA — Application Entry Point
// ═══════════════════════════════════════════════════════════════
import { storage } from './utils.js';

// Apply theme immediately to avoid flash
const theme = storage.get('theme', 'dark');
document.documentElement.classList.toggle('dark', theme === 'dark');
document.documentElement.classList.toggle('light-mode', theme === 'light');
