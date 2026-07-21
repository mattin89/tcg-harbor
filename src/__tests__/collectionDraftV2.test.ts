import { describe, expect, it } from 'vitest';
import { resolvePrivateNoteForAddV2 } from '../domain/collectionDraftV2';

describe('collection add draft v2', () => {
  it('preserves an existing private note when a duplicate is added without a note change', () => {
    expect(resolvePrivateNoteForAddV2('   ', 'Binder A · page 4')).toBe('Binder A · page 4');
  });

  it('uses an explicitly entered replacement note', () => {
    expect(resolvePrivateNoteForAddV2('  Grading pile  ', 'Binder A')).toBe('Grading pile');
  });

  it('leaves a new item note unset when the draft is blank', () => {
    expect(resolvePrivateNoteForAddV2('', undefined)).toBeUndefined();
  });
});
