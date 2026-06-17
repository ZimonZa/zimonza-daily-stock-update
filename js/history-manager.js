// ═══════════════════════════════════════════════════════════════
// ZIMONZA — History Manager
// ═══════════════════════════════════════════════════════════════

import { getAllUploadDates, getUploadHistory, getDailySummary } from './firestore-service.js';
import { formatDate, daysAgo } from './utils.js';

export async function loadHistoryCalendar(year, month) {
  const dates = await getAllUploadDates();
  const uploadedSet = new Set(dates);

  // Build calendar days for the given month
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const days = [];

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const today = formatDate(new Date());
    const isPast = dateStr <= today;
    days.push({
      date: dateStr,
      day: d,
      uploaded: uploadedSet.has(dateStr),
      missing: isPast && !uploadedSet.has(dateStr),
      future: dateStr > today,
      isToday: dateStr === today
    });
  }

  return { days, startWeekday: firstDay.getDay(), uploadedDates: dates };
}

export async function getDateDetail(date) {
  const [history, summary] = await Promise.all([
    getUploadHistory(date),
    getDailySummary(date)
  ]);
  return { history, summary };
}

export async function getMissingDates(days = 30) {
  const uploadedDates = await getAllUploadDates();
  const uploadedSet = new Set(uploadedDates);
  const missing = [];
  const today = formatDate(new Date());
  for (let i = 0; i < days; i++) {
    const d = daysAgo(i);
    if (d < today && !uploadedSet.has(d)) missing.push(d);
  }
  return missing;
}
