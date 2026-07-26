import {
  scheduledSyncOutcomeV11,
  TRANSIENT_CATALOG_SOURCE_CODE_V11,
} from './lib/catalog-sync-outcome-v11.mjs';

const outcome = await scheduledSyncOutcomeV11(
  () => import('./sync-onepiece-data-v10.mjs'),
);
if (outcome.deferredReason) {
  console.warn(`${TRANSIENT_CATALOG_SOURCE_CODE_V11}: ${outcome.deferredReason}`);
}
process.exitCode = outcome.exitCode;
