import type { DemoAsset, Market, Period } from '../data/demo';

export type DailyCardPricesByDate = Record<string, number>; // cardId -> average price
export type MarketCardPriceHistory = Record<string, DailyCardPricesByDate>; // YYYY-MM-DD -> cardId -> average price
export type UserCardPriceHistory = Record<Market, MarketCardPriceHistory>;

export const DEMO_CARD_PRICE_HISTORY_KEY_V1 = 'tcg-harbor-profile-card-prices-v1';
export const HISTORY_RETENTION_DAYS = 35;

export function emptyUserCardPriceHistory(): UserCardPriceHistory {
  return {
    cardmarket: {},
    tcgplayer: {},
  };
}

/** Formats a Date object into YYYY-MM-DD local calendar string */
export function formatCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Formats a human-readable short date label (e.g. "11 Sep", "Today", "Yesterday") */
export function formatPointDateLabel(dateStr: string, todayStr: string, yesterdayStr: string): string {
  if (dateStr === todayStr) return 'Today';
  if (dateStr === yesterdayStr) return 'Yesterday';
  const [yearStr, monthStr, dayStr] = dateStr.split('-');
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
    return dateStr;
  }
  const date = new Date(year, monthIndex, day);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(date);
}

/**
 * Extracts the primary average market price for an asset.
 * For Cardmarket: uses average, falling back to trend or quote.
 * For TCGplayer: uses market price from usMarket or quote.
 */
export function extractAssetAveragePrice(asset: DemoAsset, market: Market): number {
  if (market === 'cardmarket') {
    const avg = asset.pricing?.cardmarket?.average;
    if (typeof avg === 'number' && Number.isFinite(avg) && avg > 0) return avg;
    const trend = asset.pricing?.cardmarket?.trend;
    if (typeof trend === 'number' && Number.isFinite(trend) && trend > 0) return trend;
    const quote = asset.quote?.cardmarket;
    if (typeof quote === 'number' && Number.isFinite(quote) && quote > 0) return quote;
    return 0;
  }
  const usPrice = asset.pricing?.usMarket?.market;
  if (typeof usPrice === 'number' && Number.isFinite(usPrice) && usPrice > 0) return usPrice;
  const quote = asset.quote?.tcgplayer;
  if (typeof quote === 'number' && Number.isFinite(quote) && quote > 0) return quote;
  return 0;
}

/**
 * Records today's average prices for each asset in the collection into the user's price history.
 * Prunes entries older than 35 days to keep the profile lightweight.
 */
export function recordTodayCardPrices(
  currentHistory: UserCardPriceHistory | undefined,
  assets: readonly DemoAsset[],
  market: Market,
  todayStr: string = formatCalendarDate(new Date()),
): UserCardPriceHistory {
  const base: UserCardPriceHistory = {
    cardmarket: { ...(currentHistory?.cardmarket ?? {}) },
    tcgplayer: { ...(currentHistory?.tcgplayer ?? {}) },
  };

  const marketHistory = { ...base[market] };
  const todayPrices: DailyCardPricesByDate = { ...(marketHistory[todayStr] ?? {}) };

  for (const asset of assets) {
    if (asset.quantity <= 0) continue;
    const price = extractAssetAveragePrice(asset, market);
    if (price > 0) {
      todayPrices[asset.id] = price;
    }
  }

  marketHistory[todayStr] = todayPrices;

  // Prune entries older than retention window
  const [todayYear, todayMonth, todayDay] = todayStr.split('-').map(Number);
  const cutoffTime = new Date(todayYear, todayMonth - 1, todayDay - HISTORY_RETENTION_DAYS).getTime();

  for (const dateKey of Object.keys(marketHistory)) {
    const [y, m, d] = dateKey.split('-').map(Number);
    const itemTime = new Date(y, m - 1, d).getTime();
    if (itemTime < cutoffTime) {
      delete marketHistory[dateKey];
    }
  }

  base[market] = marketHistory;
  return base;
}

export interface MultiPointCurvePoint {
  readonly date: string;
  readonly label: string;
  readonly value: number;
}

export interface MultiPointCurveResult {
  readonly points: number[];
  readonly dates: string[];
  readonly labels: string[];
  readonly curvePoints: MultiPointCurvePoint[];
}

/**
 * Computes exact daily points across the requested period window:
 * - 1D: exactly 2 points (yesterday and today)
 * - 1W: exactly 7 points (6 days ago through today)
 * - 1M: exactly 30 points (29 days ago through today)
 *
 * For any previous day with no recorded values in user history, evaluates to 0.
 */
export function buildMultiPointCurve(
  assets: readonly DemoAsset[],
  market: Market,
  period: Period,
  history?: UserCardPriceHistory,
  referenceDate: Date = new Date(),
): MultiPointCurveResult {
  const dayCount = period === '1D' ? 2 : period === '1W' ? 7 : 30;
  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth();
  const refDay = referenceDate.getDate();

  const todayStr = formatCalendarDate(new Date(refYear, refMonth, refDay));
  const yesterdayStr = formatCalendarDate(new Date(refYear, refMonth, refDay - 1));

  const marketHistory = history?.[market] ?? {};
  const curvePoints: MultiPointCurvePoint[] = [];

  for (let index = 0; index < dayCount; index++) {
    const offset = -(dayCount - 1 - index);
    const dateObj = new Date(refYear, refMonth, refDay + offset);
    const dateStr = formatCalendarDate(dateObj);
    const label = formatPointDateLabel(dateStr, todayStr, yesterdayStr);

    let dayValue = 0;
    if (dateStr === todayStr) {
      // Current date: evaluate current average price
      for (const asset of assets) {
        if (asset.quantity <= 0) continue;
        const currentPrice = extractAssetAveragePrice(asset, market);
        dayValue += currentPrice * asset.quantity;
      }
    } else {
      // Historical date: retrieve from user history, or consider as 0 if unrecorded
      const recordedDayPrices = marketHistory[dateStr];
      if (recordedDayPrices) {
        for (const asset of assets) {
          if (asset.quantity <= 0) continue;
          const recordedPrice = recordedDayPrices[asset.id] ?? 0;
          dayValue += recordedPrice * asset.quantity;
        }
      } else {
        // "If there are no values for previous days, just consider those as 0."
        dayValue = 0;
      }
    }

    curvePoints.push({
      date: dateStr,
      label,
      value: Math.round(dayValue * 100) / 100,
    });
  }

  return {
    points: curvePoints.map((p) => p.value),
    dates: curvePoints.map((p) => p.date),
    labels: curvePoints.map((p) => p.label),
    curvePoints,
  };
}

/** Local storage reader/writer for demo and client fallback */
export function readStoredCardPriceHistory(storage: { getItem(k: string): string | null }): UserCardPriceHistory {
  try {
    const raw = storage.getItem(DEMO_CARD_PRICE_HISTORY_KEY_V1);
    if (!raw) return emptyUserCardPriceHistory();
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && ('cardmarket' in parsed || 'tcgplayer' in parsed)) {
      return {
        cardmarket: typeof parsed.cardmarket === 'object' && parsed.cardmarket ? parsed.cardmarket : {},
        tcgplayer: typeof parsed.tcgplayer === 'object' && parsed.tcgplayer ? parsed.tcgplayer : {},
      };
    }
    return emptyUserCardPriceHistory();
  } catch {
    return emptyUserCardPriceHistory();
  }
}

export function writeStoredCardPriceHistory(
  storage: { setItem(k: string, v: string): void },
  history: UserCardPriceHistory,
): void {
  try {
    storage.setItem(DEMO_CARD_PRICE_HISTORY_KEY_V1, JSON.stringify(history));
  } catch {
    // Ignore storage quota or disabled storage in privacy mode
  }
}
