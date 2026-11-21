'use strict';
// Toutes les dates sont manipulées en chaînes 'YYYY-MM-DD' (heure locale du studio).

function pad(n) { return String(n).padStart(2, '0'); }

function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // midi : évite les soucis de changement d'heure
}

function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function weekday(s) { return parseISO(s).getDay(); } // 0 = dimanche

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toISO(parseISO(s)) === s;
}

function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// Date de Pâques (algorithme de Meeus/Jones/Butcher)
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Jours fériés en France métropolitaine
function frenchPublicHolidays(year) {
  const e = easter(year);
  return {
    [`${year}-01-01`]: "Jour de l'an",
    [addDays(e, 1)]: 'Lundi de Pâques',
    [`${year}-05-01`]: 'Fête du Travail',
    [`${year}-05-08`]: 'Victoire 1945',
    [addDays(e, 39)]: 'Ascension',
    [addDays(e, 50)]: 'Lundi de Pentecôte',
    [`${year}-07-14`]: 'Fête nationale',
    [`${year}-08-15`]: 'Assomption',
    [`${year}-11-01`]: 'Toussaint',
    [`${year}-11-11`]: 'Armistice 1918',
    [`${year}-12-25`]: 'Noël',
  };
}

function publicHolidayName(s) {
  return frenchPublicHolidays(Number(s.slice(0, 4)))[s] || null;
}

// Début de séance en objet Date (process.env.TZ = fuseau du studio)
function sessionStart(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0);
}

module.exports = {
  toISO, parseISO, addDays, weekday, isValidDate, isValidTime,
  easter, frenchPublicHolidays, publicHolidayName, sessionStart,
};
