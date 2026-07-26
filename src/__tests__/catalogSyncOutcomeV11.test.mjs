import { describe, expect, it } from 'vitest';
import {
  scheduledSyncOutcomeV11,
  TransientCatalogSourceErrorV11,
  TRANSIENT_CATALOG_SOURCE_EXIT_CODE_V11,
} from '../../scripts/lib/catalog-sync-outcome-v11.mjs';
import { ResilientFetchErrorV8 } from '../../scripts/lib/resilient-fetch-v8.mjs';

describe('scheduled catalog sync outcome v11', () => {
  it('returns success for a completed refresh', async () => {
    await expect(scheduledSyncOutcomeV11(async () => undefined)).resolves.toEqual({
      exitCode: 0,
      deferredReason: null,
    });
  });

  it('uses the dedicated temporary-failure exit code for classified source outages', async () => {
    const mappingOutage = new TransientCatalogSourceErrorV11('Artwork host timed out.');
    await expect(scheduledSyncOutcomeV11(async () => { throw mappingOutage; })).resolves
      .toEqual({
        exitCode: TRANSIENT_CATALOG_SOURCE_EXIT_CODE_V11,
        deferredReason: 'Artwork host timed out.',
      });

    const fetchOutage = new ResilientFetchErrorV8('Source unavailable.', {
      transient: true,
      lastFailureKind: 'timeout',
    });
    await expect(scheduledSyncOutcomeV11(async () => { throw fetchOutage; })).resolves
      .toMatchObject({ exitCode: TRANSIENT_CATALOG_SOURCE_EXIT_CODE_V11 });
  });

  it('keeps validation, programming, and non-transient source failures red', async () => {
    await expect(scheduledSyncOutcomeV11(async () => {
      throw new Error('Cardmarket mapping changed without approval.');
    })).rejects.toThrow(/changed without approval/);

    const permanentFetchFailure = new ResilientFetchErrorV8('HTTP 404.', {
      transient: false,
      lastFailureKind: 'http',
      status: 404,
    });
    await expect(scheduledSyncOutcomeV11(async () => {
      throw permanentFetchFailure;
    })).rejects.toBe(permanentFetchFailure);
  });
});
