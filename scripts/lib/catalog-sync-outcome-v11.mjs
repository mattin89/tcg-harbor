export const TRANSIENT_CATALOG_SOURCE_EXIT_CODE_V11 = 75;
export const TRANSIENT_CATALOG_SOURCE_CODE_V11 = 'TCG_HARBOR_TRANSIENT_SOURCE_DEFERRED';

export class TransientCatalogSourceErrorV11 extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'TransientCatalogSourceErrorV11';
    this.code = TRANSIENT_CATALOG_SOURCE_CODE_V11;
  }
}

export function isTransientCatalogSourceErrorV11(reason) {
  return reason instanceof TransientCatalogSourceErrorV11
    || reason?.code === TRANSIENT_CATALOG_SOURCE_CODE_V11
    || (
      reason?.name === 'ResilientFetchErrorV8'
      && reason?.transient === true
    );
}

export async function scheduledSyncOutcomeV11(loadSync) {
  try {
    await loadSync();
    return { exitCode: 0, deferredReason: null };
  } catch (reason) {
    if (!isTransientCatalogSourceErrorV11(reason)) throw reason;
    return {
      exitCode: TRANSIENT_CATALOG_SOURCE_EXIT_CODE_V11,
      deferredReason: reason instanceof Error ? reason.message : String(reason),
    };
  }
}
