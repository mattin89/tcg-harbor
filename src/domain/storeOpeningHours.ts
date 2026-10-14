export interface StoreOpeningHourEntry {
  readonly label: string;
  readonly hours: string;
}

const STANDARD_DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const DAY_LABELS: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

function normalizeDayKey(rawKey: string): string {
  return rawKey.trim().toLowerCase();
}

function normalizeHoursValue(val: unknown): string {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : 'Closed';
  }
  if (Array.isArray(val) && val.length > 0) {
    return val.filter(Boolean).join(' - ');
  }
  return 'Closed';
}

/**
 * Formats a structured openingHours record into a display schedule,
 * grouping consecutive days with identical hours.
 */
export function formatStoreOpeningSchedule(
  openingHours?: Record<string, unknown> | null,
): StoreOpeningHourEntry[] {
  if (!openingHours || typeof openingHours !== 'object') {
    return [];
  }

  const normalizedMap = new Map<string, string>();
  for (const [k, v] of Object.entries(openingHours)) {
    normalizedMap.set(normalizeDayKey(k), normalizeHoursValue(v));
  }

  const standardPresent = STANDARD_DAY_KEYS.filter((day) => normalizedMap.has(day));

  if (standardPresent.length > 0) {
    const entries: StoreOpeningHourEntry[] = [];
    let groupStart: string | null = null;
    let groupEnd: string | null = null;
    let groupHours: string | null = null;

    const commitGroup = () => {
      if (!groupStart || !groupHours) return;
      const label = groupStart === groupEnd
        ? (DAY_LABELS[groupStart] ?? groupStart)
        : `${DAY_LABELS[groupStart] ?? groupStart}–${DAY_LABELS[groupEnd!] ?? groupEnd!}`;
      entries.push({ label, hours: groupHours });
    };

    for (const day of STANDARD_DAY_KEYS) {
      if (!normalizedMap.has(day)) continue;
      const hours = normalizedMap.get(day)!;

      if (groupHours === hours) {
        groupEnd = day;
      } else {
        commitGroup();
        groupStart = day;
        groupEnd = day;
        groupHours = hours;
      }
    }
    commitGroup();

    for (const [k, v] of normalizedMap.entries()) {
      if (!STANDARD_DAY_KEYS.includes(k as typeof STANDARD_DAY_KEYS[number])) {
        const capitalized = k.charAt(0).toUpperCase() + k.slice(1);
        entries.push({ label: capitalized, hours: v });
      }
    }

    return entries;
  }

  const entries: StoreOpeningHourEntry[] = [];
  for (const [k, v] of normalizedMap.entries()) {
    const capitalized = k.charAt(0).toUpperCase() + k.slice(1);
    entries.push({ label: capitalized, hours: v });
  }
  return entries;
}

/**
 * Returns a single-line summary of store opening hours.
 */
export function formatStoreOpeningHoursSummary(
  openingHours?: Record<string, unknown> | null,
  fallback = 'Hours not provided',
): string {
  const schedule = formatStoreOpeningSchedule(openingHours);
  if (schedule.length === 0) return fallback;
  return schedule.map((e) => `${e.label} ${e.hours}`).join(' · ');
}
