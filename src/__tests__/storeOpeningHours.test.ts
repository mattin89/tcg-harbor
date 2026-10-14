import { describe, expect, it } from 'vitest';
import {
  formatStoreOpeningSchedule,
  formatStoreOpeningHoursSummary,
} from '../domain/storeOpeningHours';

describe('formatStoreOpeningSchedule', () => {
  it('returns empty array when openingHours is empty or null', () => {
    expect(formatStoreOpeningSchedule(null)).toEqual([]);
    expect(formatStoreOpeningSchedule(undefined)).toEqual([]);
    expect(formatStoreOpeningSchedule({})).toEqual([]);
  });

  it('groups consecutive days with identical hours', () => {
    const hours = {
      monday: '10:00 - 19:00',
      tuesday: '10:00 - 19:00',
      wednesday: '10:00 - 19:00',
      thursday: '10:00 - 19:00',
      friday: '10:00 - 20:00',
      saturday: '10:00 - 18:00',
      sunday: 'Closed',
    };

    const schedule = formatStoreOpeningSchedule(hours);
    expect(schedule).toEqual([
      { label: 'Monday–Thursday', hours: '10:00 - 19:00' },
      { label: 'Friday', hours: '10:00 - 20:00' },
      { label: 'Saturday', hours: '10:00 - 18:00' },
      { label: 'Sunday', hours: 'Closed' },
    ]);
  });

  it('groups all seven days if hours are identical every day', () => {
    const hours = {
      monday: '12:00 - 20:00',
      tuesday: '12:00 - 20:00',
      wednesday: '12:00 - 20:00',
      thursday: '12:00 - 20:00',
      friday: '12:00 - 20:00',
      saturday: '12:00 - 20:00',
      sunday: '12:00 - 20:00',
    };

    const schedule = formatStoreOpeningSchedule(hours);
    expect(schedule).toEqual([
      { label: 'Monday–Sunday', hours: '12:00 - 20:00' },
    ]);
  });

  it('handles non-standard day keys and array values', () => {
    const hours = {
      weekdays: ['10:00', '19:00'],
      weekends: '11:00 - 17:00',
    };

    const schedule = formatStoreOpeningSchedule(hours);
    expect(schedule).toEqual([
      { label: 'Weekdays', hours: '10:00 - 19:00' },
      { label: 'Weekends', hours: '11:00 - 17:00' },
    ]);
  });

  it('formats human-readable summary string', () => {
    const hours = {
      monday: '10:00 - 19:00',
      tuesday: '10:00 - 19:00',
      wednesday: '10:00 - 19:00',
      thursday: '10:00 - 19:00',
      friday: '10:00 - 20:00',
      saturday: '10:00 - 18:00',
      sunday: 'Closed',
    };

    const summary = formatStoreOpeningHoursSummary(hours);
    expect(summary).toBe('Monday–Thursday 10:00 - 19:00 · Friday 10:00 - 20:00 · Saturday 10:00 - 18:00 · Sunday Closed');
  });
});
