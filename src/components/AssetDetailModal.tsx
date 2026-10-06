import type { FormEvent } from 'react';
import {
  type AcquisitionLot,
  type DemoAsset,
  type Market,
  currencyFor,
  formatMoney,
  marketDataMeta,
} from '../data/demo';
import {
  extractAssetAveragePrice,
  extractAssetPriceFromHistory,
  type UserCardPriceHistory,
} from '../domain/cardPriceHistory';
import { resolveCardmarketArtworkReferenceV10 } from '../domain/cardmarketSearchReferenceV10';
import cardmarketCanonicalUrls from '../data/generated/cardmarket-canonical-urls.json';
import { Icon } from './Icon';
import { Button, CardArt, Chip, Modal, PriceChart, Trend } from './ui';

export function marketSourceDate(market: Market): string {
  const raw = market === 'cardmarket' ? marketDataMeta.cardmarket.createdAt : marketDataMeta.optcg.createdAt;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(raw));
}

export function assetUsSourceLabel(asset: DemoAsset): string {
  return `${asset.usPriceSource ?? (asset.kind === 'card' ? 'OPTCG API market' : 'US market reference')} · USD`;
}

export function assetUsSourceDate(asset: DemoAsset): string {
  const raw = asset.sourceUpdatedAt?.tcgcsv ?? asset.sourceUpdatedAt?.optcg ?? marketDataMeta.optcg.createdAt;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(raw));
}

export function latestAcquisition(asset: DemoAsset): AcquisitionLot | undefined {
  return asset.acquisitionLots?.at(-1);
}

export function initialAcquisition(asset: DemoAsset): AcquisitionLot | undefined {
  return asset.acquisitionLots?.[0];
}

export const SPECIAL_EXPANSIONS: Record<string, string> = {
  // Mainline Boosters
  OP01: 'Romance-Dawn',
  OP02: 'Paramount-War',
  OP03: 'Pillars-of-Strength',
  OP04: 'Kingdoms-of-Intrigue',
  OP05: 'Awakening-of-the-New-Era',
  OP06: 'Wings-of-the-Captain',
  OP07: '500-Years-into-the-Future',
  OP08: 'Two-Legends',
  OP09: 'Emperors-in-the-New-World',
  OP10: 'Royal-Blood',
  OP11: 'A-Fist-of-Divine-Speed',
  OP12: 'Legacy-of-the-Master',
  OP13: 'Carrying-on-his-Will',
  OP14: 'The-Azure-Seas-Seven',
  'OP14-EB04': 'The-Azure-Seas-Seven',
  OP15: 'Adventure-on-Kamis-Island',
  'OP15-EB04': 'Adventure-on-Kamis-Island',
  OP16: 'The-Time-of-Battle',
  OP17: 'The-Worlds-Strongest-Warriors',

  // Extra Boosters
  EB01: 'Memorial-Collection',
  EB02: 'Anime-25th-Collection',
  EB03: 'Heroines-Edition',
  EB04: 'The-Azure-Seas-Seven',

  // Premium Boosters
  PRB01: 'The-Best',
  PRB02: 'The-Best-Vol2',

  // Starter Decks
  ST01: 'Starter-Deck-Straw-Hat-Crew',
  ST02: 'Starter-Deck-Worst-Generation',
  ST03: 'Starter-Deck-The-Seven-Warlords-of-The-Sea',
  ST04: 'Starter-Deck-Animal-Kingdom-Pirates',
  ST05: 'Starter-Deck-Film-Edition',
  ST06: 'Starter-Deck-Absolute-Justice',
  ST07: 'Starter-Deck-Big-Mom-Pirates',
  ST08: 'Starter-Deck-MonkeyDLuffy',
  ST09: 'Starter-Deck-Yamato',
  ST10: 'Ultra-Deck-The-Three-Captains',
  ST11: 'Starter-Deck-Uta',
  ST12: 'Starter-Deck-Zoro-and-Sanji',
  ST13: 'Ultra-Deck-The-Three-Brothers',
  ST14: 'Starter-Deck-3D2Y',
  ST15: 'Starter-Deck-RED-Edward-Newgate',
  ST16: 'Starter-Deck-GREEN-Uta',
  ST17: 'Starter-Deck-BLUE-Donquixote-Doflamingo',
  ST18: 'Starter-Deck-PURPLE-Monkey-D-Luffy',
  ST19: 'Starter-Deck-BLACK-Smoker',
  ST20: 'Starter-Deck-YELLOW-Charlotte-Katakuri',
  ST21: 'Starter-Deck-Red-MonkeyDLuffy',
  ST22: 'Starter-Deck-EX-Ace-Newgate',
  ST23: 'Starter-Deck-Red-Shanks',
  ST24: 'Starter-Deck-Green-Jewlery-Bonney',
  ST25: 'Starter-Deck-Blue-Buggy',
  ST26: 'Starter-Deck-Purple-Black-MonkeyDLuffy',
  ST27: 'Starter-Deck-Black-MarshallDTeach',
  ST28: 'Starter-Deck-Green-Yellow-Yamato',
  ST29: 'Starter-Deck-Egghead',
  ST30: 'Starter-Deck-EX-Luffy-Ace',
  ST31: 'Starter-Deck-Red-MonkeyDLuffy',
  ST32: 'Starter-Deck-Green-Roronoa-Zoro',
  ST33: 'Starter-Deck-Blue-Kuzan',
  ST34: 'Starter-Deck-Purple-Charlotte-Katakuri',
  ST35: 'Starter-Deck-Red-Black-Sabo',
  ST36: 'Starter-Deck-Yellow-Eustass-Captain-Kid',

  // Promos
  P: 'Promos',
  PROMO: 'Promos',
  'OP-PR': 'Promos',
};

export function cleanCardmarketCardName(name: string): string {
  let cleaned = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  cleaned = cleaned.replace(/^[\s.·!?'"-]+/, '');
  cleaned = cleaned.replace(/\./g, '-');
  cleaned = cleaned.replace(/[\s_]+/g, '-');
  cleaned = cleaned.replace(/['"!?/:;,#&()]/g, '');
  cleaned = cleaned.replace(/-+/g, '-');
  cleaned = cleaned.replace(/^-|-$/g, '');
  return cleaned;
}

export function cardmarketProductUrl(asset: DemoAsset): string {
  const lang = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en';

  const canonicalMap = (cardmarketCanonicalUrls ?? {}) as Record<string, string>;
  if (asset.cardmarketProductId && canonicalMap[String(asset.cardmarketProductId)]) {
    const slug = canonicalMap[String(asset.cardmarketProductId)];
    return `https://www.cardmarket.com/${lang}/OnePiece/Products/Singles/${slug}`;
  }

  if (asset.kind === 'card' && asset.number && asset.number !== 'DON!!') {
    let expansion = '';
    if (asset.setCode) {
      expansion = SPECIAL_EXPANSIONS[asset.setCode] || '';
    }
    if (!expansion) {
      const prefixMatch = asset.number.match(/^([A-Za-z]+[-]?\d+)/);
      if (prefixMatch) {
        const prefix = prefixMatch[1].replace(/[^a-zA-Z0-9]/g, '');
        expansion = SPECIAL_EXPANSIONS[prefix] || '';
      }
    }

    const cleanName = cleanCardmarketCardName(asset.name);
    const cleanNumber = asset.number.trim();

    let versionSuffix = '';
    const variant = asset.variant || '';
    const pMatch = variant.match(/P(\d+)/i);
    const vMatch = variant.match(/V[.]?(\d+)/i);
    if (pMatch) {
      versionSuffix = `-V${parseInt(pMatch[1], 10) + 1}`;
    } else if (vMatch && vMatch[1] !== '1') {
      versionSuffix = `-V${vMatch[1]}`;
    } else if (/alternate art/i.test(variant)) {
      versionSuffix = '-V2';
    }

    if (cleanName && cleanNumber) {
      const cardSlug = `${cleanName}-${cleanNumber}${versionSuffix}`;
      if (expansion) {
        return `https://www.cardmarket.com/${lang}/OnePiece/Products/Singles/${expansion}/${cardSlug}`;
      }
      return `https://www.cardmarket.com/${lang}/OnePiece/Cards/${cardSlug}`;
    }
  }

  if (asset.cardmarketProductId && Number.isFinite(asset.cardmarketProductId) && asset.cardmarketProductId > 0) {
    return `https://www.cardmarket.com/${lang}/OnePiece/Products/Search?idProduct=${asset.cardmarketProductId}`;
  }

  const query = asset.number ?? asset.name;
  return `https://www.cardmarket.com/${lang}/OnePiece/Products/Search?searchString=${encodeURIComponent(query)}`;
}


export function tcgplayerProductUrl(asset: DemoAsset): string {
  if (asset.tcgplayerProductId && Number.isFinite(asset.tcgplayerProductId) && asset.tcgplayerProductId > 0) {
    return `https://www.tcgplayer.com/product/${asset.tcgplayerProductId}`;
  }
  const query = `${asset.name}${asset.number ? ` ${asset.number}` : ''}`;
  return `https://www.tcgplayer.com/search/one-piece-card-game/product?q=${encodeURIComponent(query)}`;
}

export interface AssetDetailModalProps {
  readonly asset: DemoAsset | null;
  readonly onClose: () => void;
  readonly market?: Market;
  readonly priceHistory?: UserCardPriceHistory;
  readonly noteDraft?: string;
  readonly onNoteDraftChange?: (value: string) => void;
  readonly onUpdateQty?: (asset: DemoAsset, delta: number) => Promise<void> | void;
  readonly onSaveChanges?: () => Promise<void> | void;
  readonly onRequestRemove?: (asset: DemoAsset) => void;
  readonly mutating?: boolean;
  readonly onNavigateToCollection?: () => void;
  readonly onConfirmReturn?: (loanId: string) => Promise<void> | void;
  readonly currentUserId?: string;
}

export function AssetDetailModal({
  asset,
  onClose,
  market = 'cardmarket',
  priceHistory,
  noteDraft,
  onNoteDraftChange,
  onUpdateQty,
  onSaveChanges,
  onRequestRemove,
  mutating = false,
  onNavigateToCollection,
  onConfirmReturn,
  currentUserId,
}: AssetDetailModalProps) {
  if (!asset) return null;
  const cardmarketReference = resolveCardmarketArtworkReferenceV10(asset);
  const currentCardmarketPrice = extractAssetAveragePrice(asset, 'cardmarket', priceHistory);
  const currentTcgplayerPrice = extractAssetAveragePrice(asset, 'tcgplayer', priceHistory);
  const displayCardmarketValue = currentCardmarketPrice > 0 ? formatMoney(currentCardmarketPrice, 'EUR') : cardmarketReference?.displayValue;
  const displayTcgplayerValue = currentTcgplayerPrice > 0 ? formatMoney(currentTcgplayerPrice, 'USD') : formatMoney(asset.quote.tcgplayer, 'USD');
  const hasLivePrice = priceHistory ? extractAssetPriceFromHistory(asset, 'cardmarket', priceHistory) !== null : false;
  const cardmarketDateLabel = (hasLivePrice || asset.pricing?.cardmarket?.trend != null) ? 'Daily market trend' : `${cardmarketReference?.label} · ${marketSourceDate('cardmarket')}`;
  const tcgplayerDateLabel = currentTcgplayerPrice > 0 ? 'Daily market price' : `Daily source snapshot · ${assetUsSourceDate(asset)}`;
  const isEditable = Boolean(onUpdateQty && onSaveChanges && onRequestRemove);

  const isLender = currentUserId
    ? currentUserId === asset.loan?.lenderId
    : asset.loan?.role === 'lender';
  const hasConfirmedReturn = isLender
    ? Boolean(asset.loan?.lenderReturned)
    : Boolean(asset.loan?.borrowerReturned);
  const peerConfirmedReturn = isLender
    ? Boolean(asset.loan?.borrowerReturned)
    : Boolean(asset.loan?.lenderReturned);
  const isLoanFullyReturned = Boolean(asset.loan?.lenderReturned && asset.loan?.borrowerReturned);

  const eyebrowText = asset.loan
    ? (asset.loan.role === 'lender' ? 'Lent card · Active loan' : 'Borrowed card · Active loan')
    : (isEditable ? 'Private collection item' : 'Holding analysis');

  const isCmActive = market === 'cardmarket';
  const primaryPrice = isCmActive ? displayCardmarketValue : displayTcgplayerValue;
  const primaryLabel = isCmActive
    ? (cardmarketReference?.state === 'exact-low-offer' ? 'Cardmarket lowest offer · EUR' : 'Cardmarket trend · EUR')
    : assetUsSourceLabel(asset);
  const primaryDateLabel = isCmActive ? cardmarketDateLabel : tcgplayerDateLabel;

  const secondaryPrice = isCmActive ? displayTcgplayerValue : displayCardmarketValue;
  const secondaryLabel = isCmActive
    ? assetUsSourceLabel(asset)
    : (cardmarketReference?.state === 'exact-low-offer' ? 'Cardmarket lowest offer · EUR' : 'Cardmarket trend · EUR');
  const secondaryDateLabel = isCmActive ? tcgplayerDateLabel : cardmarketDateLabel;

  const activeUnitPrice = (isCmActive ? currentCardmarketPrice : currentTcgplayerPrice) || (asset.quote[market] ?? 0);

  return (
    <Modal
      open={!!asset}
      onClose={onClose}
      title={asset.name}
      eyebrow={eyebrowText}
      wide
    >
      <div className="asset-detail">
        <div className="detail-visual">
          <CardArt asset={asset} size="lg" />
          <div className="catalog-stamp">
            <Icon name="shield" />
            <span>
              <strong>
                {asset.kind === 'sealed'
                  ? asset.imageSourceRelationship === 'contained-unit'
                    ? 'Contents represented'
                    : 'Product image verified'
                  : 'Printing matched'}
              </strong>
              <small>
                Cardmarket product {asset.cardmarketProductId ?? 'unavailable'} · {asset.number ?? asset.productType}
              </small>
            </span>
          </div>
        </div>
        <div className="detail-content">
          <div className="asset-labels">
            <Chip tone="neutral">{asset.rarity}</Chip>
            <Chip tone="gold">{asset.variant}</Chip>
            <Chip tone="blue">{asset.language}</Chip>
            {asset.loan && (
              <Chip tone={asset.loan.role === 'lender' ? 'blue' : 'gold'}>
                {asset.loan.role === 'lender' ? 'Lent card' : 'Borrowed card'}
              </Chip>
            )}
          </div>
          <h3>{asset.set}</h3>
          <p className="detail-number">{asset.number ?? asset.productType} · One Piece Card Game</p>
          {asset.loan && (
            <div className="loan-detail-card">
              <div className="loan-detail-header">
                <span className="loan-party-info">
                  <Icon name={asset.loan.role === 'lender' ? 'trade' : 'refresh'} size={18} />
                  <strong>
                    {asset.loan.role === 'lender' ? 'Lent to' : 'Borrowed from'}{' '}
                    {asset.loan.otherPartyUsername ? `@${asset.loan.otherPartyUsername}` : asset.loan.otherPartyName}
                  </strong>
                </span>
                <Chip tone={isLoanFullyReturned ? 'neutral' : peerConfirmedReturn ? 'gold' : 'blue'}>
                  {isLoanFullyReturned
                    ? 'Returned'
                    : peerConfirmedReturn
                      ? 'Peer confirmed return'
                      : 'Active loan'}
                </Chip>
              </div>
              <div className="loan-meta-grid">
                <div>
                  <span>Date lent</span>
                  <strong>{new Date(asset.loan.lentAt).toLocaleDateString()}</strong>
                </div>
                <div>
                  <span>Value when lent</span>
                  <strong>{formatMoney(asset.loan.lentValueAmount, 'EUR')}</strong>
                </div>
              </div>
              <p className="loan-status-instruction">
                {hasConfirmedReturn
                  ? 'You confirmed this card as returned. Waiting for peer confirmation.'
                  : peerConfirmedReturn
                    ? 'Peer marked this card as returned. Click Returned below to complete return.'
                    : 'Both players must click Returned before this card returns to the owner’s collection.'}
              </p>
            </div>
          )}
          {asset.kind === 'sealed' && asset.imageSourceRelationship === 'contained-unit' && (
            <p className="reference-note">
              <Icon name="box" />This is the real corresponding contained product, not a photo of the outer case.
            </p>
          )}
          <div className="detail-prices">
            <div className="detail-price-box active-market-box">
              <span className="price-source-heading">
                <span>{primaryLabel}</span>
                <span className="active-market-tag">Active market</span>
              </span>
              <strong>{primaryPrice}</strong>
              <small>{primaryDateLabel}</small>
            </div>
            <div className="detail-price-box secondary-market-box">
              <span className="price-source-heading">
                <span>{secondaryLabel}</span>
                <span className="secondary-market-tag">Cross-market</span>
              </span>
              <strong>{secondaryPrice}</strong>
              <small>{secondaryDateLabel}</small>
            </div>
          </div>
          {asset.cardmarketPriceState && asset.cardmarketPriceState !== 'available' && (
            <p className="reference-note">
              <Icon name="info" />
              {asset.cardmarketPriceReason ?? 'Cardmarket price unavailable for this printing.'}
              {asset.sourceUpdatedAt?.cardmarket && (
                <> Since {new Date(asset.sourceUpdatedAt.cardmarket).toLocaleDateString()}.</>
              )}
            </p>
          )}
          <div className="market-links-bar">
            <span>Marketplace links:</span>
            <a
              href={cardmarketProductUrl(asset)}
              target="_blank"
              rel="noopener noreferrer"
              className="market-external-btn"
            >
              <span>View on Cardmarket</span>
              <Icon name="external-link" size={12} />
            </a>
            <a
              href={tcgplayerProductUrl(asset)}
              target="_blank"
              rel="noopener noreferrer"
              className="market-external-btn"
            >
              <span>View on TCGplayer</span>
              <Icon name="external-link" size={12} />
            </a>
          </div>
          <div className="detail-chart">
            <header>
              <div>
                <strong>Trend comparison</strong>
                <small>Current trend vs 30-day rolling average</small>
              </div>
              <Trend value={asset.change[market]['1M']} />
            </header>
            <PriceChart assets={[asset]} market={market} period="1M" priceHistory={priceHistory} />
          </div>
          <dl className="detail-facts">
            <div>
              <dt>Condition</dt>
              <dd>{asset.condition}</dd>
            </div>
            <div>
              <dt>First added</dt>
              <dd>{new Date(asset.addedAt).toLocaleDateString()}</dd>
            </div>
            <div>
              <dt>Purchase price</dt>
              <dd>{asset.purchasePrice ? formatMoney(asset.purchasePrice, asset.purchaseCurrency ?? currencyFor(market)) : 'Not recorded'}</dd>
            </div>
            <div>
              <dt>Unit market reference</dt>
              <dd>{formatMoney(activeUnitPrice > 0 ? activeUnitPrice : null, market)}</dd>
            </div>
            <div>
              <dt>Portfolio contribution</dt>
              <dd>{formatMoney(activeUnitPrice > 0 ? activeUnitPrice * asset.quantity : null, market)}</dd>
            </div>
            <div>
              <dt>Acquisition captures</dt>
              <dd>{asset.acquisitionLots?.length ?? 0}</dd>
            </div>
            <div>
              <dt>Value when added</dt>
              <dd>
                {initialAcquisition(asset)
                  ? `${formatMoney(initialAcquisition(asset)?.quoteAtAdd.cardmarket ?? null, 'EUR')} / ${formatMoney(initialAcquisition(asset)?.quoteAtAdd.tcgplayer ?? null, 'USD')}`
                  : 'Awaiting first account capture'}
              </dd>
            </div>
            {Boolean(asset.acquisitionLots && asset.acquisitionLots.length > 1) && (
              <div>
                <dt>Latest captured value</dt>
                <dd>
                  {`${formatMoney(latestAcquisition(asset)?.quoteAtAdd.cardmarket ?? null, 'EUR')} / ${formatMoney(latestAcquisition(asset)?.quoteAtAdd.tcgplayer ?? null, 'USD')}`}
                </dd>
              </div>
            )}
            {asset.loan && (
              <>
                <div>
                  <dt>Date lent</dt>
                  <dd>{new Date(asset.loan.lentAt).toLocaleDateString()}</dd>
                </div>
                <div>
                  <dt>Value when lent</dt>
                  <dd>{formatMoney(asset.loan.lentValueAmount, 'EUR')}</dd>
                </div>
              </>
            )}
          </dl>
          {isEditable ? (
            <>
              <div className="private-note">
                <Icon name="lock" />
                <span>
                  <strong>Private note</strong>
                  <textarea
                    aria-label="Private note"
                    value={noteDraft ?? ''}
                    onChange={(event) => onNoteDraftChange?.(event.target.value)}
                    placeholder="Storage location, provenance, grading notes…"
                    maxLength={300}
                  />
                </span>
              </div>
              {!asset.loan && (
                <div className="quantity-editor">
                  <span>
                    <strong>Quantity</strong>
                    <small>{asset.catalogArchived ? 'Archived item · decrease or remove only' : 'Update copies held'}</small>
                  </span>
                  <div>
                    <Button variant="secondary" size="icon" disabled={mutating} onClick={() => void onUpdateQty?.(asset, -1)} aria-label="Decrease quantity">−</Button>
                    <strong>{asset.quantity}</strong>
                    <Button variant="secondary" size="icon" disabled={mutating || asset.catalogArchived} onClick={() => void onUpdateQty?.(asset, 1)} aria-label={asset.catalogArchived ? 'Archived items cannot be increased' : 'Increase quantity'}>+</Button>
                  </div>
                </div>
              )}
              <div className="modal-actions">
                {asset.loan && onConfirmReturn && (
                  <Button
                    variant={hasConfirmedReturn ? 'secondary' : 'primary'}
                    disabled={mutating || hasConfirmedReturn}
                    onClick={() => void onConfirmReturn(asset.loan!.id)}
                    icon={hasConfirmedReturn ? 'check' : 'refresh'}
                  >
                    {hasConfirmedReturn ? 'Return confirmed' : 'Returned'}
                  </Button>
                )}
                {!asset.loan && (
                  <Button variant="danger" disabled={mutating} onClick={() => onRequestRemove?.(asset)} icon="trash">Remove</Button>
                )}
                <Button disabled={mutating} onClick={() => void onSaveChanges?.()} icon="edit">Save changes</Button>
              </div>
            </>
          ) : (
            <>
              {asset.note && (
                <div className="private-note">
                  <Icon name="lock" />
                  <span>
                    <strong>Private note</strong>
                    <p>{asset.note}</p>
                  </span>
                </div>
              )}
              <div className="modal-actions">
                {asset.loan && onConfirmReturn && (
                  <Button
                    variant={hasConfirmedReturn ? 'secondary' : 'primary'}
                    disabled={mutating || hasConfirmedReturn}
                    onClick={() => void onConfirmReturn(asset.loan!.id)}
                    icon={hasConfirmedReturn ? 'check' : 'refresh'}
                  >
                    {hasConfirmedReturn ? 'Return confirmed' : 'Returned'}
                  </Button>
                )}
                <Button variant="secondary" onClick={onClose}>Close</Button>
                {onNavigateToCollection && (
                  <Button onClick={onNavigateToCollection} icon="collection">Open in collection</Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
