import { useMemo, useState } from 'react';
import { catalogAssets, formatMoney, marketDataMeta } from '../data/demo';
import {
  compareCardMarkets,
  type MarketComparisonPriceFilterError,
} from '../domain/marketComparison';
import { Icon } from './Icon';
import { Button, CardArt, Chip, EmptyState, MarketDataBadge, Segmented } from './ui';

type RankingMode = 'highest' | 'lowest';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function formatSignedUsd(value: number): string {
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return `${value >= 0 ? '+' : '−'}${formatted}`;
}

function priceFilterErrorMessage(error: MarketComparisonPriceFilterError | null): string | null {
  switch (error) {
    case 'invalid-minimum':
      return 'Enter a valid minimum Cardmarket price of €0 or more.';
    case 'invalid-maximum':
      return 'Enter a valid maximum Cardmarket price of €0 or more.';
    case 'minimum-exceeds-maximum':
      return 'Minimum Cardmarket price cannot be greater than the maximum.';
    default:
      return null;
  }
}

export function MarketComparisonPage() {
  const [mode, setMode] = useState<RankingMode>('highest');
  const [minimumCardmarketPrice, setMinimumCardmarketPrice] = useState('');
  const [maximumCardmarketPrice, setMaximumCardmarketPrice] = useState('');
  const exchangeRate = marketDataMeta.exchangeRate;
  const comparison = useMemo(
    () => compareCardMarkets(catalogAssets, exchangeRate.usdPerEur, {
      minCardmarketEur: minimumCardmarketPrice,
      maxCardmarketEur: maximumCardmarketPrice,
    }),
    [exchangeRate.usdPerEur, maximumCardmarketPrice, minimumCardmarketPrice],
  );
  const assetIndex = useMemo(
    () => new Map(catalogAssets.map((asset) => [asset.id, asset])),
    [],
  );
  const rows = comparison[mode];
  const priceFilterError = comparison.priceFilter.error;
  const priceFilterErrorText = priceFilterErrorMessage(priceFilterError);
  const minimumIsInvalid = priceFilterError === 'invalid-minimum'
    || priceFilterError === 'minimum-exceeds-maximum';
  const maximumIsInvalid = priceFilterError === 'invalid-maximum'
    || priceFilterError === 'minimum-exceeds-maximum';
  const hasPriceFilterInput = minimumCardmarketPrice.length > 0
    || maximumCardmarketPrice.length > 0;
  const hasActivePriceFilter = priceFilterError === null
    && (comparison.priceFilter.minCardmarketEur !== null
      || comparison.priceFilter.maxCardmarketEur !== null);
  const filteredCount = comparison.summary.filteredEligiblePrintingCount;
  const eligibleCount = comparison.summary.eligiblePrintingCount;
  const displayedRankingCount = Math.min(filteredCount, comparison.limit);
  const releasedMarketGroupCodes = Object.keys(marketDataMeta.tcgcsv.marketGroups);
  const releasedGroupCount = marketDataMeta.catalogCounts.releasedEnglishMarketGroups
    ?? releasedMarketGroupCodes.length;
  const releasedMainGroupCount = marketDataMeta.catalogCounts.releasedEnglishMainGroups
    ?? releasedMarketGroupCodes.filter((code) => /^OP\d{2}(?:-EB\d{2})?$/.test(code)).length;
  const releasedSpecialGroupCount = marketDataMeta.catalogCounts.releasedEnglishSpecialGroups
    ?? releasedGroupCount - releasedMainGroupCount;
  const latestReleasedMainSet = releasedMarketGroupCodes
    .map((code) => code.match(/^OP(\d{2})/)?.[1] ?? null)
    .filter((value): value is string => value !== null)
    .sort((left, right) => Number(right) - Number(left))[0];
  const latestReleasedMainSetCode = latestReleasedMainSet ? `OP${latestReleasedMainSet}` : 'the current set';
  const appliedPriceRange = priceFilterError
    ? 'Range not applied'
    : `${comparison.priceFilter.minCardmarketEur === null
      ? 'No minimum'
      : formatMoney(comparison.priceFilter.minCardmarketEur, 'EUR')} – ${comparison.priceFilter.maxCardmarketEur === null
      ? 'No maximum'
      : formatMoney(comparison.priceFilter.maxCardmarketEur, 'EUR')}`;
  const priceFilterStatus = priceFilterError
    ? 'Correct the price range to update the ranking.'
    : hasActivePriceFilter
      ? filteredCount >= comparison.limit
        ? `${filteredCount.toLocaleString()} of ${eligibleCount.toLocaleString()} exact price pairs match. The highest 20 and lowest 20 were rebuilt from the complete filtered pool.`
        : `${filteredCount.toLocaleString()} of ${eligibleCount.toLocaleString()} exact price pairs match. Both rankings were rebuilt; only ${filteredCount.toLocaleString()} cards exist in this range.`
      : `${eligibleCount.toLocaleString()} exact price pairs available. Rankings use the complete eligible catalog.`;
  const emptyStateTitle = priceFilterError
    ? 'Check the Cardmarket price range'
    : hasActivePriceFilter
      ? 'No cards in this price range'
      : 'No exact comparison pairs';
  const emptyStateDetail = priceFilterErrorText
    ?? (hasActivePriceFilter
      ? 'Clear the filters or broaden the minimum and maximum Cardmarket prices.'
      : 'A card appears only after both provider product identities, both positive prices, and the dated exchange rate are available.');

  const clearPriceFilters = () => {
    setMinimumCardmarketPrice('');
    setMaximumCardmarketPrice('');
  };

  return <div className="page market-comparison-page">
    <section className="market-comparison-hero panel">
      <div className="market-comparison-intro">
        <span className="market-comparison-icon"><Icon name="chart" size={24}/></span>
        <div>
          <div className="market-comparison-kicker"><p className="eyebrow">Cross-market signal</p><MarketDataBadge compact/></div>
          <h2>Compare the same printing, not just the same card.</h2>
          <p>TCGplayer market prices are divided by Cardmarket trend prices after converting EUR to USD with the dated ECB reference rate. Every released English main and special booster group through {latestReleasedMainSetCode} is scanned; ambiguous provider versions stay out.</p>
        </div>
      </div>
      <dl className="market-comparison-stats">
        <div><dt>Exact price pairs</dt><dd>{comparison.summary.eligiblePrintingCount.toLocaleString()}</dd><small>English standard printings</small></div>
        <div><dt>Released groups scanned</dt><dd>{releasedGroupCount}</dd><small>{releasedMainGroupCount} main · {releasedSpecialGroupCount} EB / PRB</small></div>
        <div><dt>ECB rate</dt><dd>{exchangeRate.usdPerEur.toFixed(4)}</dd><small>USD per EUR · {formatDate(exchangeRate.observationDate)}</small></div>
      </dl>
    </section>

    <section className="comparison-method panel" aria-label="Market comparison method">
      <div><span><Icon name="shield"/></span><div><strong>Exact-match policy</strong><small>Cardmarket product ID + TCGplayer product ID + one unambiguous standard printing.</small></div></div>
      <div><span><Icon name="refresh"/></span><div><strong>Current English release window</strong><small>OP01–{latestReleasedMainSetCode} plus EB / PRB; combined releases follow their official Bandai grouping.</small></div></div>
      <div><span><Icon name="info"/></span><div><strong>Relative signal, not profit</strong><small>Fees, tax, shipping, liquidity, and card condition are not included.</small></div></div>
    </section>

    <section className="comparison-results panel">
      <header className="comparison-results-header">
        <div><p className="eyebrow">Ranked by normalized ratio</p><h2>{mode === 'highest' ? `${displayedRankingCount} highest TCGplayer / Cardmarket ratios` : `${displayedRankingCount} lowest TCGplayer / Cardmarket ratios`}</h2><p>{mode === 'highest' ? 'Cards where TCGplayer is relatively higher after conversion.' : 'Cards where TCGplayer is relatively lower after conversion.'}</p></div>
        <Segmented
          value={mode}
          onChange={setMode}
          label="Ratio ranking"
          options={[
            { value: 'highest', label: 'Highest 20', icon: 'arrow-up' },
            { value: 'lowest', label: 'Lowest 20', icon: 'arrow-down' },
          ]}
        />
      </header>

      <div className="comparison-price-filter" aria-labelledby="comparison-price-filter-title">
        <div className="comparison-price-filter-intro">
          <span><Icon name="filter" size={17}/></span>
          <div><strong id="comparison-price-filter-title">Cardmarket price range</strong><small>Filter by the EUR trend price before the highest or lowest 20 are ranked.</small></div>
        </div>
        <fieldset className="comparison-price-filter-fields">
          <legend className="sr-only">Cardmarket EUR price filters</legend>
          <label htmlFor="minimum-cardmarket-price">
            <span>Minimum</span>
            <span className={`comparison-price-input ${minimumIsInvalid ? 'invalid' : ''}`}>
              <b aria-hidden="true">€</b>
              <input
                id="minimum-cardmarket-price"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="No minimum"
                value={minimumCardmarketPrice}
                onChange={(event) => setMinimumCardmarketPrice(event.target.value)}
                aria-invalid={minimumIsInvalid}
                aria-describedby="comparison-price-filter-help"
                aria-errormessage={minimumIsInvalid ? 'comparison-price-filter-error' : undefined}
              />
            </span>
          </label>
          <label htmlFor="maximum-cardmarket-price">
            <span>Maximum</span>
            <span className={`comparison-price-input ${maximumIsInvalid ? 'invalid' : ''}`}>
              <b aria-hidden="true">€</b>
              <input
                id="maximum-cardmarket-price"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="No maximum"
                value={maximumCardmarketPrice}
                onChange={(event) => setMaximumCardmarketPrice(event.target.value)}
                aria-invalid={maximumIsInvalid}
                aria-describedby="comparison-price-filter-help"
                aria-errormessage={maximumIsInvalid ? 'comparison-price-filter-error' : undefined}
              />
            </span>
          </label>
          <Button type="button" variant="ghost" size="sm" onClick={clearPriceFilters} disabled={!hasPriceFilterInput}>Clear filters</Button>
        </fieldset>
        <div
          id="comparison-price-filter-help"
          className={`comparison-price-filter-status ${priceFilterError ? 'is-invalid' : hasActivePriceFilter ? 'is-active' : ''}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span aria-hidden="true"><Icon name={priceFilterError ? 'info' : hasActivePriceFilter ? 'check' : 'refresh'} size={16}/></span>
          <span>
            <strong>{hasActivePriceFilter ? `Applied Cardmarket range: ${appliedPriceRange}` : priceFilterError ? appliedPriceRange : 'Applied Cardmarket range: all prices'}</strong>
            <small>{priceFilterStatus}</small>
          </span>
        </div>
        {priceFilterErrorText && <p id="comparison-price-filter-error" className="comparison-price-filter-error" role="alert"><Icon name="info" size={14}/>{priceFilterErrorText}</p>}
      </div>

      {rows.length === 0
        ? <EmptyState icon="chart" title={emptyStateTitle} detail={emptyStateDetail}/>
        : <div className="comparison-table-scroll" tabIndex={0} role="region" aria-label={`${mode === 'highest' ? 'Highest' : 'Lowest'} cross-market price ratios; scroll horizontally for all columns`}>
          <table className="comparison-table">
            <caption className="sr-only">Top 20 {mode} TCGplayer market price to currency-normalized Cardmarket trend price ratios.</caption>
            <thead><tr><th scope="col">Rank</th><th scope="col">Exact card printing</th><th scope="col">Set</th><th scope="col">Cardmarket</th><th scope="col">TCGplayer</th><th scope="col">Ratio</th><th scope="col">USD gap</th></tr></thead>
            <tbody>{rows.map((row, index) => {
              const asset = assetIndex.get(row.assetId);
              if (!asset) return null;
              const usdGap = row.tcgplayerUsd - row.cardmarketUsd;
              const relativeDifference = (row.ratio - 1) * 100;
              const tcgplayerHigher = row.ratio >= 1;
              return <tr key={row.printingId}>
                <td><span className="comparison-rank">{String(index + 1).padStart(2, '0')}</span></td>
                <td><span className="comparison-card"><CardArt asset={asset} size="xs"/><span><strong>{row.name}</strong><small>{row.number} · {row.variant}</small><em>{row.language} · {row.rarity}</em></span></span></td>
                <td><strong>{row.setCode}</strong><small>{row.set}</small></td>
                <td className="comparison-price"><strong>{formatMoney(row.cardmarketEur, 'EUR')}</strong><small>{formatMoney(row.cardmarketUsd, 'USD')} after ECB FX</small><em>Product #{row.cardmarketProductId}</em></td>
                <td className="comparison-price"><strong>{formatMoney(row.tcgplayerUsd, 'USD')}</strong><small>Market price</small><em>Product #{row.tcgplayerProductId}</em></td>
                <td><span className={`ratio-badge ${tcgplayerHigher ? 'tcg-higher' : 'cm-higher'}`}><strong>{row.ratio.toFixed(2)}×</strong><small>{relativeDifference >= 0 ? '+' : '−'}{Math.abs(relativeDifference).toFixed(0)}%</small></span></td>
                <td><strong className={usdGap >= 0 ? 'positive' : 'negative'}>{formatSignedUsd(usdGap)}</strong><small><Chip tone={tcgplayerHigher ? 'gold' : 'blue'}>{tcgplayerHigher ? 'TCGplayer higher' : 'Cardmarket higher'}</Chip></small></td>
              </tr>;
            })}</tbody>
          </table>
        </div>}
      <footer className="comparison-results-footer">
        <p><Icon name="info"/>Raw ratio ranking can magnify differences on low-value cards. Use the USD gap column to judge magnitude.</p>
        <span>Ratio = TCGplayer USD ÷ (Cardmarket EUR × {exchangeRate.usdPerEur.toFixed(4)})</span>
      </footer>
    </section>

    <section className="comparison-sources">
      <p>Sources and calculation lineage</p>
      <div>
        <a href={marketDataMeta.cardmarket.source} target="_blank" rel="noreferrer"><Icon name="collection"/><span><strong>Cardmarket</strong><small>Daily trend price · EUR</small></span><Icon name="chevron" size={15}/></a>
        <a href={marketDataMeta.tcgcsv.source} target="_blank" rel="noreferrer"><Icon name="cards"/><span><strong>TCGplayer via TCGCSV</strong><small>Daily product market price · USD</small></span><Icon name="chevron" size={15}/></a>
        <a href={exchangeRate.source} target="_blank" rel="noreferrer"><Icon name="refresh"/><span><strong>European Central Bank</strong><small>{exchangeRate.seriesKey} · {formatDate(exchangeRate.observationDate)}</small></span><Icon name="chevron" size={15}/></a>
      </div>
      <small>Source: ECB statistics; ratios calculated by TCG Harbor. Reference data is informational and may not reflect executable transaction prices.</small>
    </section>
  </div>;
}
