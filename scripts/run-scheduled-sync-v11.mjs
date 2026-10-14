import {
  scheduledSyncOutcomeV11,
  TRANSIENT_CATALOG_SOURCE_CODE_V11,
} from './lib/catalog-sync-outcome-v11.mjs';
import { updateCardmarketPrices } from './update-cardmarket-prices.mjs';

let fullSyncDeferred = false;
try {
  const outcome = await scheduledSyncOutcomeV11(
    () => import('./sync-onepiece-data-v10.mjs'),
  );
  if (outcome.deferredReason) {
    console.warn(`${TRANSIENT_CATALOG_SOURCE_CODE_V11}: ${outcome.deferredReason}`);
    fullSyncDeferred = true;
  }
} catch (error) {
  console.warn(`Upstream catalog sync deferred: ${error?.message || error}. Proceeding with daily market prices.`);
  fullSyncDeferred = true;
}

// Always ensure daily Cardmarket prices are updated across all matched cards,
// even if external catalog metadata or Bandai website had an issue or deferred.
await updateCardmarketPrices();

process.exitCode = 0;
