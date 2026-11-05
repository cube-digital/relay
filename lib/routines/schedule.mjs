// Routine schedules: days (mon…sun) and a local time HH:MM. Validation, ISO weeks,
// the next run, this week's slots, and the Codex RRULE and Claude cron forms.

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const WEEKDAYS = DAYS.slice(0, 5);
export const DEFAULT_SCHEDULE = { days: WEEKDAYS, at: '09:00' };
const AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const RRULE_DAY = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU' };
const CRON_DAY = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };

export function scheduleProblems(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return ['schedule must be an object with days and at'];
  const problems = [];
  for (const k of Object.keys(s)) if (k !== 'days' && k !== 'at') problems.push(`schedule: unknown key "${k}"`);
  if (!Array.isArray(s.days) || !s.days.length) problems.push('schedule.days must be a non-empty list of mon…sun');
  else {
    for (const d of s.days) if (!DAYS.includes(d)) problems.push(`schedule.days: "${d}" is not one of ${DAYS.join(', ')}`);
    if (new Set(s.days).size !== s.days.length) problems.push('schedule.days has a day twice');
  }
  if (typeof s.at !== 'string' || !AT_RE.test(s.at)) problems.push(`schedule.at "${s.at}" is not a time HH:MM (00:00-23:59)`);
  return problems;
}

// "mon,wed,fri" → ['mon', 'wed', 'fri'] in week order; a usage error (code 64) otherwise.
export function parseDays(text) {
  const days = String(text ?? '').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (!days.length || days.some((d) => !DAYS.includes(d))) throw Object.assign(new Error(`--days takes a comma list of ${DAYS.join(',')}`), { code: 64, status: 400 });
  return DAYS.filter((d) => days.includes(d));
}

const hm = (at) => {
  const m = AT_RE.exec(at);
  return [Number(m[1]), Number(m[2])];
};
const dayKey = (date) => DAYS[(date.getDay() + 6) % 7];
const ordered = (days) => DAYS.filter((d) => days.includes(d));

// Monday 00:00 local of the week holding `now`.
export function weekStart(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// ISO 8601 week of the local date: "2026-W43".
export function isoWeek(now = new Date()) {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Local YYYY-MM-DD.
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// Every scheduled time in the week holding `now`, Monday first.
export function weekSlots(schedule, now = new Date()) {
  const [hh, mm] = hm(schedule.at);
  const start = weekStart(now);
  return DAYS.map((d, i) => [d, i])
    .filter(([d]) => schedule.days.includes(d))
    .map(([, i]) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, hh, mm));
}

// The first scheduled time strictly after `now`.
export function nextRun(schedule, now = new Date()) {
  const [hh, mm] = hm(schedule.at);
  for (let i = 0; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, hh, mm);
    if (d > now && schedule.days.includes(dayKey(d))) return d;
  }
  return null;
}

export function rruleFor(schedule) {
  const [hh, mm] = hm(schedule.at);
  return `RRULE:FREQ=WEEKLY;BYHOUR=${hh};BYMINUTE=${mm};BYDAY=${ordered(schedule.days).map((d) => RRULE_DAY[d]).join(',')}`;
}

// Five fields, local time: "0 9 * * 1,2,3,4,5"; every day is "*".
export function cronFor(schedule) {
  const [hh, mm] = hm(schedule.at);
  const days = ordered(schedule.days);
  return `${mm} ${hh} * * ${days.length === 7 ? '*' : days.map((d) => CRON_DAY[d]).join(',')}`;
}

export function describeSchedule(schedule) {
  const days = ordered(schedule.days);
  const label = days.length === 7 ? 'daily' : days.join(',') === WEEKDAYS.join(',') ? 'mon-fri' : days.join(',');
  return `${label} ${schedule.at}`;
}
