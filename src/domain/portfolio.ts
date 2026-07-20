import { DomainError } from './errors';
import { assertNativeProviderCurrency } from './pricing';
import type {
  CatalogItemId,
  CollectionItemId,
  Currency,
  ISODateTime,
  MarketProvider,
  PortfolioHolding,
  PriceSnapshot,
  QuantityEvent,
} from './types';

export type PerformancePeriod = '1D' | '1W' | '1M';

const PERIOD_MILLISECONDS: Readonly<Record<PerformancePeriod, number>> = Object.freeze({
  '1D': 24 * 60 * 60 * 1_000,
  '1W': 7 * 24 * 60 * 60 * 1_000,
  '1M': 30 * 24 * 60 * 60 * 1_000,
});

export interface HoldingPerformance {
  readonly collectionItemId: CollectionItemId;
  readonly catalogItemId: CatalogItemId;
  readonly startingQuantity: number;
  readonly currentQuantity: number;
  readonly startingUnitValue: number | null;
  readonly currentUnitValue: number | null;
  readonly startingHoldingValue: number | null;
  readonly currentHoldingValue: number | null;
  /** Current holding value minus starting holding value. Includes inventory changes. */
  readonly absoluteChange: number | null;
  readonly percentageChange: number | null;
  /** Quantity additions/removals valued at the closest quote at or before each event. */
  readonly inventoryFlowValue: number | null;
  /** Change attributable to price while inventory was held, not to newly added stock. */
  readonly pricePerformanceChange: number | null;
  readonly pricePerformancePercentage: number | null;
}

export interface PortfolioPerformance {
  readonly provider: MarketProvider;
  readonly currency: Currency;
  readonly period: PerformancePeriod;
  readonly periodStart: ISODateTime;
  readonly asOf: ISODateTime;
  /** Sum of known current holdings; useful alongside unavailableCurrentItemIds. */
  readonly knownCurrentValue: number;
  /** Null if any currently owned item is missing a current quote. */
  readonly currentValue: number | null;
  readonly startingValue: number | null;
  /** Current minus starting value. This is the brief's raw holding-value calculation. */
  readonly absoluteChange: number | null;
  readonly percentageChange: number | null;
  readonly inventoryFlowValue: number | null;
  /** Preferred performance display: raw change less inventory flows. */
  readonly pricePerformanceChange: number | null;
  readonly pricePerformancePercentage: number | null;
  readonly unavailableCurrentItemIds: readonly CollectionItemId[];
  readonly insufficientHistoryItemIds: readonly CollectionItemId[];
  readonly unvaluedQuantityEventIds: readonly string[];
  readonly holdings: readonly HoldingPerformance[];
}

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new DomainError('INVALID_INPUT', `${label} must be a valid ISO date/time.`);
  return parsed;
}

function validNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new DomainError('INVALID_INPUT', `${label} must be a finite non-negative number.`);
  }
}

export function getPerformancePeriodStart(period: PerformancePeriod, asOf: ISODateTime): ISODateTime {
  return new Date(timestamp(asOf, 'asOf') - PERIOD_MILLISECONDS[period]).toISOString();
}

/** Returns the latest matching snapshot whose timestamp is <= the requested instant. */
export function closestSnapshotAtOrBefore(
  snapshots: readonly PriceSnapshot[],
  catalogItemId: CatalogItemId,
  provider: MarketProvider,
  currency: Currency,
  at: ISODateTime,
): PriceSnapshot | null {
  const atMs = timestamp(at, 'snapshot lookup time');
  let closest: PriceSnapshot | null = null;
  let closestMs = Number.NEGATIVE_INFINITY;

  for (const snapshot of snapshots) {
    if (
      snapshot.catalogItemId !== catalogItemId ||
      snapshot.provider !== provider ||
      snapshot.currency !== currency
    ) {
      continue;
    }
    validNonNegative(snapshot.unitMarketValue, 'snapshot unitMarketValue');
    const capturedMs = timestamp(snapshot.capturedAt, 'snapshot capturedAt');
    if (capturedMs <= atMs && capturedMs > closestMs) {
      closest = snapshot;
      closestMs = capturedMs;
    }
  }
  return closest;
}

function sortedEvents(holding: PortfolioHolding): readonly QuantityEvent[] {
  return holding.quantityEvents
    .filter((event) => event.collectionItemId === holding.collectionItemId)
    .slice()
    .sort((left, right) => timestamp(left.occurredAt, 'quantity event') - timestamp(right.occurredAt, 'quantity event'));
}

/** Reconstructs quantity from the immutable event ledger without using today's quantity historically. */
export function quantityAt(holding: PortfolioHolding, at: ISODateTime): number {
  validNonNegative(holding.currentQuantity, 'current quantity');
  if (!Number.isInteger(holding.currentQuantity)) {
    throw new DomainError('INVALID_INPUT', 'current quantity must be an integer.');
  }

  const atMs = timestamp(at, 'quantity lookup time');
  const createdMs = timestamp(holding.createdAt, 'holding createdAt');
  if (atMs < createdMs) return 0;

  const events = sortedEvents(holding);
  let latest: QuantityEvent | undefined;
  for (const event of events) {
    if (!Number.isInteger(event.delta) || !Number.isInteger(event.quantityAfter) || event.quantityAfter < 0) {
      throw new DomainError('INVALID_INPUT', 'quantity events require integer deltas and non-negative integer totals.');
    }
    if (timestamp(event.occurredAt, 'quantity event') <= atMs) latest = event;
    else break;
  }
  if (latest) return latest.quantityAfter;
  if (events.length > 0) return events[0].quantityAfter - events[0].delta;
  return holding.currentQuantity;
}

export interface CalculatePortfolioPerformanceInput {
  readonly holdings: readonly PortfolioHolding[];
  readonly snapshots: readonly PriceSnapshot[];
  readonly provider: MarketProvider;
  readonly currency: Currency;
  readonly period: PerformancePeriod;
  readonly asOf: ISODateTime;
}

export function calculatePortfolioPerformance(
  input: CalculatePortfolioPerformanceInput,
): PortfolioPerformance {
  assertNativeProviderCurrency(input.provider, input.currency);
  const asOfMs = timestamp(input.asOf, 'asOf');
  const periodStart = getPerformancePeriodStart(input.period, input.asOf);
  const periodStartMs = timestamp(periodStart, 'periodStart');

  const unavailableCurrentItemIds: CollectionItemId[] = [];
  const insufficientHistoryItemIds: CollectionItemId[] = [];
  const unvaluedQuantityEventIds: string[] = [];
  const results: HoldingPerformance[] = [];

  for (const holding of input.holdings) {
    const startQuantity = quantityAt(holding, periodStart);
    const currentQuantity = quantityAt(holding, input.asOf);
    const startSnapshot = startQuantity === 0
      ? null
      : closestSnapshotAtOrBefore(
          input.snapshots,
          holding.catalogItemId,
          input.provider,
          input.currency,
          periodStart,
        );
    const currentSnapshot = currentQuantity === 0
      ? null
      : closestSnapshotAtOrBefore(
          input.snapshots,
          holding.catalogItemId,
          input.provider,
          input.currency,
          input.asOf,
        );

    if (currentQuantity > 0 && !currentSnapshot) unavailableCurrentItemIds.push(holding.collectionItemId);
    if (startQuantity > 0 && !startSnapshot) insufficientHistoryItemIds.push(holding.collectionItemId);

    const startingHoldingValue = startQuantity === 0
      ? 0
      : startSnapshot
        ? startSnapshot.unitMarketValue * startQuantity
        : null;
    const currentHoldingValue = currentQuantity === 0
      ? 0
      : currentSnapshot
        ? currentSnapshot.unitMarketValue * currentQuantity
        : null;

    let itemInventoryFlow = 0;
    let inventoryFlowComplete = true;
    for (const event of sortedEvents(holding)) {
      const eventMs = timestamp(event.occurredAt, 'quantity event');
      if (event.delta === 0 || eventMs <= periodStartMs || eventMs > asOfMs) continue;
      const eventSnapshot = closestSnapshotAtOrBefore(
        input.snapshots,
        holding.catalogItemId,
        input.provider,
        input.currency,
        event.occurredAt,
      );
      if (!eventSnapshot) {
        inventoryFlowComplete = false;
        unvaluedQuantityEventIds.push(event.id);
      } else {
        itemInventoryFlow += event.delta * eventSnapshot.unitMarketValue;
      }
    }

    const absoluteChange = startingHoldingValue == null || currentHoldingValue == null
      ? null
      : currentHoldingValue - startingHoldingValue;
    const percentageChange = absoluteChange == null || !startingHoldingValue
      ? null
      : (absoluteChange / startingHoldingValue) * 100;
    const inventoryFlowValue = inventoryFlowComplete ? itemInventoryFlow : null;
    const pricePerformanceChange = absoluteChange == null || inventoryFlowValue == null
      ? null
      : absoluteChange - inventoryFlowValue;
    const pricePerformancePercentage = pricePerformanceChange == null || !startingHoldingValue
      ? null
      : (pricePerformanceChange / startingHoldingValue) * 100;

    results.push(Object.freeze({
      collectionItemId: holding.collectionItemId,
      catalogItemId: holding.catalogItemId,
      startingQuantity: startQuantity,
      currentQuantity,
      startingUnitValue: startQuantity === 0 ? null : startSnapshot?.unitMarketValue ?? null,
      currentUnitValue: currentQuantity === 0 ? null : currentSnapshot?.unitMarketValue ?? null,
      startingHoldingValue,
      currentHoldingValue,
      absoluteChange,
      percentageChange,
      inventoryFlowValue,
      pricePerformanceChange,
      pricePerformancePercentage,
    }));
  }

  const currentComplete = unavailableCurrentItemIds.length === 0;
  const historyComplete = insufficientHistoryItemIds.length === 0;
  const flowsComplete = unvaluedQuantityEventIds.length === 0;
  const knownCurrentValue = results.reduce((sum, item) => sum + (item.currentHoldingValue ?? 0), 0);
  const currentValue = currentComplete ? knownCurrentValue : null;
  const startingValue = historyComplete
    ? results.reduce((sum, item) => sum + (item.startingHoldingValue ?? 0), 0)
    : null;
  const absoluteChange = currentValue == null || startingValue == null ? null : currentValue - startingValue;
  const percentageChange = absoluteChange == null || !startingValue
    ? null
    : (absoluteChange / startingValue) * 100;
  const inventoryFlowValue = flowsComplete
    ? results.reduce((sum, item) => sum + (item.inventoryFlowValue ?? 0), 0)
    : null;
  const pricePerformanceChange = absoluteChange == null || inventoryFlowValue == null
    ? null
    : absoluteChange - inventoryFlowValue;
  const pricePerformancePercentage = pricePerformanceChange == null || !startingValue
    ? null
    : (pricePerformanceChange / startingValue) * 100;

  return Object.freeze({
    provider: input.provider,
    currency: input.currency,
    period: input.period,
    periodStart,
    asOf: new Date(asOfMs).toISOString(),
    knownCurrentValue,
    currentValue,
    startingValue,
    absoluteChange,
    percentageChange,
    inventoryFlowValue,
    pricePerformanceChange,
    pricePerformancePercentage,
    unavailableCurrentItemIds: Object.freeze(unavailableCurrentItemIds),
    insufficientHistoryItemIds: Object.freeze(insufficientHistoryItemIds),
    unvaluedQuantityEventIds: Object.freeze(unvaluedQuantityEventIds),
    holdings: Object.freeze(results),
  });
}
