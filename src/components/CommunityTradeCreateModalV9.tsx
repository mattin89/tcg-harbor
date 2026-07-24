import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { catalogAssets, type DemoAsset } from '../data/demo';
import {
  availableTradeQuantityV8,
  type CommunityTradeDraftV6,
  type CommunityTradeExchangeModeV6,
  type CommunityTradePostKindV6,
} from '../domain/communityTradingV6';
import {
  selectAvailableOwnedCommunityCardsV9,
  selectSupportedCommunityCardsV9,
} from '../domain/communityCardSearchV9';
import type { ProductionCommunityTradingRuntimeV6 } from '../services/supabase/useProductionCommunityTradingV6';
import { CommunityCardSearchPickerV9 } from './CommunityCardSearchPickerV9';
import { Icon } from './Icon';
import { Button, Modal, Segmented } from './ui';

interface CommunityTradeCreateModalV9Props {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly communityId: string;
  readonly collectionAssets: readonly DemoAsset[];
  readonly runtime: ProductionCommunityTradingRuntimeV6;
  readonly notify: (message: string) => void;
}

function catalogIdentityV9(asset: DemoAsset | null): string | null {
  return asset ? asset.catalogId ?? asset.id : null;
}

export function CommunityTradeCreateModalV9({
  open,
  onClose,
  communityId,
  collectionAssets,
  runtime,
  notify,
}: CommunityTradeCreateModalV9Props) {
  const ownedCards = useMemo(
    () => selectSupportedCommunityCardsV9(collectionAssets),
    [collectionAssets],
  );
  const availableForTrade = (asset: DemoAsset) => (
    availableTradeQuantityV8(asset.quantity, asset.collectionItemId, runtime.posts)
  );
  const availableOwnedCards = useMemo(
    () => selectAvailableOwnedCommunityCardsV9(ownedCards, runtime.posts),
    [ownedCards, runtime.posts],
  );
  const allCards = useMemo(() => selectSupportedCommunityCardsV9(catalogAssets), []);

  const [postKind, setPostKind] = useState<CommunityTradePostKindV6>('offering_card');
  const [exchangeMode, setExchangeMode] = useState<CommunityTradeExchangeModeV6>('money');
  const [primaryId, setPrimaryId] = useState('');
  const [specificId, setSpecificId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<CommunityTradeDraftV6['desiredCondition']>('near_mint');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setPrimaryId('');
    setSpecificId('');
    setQuantity(1);
    setError('');
  }, [open]);
  useEffect(() => {
    const source = postKind === 'offering_card' ? availableOwnedCards : allCards;
    setPrimaryId((current) => source.some((asset) => asset.id === current) ? current : '');
    setSpecificId('');
    setQuantity(1);
    setError('');
  }, [allCards, availableOwnedCards, postKind]);
  useEffect(() => {
    if (exchangeMode !== 'specific_card') setSpecificId('');
    if (exchangeMode !== 'money') setAmount('');
    setError('');
  }, [exchangeMode]);

  const primarySource = postKind === 'offering_card' ? availableOwnedCards : allCards;
  const primary = primarySource.find((asset) => asset.id === primaryId) ?? null;
  const primaryIdentity = catalogIdentityV9(primary);
  const rawSpecificSource = postKind === 'offering_card' ? allCards : availableOwnedCards;
  const specificSource = rawSpecificSource.filter((asset) => (
    catalogIdentityV9(asset) !== primaryIdentity
  ));
  const primaryAvailableQuantity = primary && postKind === 'offering_card'
    ? availableForTrade(primary)
    : 100;
  const maximumQuantity = postKind === 'offering_card'
    ? Math.max(primaryAvailableQuantity, 1)
    : 100;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    try {
      await runtime.create({
        communityId,
        postKind,
        exchangeMode,
        primaryAssetId: primaryId,
        specificAssetId: exchangeMode === 'specific_card' ? specificId : undefined,
        quantity,
        desiredCondition: condition,
        cashAmountEuros: exchangeMode === 'money' ? amount : undefined,
        notes,
      }, collectionAssets, catalogAssets);
      onClose();
      notify(postKind === 'offering_card'
        ? 'Card offer published.'
        : 'Wanted-card post published.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The post could not be created.');
    }
  };

  return <Modal
    open={open}
    onClose={onClose}
    title="Create a community card post"
    eyebrow="Search exact printings · account protected"
    wide
  >
    <form className="community-trade-form-v6" onSubmit={submit}>
      <Segmented
        label="Post direction"
        value={postKind}
        onChange={setPostKind}
        options={[
          { value: 'offering_card', label: 'I am offering a card', icon: 'arrow-up' },
          { value: 'seeking_card', label: 'I am looking for a card', icon: 'search' },
        ]}
      />

      <section className="community-trade-form-section-v6">
        <p className={`eyebrow ${postKind === 'offering_card' ? 'offering' : 'looking'}`}>
          {postKind === 'offering_card' ? 'Card from your collection' : 'Card you want'}
        </p>
        {postKind === 'offering_card' && availableOwnedCards.length === 0
          ? <div className="community-trade-empty-v6">
            <Icon name="collection"/>
            <span>
              <strong>{ownedCards.length === 0
                ? 'Your collection has no cards to offer'
                : 'Every owned card is already reserved'}</strong>
              <small>{ownedCards.length === 0
                ? 'Add a card first, or create a wanted-card post that does not promise a specific return card.'
                : 'Close or complete an active trade before listing one of these cards again.'}</small>
            </span>
          </div>
          : <>
            <CommunityCardSearchPickerV9
              key={`primary-${postKind}`}
              assets={primarySource}
              value={primaryId}
              onChange={setPrimaryId}
              label={postKind === 'offering_card'
                ? 'Search your available collection cards'
                : 'Search any card in the complete catalog'}
              placeholder={postKind === 'offering_card'
                ? 'Type a card name, number, set, or art'
                : 'Try “Nami”, “OP01-016”, or “alternate art”'}
              helper={postKind === 'offering_card'
                ? 'Only cards currently owned by this account and not fully reserved by another active trade can be selected.'
                : 'Search every sourced non-German card printing, including regular and alternative arts.'}
              owned={postKind === 'offering_card'}
              availableQuantity={postKind === 'offering_card' ? availableForTrade : undefined}
              required
            />
            {primary && <div className="form-grid">
              <label>
                Quantity
                <input
                  type="number"
                  value={quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                  min="1"
                  max={maximumQuantity}
                  required
                />
              </label>
              <label>
                {postKind === 'offering_card' ? 'Condition shown' : 'Desired condition'}
                <select
                  value={condition}
                  onChange={(event) => setCondition(
                    event.target.value as CommunityTradeDraftV6['desiredCondition'],
                  )}
                >
                  <option value="near_mint">Near Mint</option>
                  <option value="excellent">Excellent</option>
                  <option value="good">Good</option>
                  <option value="light_played">Light Played</option>
                  <option value="played">Played</option>
                </select>
              </label>
              <label className="read-only-field">
                Language
                <output>{primary.language}</output>
              </label>
            </div>}
          </>}
      </section>

      <fieldset className="community-trade-modes-v6">
        <legend>{postKind === 'offering_card'
          ? 'What do you want in return?'
          : 'How do you want to get it?'}</legend>
        {([
          ['money', postKind === 'offering_card' ? 'Ask for money' : 'Buy it', 'chart'],
          ['any_card', postKind === 'offering_card' ? 'Any card' : 'Trade with any card', 'cards'],
          ['specific_card', postKind === 'offering_card' ? 'A specific card' : 'Trade a specific card', 'trade'],
          ['open', 'Open to any action', 'sparkle'],
        ] as const).map(([value, label, icon]) => <label
          className={exchangeMode === value ? 'active' : ''}
          key={value}
        >
          <input
            type="radio"
            name="exchange-mode"
            value={value}
            checked={exchangeMode === value}
            onChange={() => setExchangeMode(value)}
          />
          <span><Icon name={icon}/><strong>{label}</strong></span>
        </label>)}
      </fieldset>

      {exchangeMode === 'money' && <section className="community-money-v6">
        <label>
          {postKind === 'offering_card'
            ? 'Asking price in EUR'
            : 'Maximum budget in EUR (optional)'}
          <span className="community-euro-input-v6">
            <b>€</b>
            <input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder={postKind === 'offering_card' ? '0.00' : 'Optional'}
              required={postKind === 'offering_card'}
              aria-describedby="community-money-help-v9"
            />
          </span>
        </label>
        <p id="community-money-help-v9">
          <Icon name="info"/>
          {postKind === 'offering_card'
            ? '€0 means you are giving the card away for free.'
            : 'Leave the budget empty to say only that you are looking to buy.'}
          {' '}The market references above are context only; TCG Harbor does not process payment.
        </p>
      </section>}

      {exchangeMode === 'specific_card' && <section className="community-trade-form-section-v6">
        <p className="eyebrow">{postKind === 'offering_card'
          ? 'Specific card wanted in return'
          : 'Specific owned card offered in return'}</p>
        {postKind === 'seeking_card' && availableOwnedCards.length === 0
          ? <div className="community-trade-empty-v6">
            <Icon name="collection"/>
            <span>
              <strong>No unreserved owned card is available</strong>
              <small>Choose “Trade with any card” or another action, add a card, or close an active trade.</small>
            </span>
          </div>
          : <CommunityCardSearchPickerV9
            key={`specific-${postKind}-${primaryIdentity ?? 'none'}`}
            assets={specificSource}
            value={specificId}
            onChange={setSpecificId}
            label={postKind === 'offering_card'
              ? 'Search the exact card wanted'
              : 'Search your collection for the exact return card'}
            placeholder="Type a card name, number, set, or art"
            helper={postKind === 'offering_card'
              ? 'The wanted side can be any sourced non-German card printing in the catalog.'
              : 'A promised return card must be owned by this account and not reserved elsewhere.'}
            owned={postKind === 'seeking_card'}
            availableQuantity={postKind === 'seeking_card' ? availableForTrade : undefined}
            required
          />}
      </section>}

      <label className="community-trade-notes-v6">
        Community note <small>{notes.length}/1000</small>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Condition details, meetup availability, or what you are flexible about…"
        />
      </label>

      {error && <p className="form-error" role="alert"><Icon name="info"/>{error}</p>}
      <footer>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          disabled={runtime.mutating || !primaryId || (
            exchangeMode === 'specific_card' && !specificId
          )}
          icon="send"
        >
          {runtime.mutating ? 'Publishing…' : 'Publish to community'}
        </Button>
      </footer>
    </form>
  </Modal>;
}
