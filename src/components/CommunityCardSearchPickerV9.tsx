import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';
import { formatMoney, type DemoAsset } from '../data/demo';
import { searchCommunityCardsV9 } from '../domain/communityCardSearchV9';
import { resolveCardmarketArtworkReferenceV10 } from '../domain/cardmarketSearchReferenceV10';
import { Icon } from './Icon';
import { CardArt, Chip } from './ui';
import '../styles-community-card-search-v9.css';

interface CommunityCardSearchPickerV9Props {
  readonly assets: readonly DemoAsset[];
  readonly value: string;
  readonly onChange: (assetId: string) => void;
  readonly label: string;
  readonly placeholder: string;
  readonly helper: string;
  readonly owned?: boolean;
  readonly excludedAssetId?: string;
  readonly availableQuantity?: (asset: DemoAsset) => number;
  readonly required?: boolean;
}

function selectedInputLabelV9(asset: DemoAsset): string {
  return `${asset.name} · ${asset.number ?? asset.setCode} · ${asset.variant}`;
}

export function CommunityCardSearchPickerV9({
  assets,
  value,
  onChange,
  label,
  placeholder,
  helper,
  owned = false,
  excludedAssetId,
  availableQuantity,
  required = false,
}: CommunityCardSearchPickerV9Props) {
  const listboxId = useId();
  const helperId = useId();
  const eligibleAssets = useMemo(() => assets.filter((asset) => (
    asset.kind === 'card'
    && asset.id !== excludedAssetId
  )), [assets, excludedAssetId]);
  const selected = eligibleAssets.find((asset) => asset.id === value) ?? null;
  const [query, setQuery] = useState(() => selected ? selectedInputLabelV9(selected) : '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const search = useMemo(
    () => searchCommunityCardsV9(eligibleAssets, query, 40),
    [eligibleAssets, query],
  );

  useEffect(() => {
    if (!open) setQuery(selected ? selectedInputLabelV9(selected) : '');
  }, [open, selected]);
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const choose = (asset: DemoAsset) => {
    onChange(asset.id);
    setQuery(selectedInputLabelV9(asset));
    setOpen(false);
  };
  const edit = (event: ChangeEvent<HTMLInputElement>) => {
    if (value) onChange('');
    setQuery(event.target.value);
    setOpen(true);
  };
  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, search.matches.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && open && search.matches[activeIndex]) {
      event.preventDefault();
      choose(search.matches[activeIndex]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const selectedCardmarket = selected
    ? resolveCardmarketArtworkReferenceV10(selected)
    : null;
  const selectedAvailable = selected && availableQuantity
    ? availableQuantity(selected)
    : selected?.quantity ?? 0;

  return <div className="community-card-search-v9">
    <label htmlFor={`${listboxId}-input`}>
      <span>{label}</span>
      <span className="community-card-search-input-v9">
        <Icon name="search"/>
        <input
          id={`${listboxId}-input`}
          value={query}
          onChange={edit}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={keyboard}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={open && search.matches[activeIndex]
            ? `${listboxId}-${activeIndex}`
            : undefined}
          aria-describedby={helperId}
          aria-required={required}
        />
        {value && <button
          type="button"
          aria-label={`Clear ${label.toLocaleLowerCase('en-US')}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('');
            setQuery('');
            setOpen(true);
          }}
        ><Icon name="close" size={16}/></button>}
      </span>
    </label>
    <small id={helperId} className="community-card-search-helper-v9">{helper}</small>

    {open && <div
      id={listboxId}
      className="community-card-search-results-v9"
      role="listbox"
      onMouseDown={(event) => event.preventDefault()}
    >
      {search.matches.length === 0
        ? <p><Icon name="search"/><span><strong>No matching card printing</strong><small>Try a card name, number, set code, or art such as “Nami”, “OP01-016”, or “alternate”.</small></span></p>
        : <>
          <header><span>{search.totalMatches.toLocaleString()} matching exact {search.totalMatches === 1 ? 'printing' : 'printings'}</span>{search.totalMatches > search.matches.length && <small>Showing the first {search.matches.length}; refine the search to narrow it down.</small>}</header>
          {search.matches.map((asset, index) => {
            const cardmarket = resolveCardmarketArtworkReferenceV10(asset);
            const available = availableQuantity?.(asset);
            return <button
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={asset.id === value}
              className={index === activeIndex ? 'active' : ''}
              key={asset.id}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(asset)}
            >
              <CardArt asset={asset} size="xs"/>
              <span>
                <strong>{asset.name}</strong>
                <small>{asset.number} · {asset.setCode} · {asset.variant} · {asset.language}</small>
                {owned && <em>{available ?? asset.quantity} of {asset.quantity} available in your collection</em>}
              </span>
              <span className="community-card-search-result-price-v9">
                <strong>{cardmarket.displayValue}</strong>
                <small>{formatMoney(asset.quote.tcgplayer, 'USD')} US</small>
              </span>
            </button>;
          })}
        </>}
    </div>}

    {selected && <div className="community-card-selected-v9">
      <CardArt asset={selected} size="sm"/>
      <div className="community-card-selected-identity-v9">
        <span><Chip tone="neutral">{selected.setCode}</Chip>{owned && <Chip tone="positive">In your collection</Chip>}</span>
        <strong>{selected.name}</strong>
        <small>{selected.number} · {selected.variant} · {selected.language}</small>
        {owned && <em>{selectedAvailable} of {selected.quantity} unreserved {selectedAvailable === 1 ? 'copy' : 'copies'}</em>}
      </div>
      <div className="community-card-selected-market-v9" aria-label="Current market references">
        <div><span>Cardmarket</span><strong>{selectedCardmarket?.displayValue}</strong><small>{selectedCardmarket?.label}</small></div>
        <div><span>US market</span><strong>{formatMoney(selected.quote.tcgplayer, 'USD')}</strong><small>Exact printing reference</small></div>
      </div>
      <p><Icon name="info"/>Current read-only market references for this exact printing. They are context, not a required trade price or fairness guarantee.</p>
    </div>}
  </div>;
}
