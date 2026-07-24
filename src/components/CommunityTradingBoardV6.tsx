import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { DemoAsset, Store } from '../data/demo';
import { catalogAssets } from '../data/demo';
import {
  tradeActionLabelV6,
  type CommunityTradeDraftV6,
  type CommunityTradeExchangeModeV6,
  type CommunityTradePostKindV6,
  type CommunityTradePostV6,
  type CommunityTradeStatusV6,
} from '../domain/communityTradingV6';
import type { ProductionCommunityTradingRuntimeV6 } from '../services/supabase/useProductionCommunityTradingV6';
import { Icon } from './Icon';
import { Avatar, Button, CardArt, Chip, EmptyState, Modal, Segmented } from './ui';
import '../styles-community-trading-v6.css';

interface CommunityBasePropsV6 {
  readonly stores: readonly Store[];
  readonly runtime: ProductionCommunityTradingRuntimeV6;
  readonly collectionAssets: readonly DemoAsset[];
  readonly navigate: (path: string) => void;
  readonly notify: (message: string) => void;
}

function supportedCardsV6(assets: readonly DemoAsset[]): DemoAsset[] {
  return assets.filter((asset) => asset.kind === 'card' && asset.language.toLowerCase() !== 'german');
}

function assetForV6(assetId: string | null, collection: readonly DemoAsset[]): DemoAsset | null {
  if (!assetId) return null;
  return collection.find((asset) => asset.id === assetId || asset.catalogId === assetId)
    ?? catalogAssets.find((asset) => asset.id === assetId)
    ?? null;
}

function dateLabelV6(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function conditionLabelV6(value: string): string {
  return value.split('_').map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ');
}

export function ProductionCommunitiesPageV6({
  stores,
  runtime,
  collectionAssets,
  navigate,
  notify,
}: CommunityBasePropsV6) {
  const joined = stores.filter((store) => runtime.isMember(store.communityId));
  const open = stores.filter((store) => (
    store.communityId
    && store.communityJoinMode === 'open'
    && !runtime.isMember(store.communityId)
  ));
  const join = async (store: Store) => {
    if (!store.communityId) return;
    try {
      const outcome = await runtime.joinOpen(store.communityId);
      notify(outcome === 'already_member' ? 'You are already a member' : `Welcome to ${store.communityName ?? store.name}`);
      navigate(`/communities/${store.communityId}`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'The community could not be joined.');
    }
  };

  return <div className="page production-communities-v6">
    <section className="community-v6-intro">
      <span><Icon name="users" size={26}/></span>
      <div><p className="eyebrow">Account-scoped communities</p><h2>Your local trading tables</h2><p>Only cards deliberately included in a post are public to that community. Your full collection stays private.</p></div>
      <Button onClick={() => navigate('/stores')} variant="secondary" icon="store">Browse stores</Button>
    </section>
    {runtime.loading ? <EmptyState icon="refresh" title="Loading your communities" detail="Checking your active memberships and trade boards…"/>
      : runtime.error ? <EmptyState icon="info" title="Communities need attention" detail={runtime.error} action={<Button onClick={() => void runtime.refresh()} icon="refresh">Try again</Button>}/>
      : joined.length === 0 ? <EmptyState icon="users" title="No joined communities yet" detail="The Dresden test community below can be joined directly—no QR scan is required."/>
      : <section><div className="section-heading"><div><p className="eyebrow">Memberships</p><h2>Joined communities</h2></div><Chip tone="positive">{joined.length} active</Chip></div><div className="community-v6-grid">{joined.map((store) => {
        const openPosts = runtime.posts.filter((post) => post.communityId === store.communityId && post.status === 'open').length;
        return <article className="panel community-v6-card" key={store.id}><span className={`community-v6-mark store-${store.accent}`}><Icon name="users" size={25}/></span><div><Chip tone="positive"><Icon name="shield" size={13}/>Active member</Chip><h3>{store.communityName ?? store.name}</h3><p><Icon name="map" size={14}/>{store.address}</p><small>{openPosts} open trade {openPosts === 1 ? 'post' : 'posts'} · collection stays private</small></div><Button onClick={() => navigate(`/communities/${store.communityId}`)} variant="secondary">Open board <Icon name="chevron"/></Button></article>;
      })}</div></section>}
    {open.length > 0 && <section><div className="section-heading"><div><p className="eyebrow">Open test spaces</p><h2>Join without a QR code</h2></div></div><div className="community-v6-grid">{open.map((store) => <article className="panel community-v6-card is-open" key={store.id}><span className={`community-v6-mark store-${store.accent}`}><Icon name="trade" size={25}/></span><div><Chip tone="gold">Open test community</Chip><h3>{store.communityName ?? store.name}</h3><p><Icon name="map" size={14}/>{store.address}</p><small>Test offering, wanted-card, purchase, giveaway, and trade posts.</small></div><Button disabled={runtime.mutating} onClick={() => void join(store)}>Join community</Button></article>)}</div></section>}
    <section className="community-v6-safety"><Icon name="shield"/><div><strong>Trades are community discovery posts</strong><p>Inspect cards and agree on final terms directly. TCG Harbor does not process payments or guarantee condition, ownership, or price fairness.</p></div></section>
  </div>;
}

export function ProductionCommunityTradingBoardV6({
  communityId,
  stores,
  runtime,
  collectionAssets,
  navigate,
  notify,
}: CommunityBasePropsV6 & { readonly communityId: string }) {
  const store = stores.find((candidate) => candidate.communityId === communityId);
  const [createOpen, setCreateOpen] = useState(false);
  const [status, setStatus] = useState<CommunityTradeStatusV6 | 'all'>('all');
  const [query, setQuery] = useState('');
  const posts = useMemo(() => runtime.posts.filter((post) => (
    post.communityId === communityId
    && (status === 'all' || post.status === status)
    && (!query.trim() || (() => {
      const primary = assetForV6(post.primaryAssetId, collectionAssets);
      const specific = assetForV6(post.specificAssetId, collectionAssets);
      return `${primary?.name ?? ''} ${primary?.number ?? ''} ${specific?.name ?? ''} ${specific?.number ?? ''}`
        .toLocaleLowerCase('en-US')
        .includes(query.trim().toLocaleLowerCase('en-US'));
    })())
  )), [collectionAssets, communityId, query, runtime.posts, status]);

  const join = async () => {
    if (!store?.communityId || store.communityJoinMode !== 'open') return;
    try {
      await runtime.joinOpen(store.communityId);
      notify(`Welcome to ${store.communityName ?? store.name}`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'The community could not be joined.');
    }
  };
  const updateStatus = async (postId: string, next: CommunityTradeStatusV6) => {
    try {
      await runtime.setStatus(postId, next);
      notify(`Trade post marked ${next}.`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'The trade status could not be updated.');
    }
  };

  if (!store) return <div className="page"><EmptyState icon="store" title="Community not found" detail="This community is unavailable or its store is no longer approved." action={<Button onClick={() => navigate('/stores')}>Back to stores</Button>}/></div>;
  if (!runtime.isMember(communityId)) {
    return <div className="page community-v6-locked"><button className="back-link" onClick={() => navigate(`/stores/${store.id}`)}><Icon name="chevron"/>Back to store</button><section className="panel"><span><Icon name={store.communityJoinMode === 'open' ? 'users' : 'lock'} size={34}/></span><p className="eyebrow">{store.communityJoinMode === 'open' ? 'Open test community' : 'Members only'}</p><h2>{store.communityName ?? store.name}</h2><p>{store.communityJoinMode === 'open' ? 'This Dresden test community is open to every signed-in player. Join directly to create real account-scoped trade posts.' : 'Visit the physical store and scan its current QR code to join.'}</p>{store.communityJoinMode === 'open' ? <Button disabled={runtime.mutating} onClick={() => void join()} icon="users">Join without QR</Button> : <Button onClick={() => navigate('/scan')} icon="scan">Open scanner</Button>}</section></div>;
  }

  return <div className="page community-trading-v6">
    <button className="back-link" onClick={() => navigate('/communities')}><Icon name="chevron"/>All communities</button>
    <section className={`community-v6-header store-${store.accent}`}><span className="community-v6-header-mark"><Icon name="trade" size={30}/></span><div><div><Chip tone="positive"><Icon name="shield" size={13}/>Active member</Chip><Chip tone="positive"><span className="live-pulse"/>Live trade feed</Chip>{store.communityJoinMode === 'open' && <Chip tone="gold">Open test community</Chip>}</div><h2>{store.communityName ?? store.name}</h2><p>{store.address} · exact-printing card posts</p></div><Button onClick={() => setCreateOpen(true)} icon="plus">Create post</Button></section>
    <section className="community-v6-toolbar"><label className="search-field"><Icon name="search"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search offered or wanted card" /></label><label className="select-field"><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as CommunityTradeStatusV6 | 'all')}><option value="all">All posts</option><option value="open">Open</option><option value="discussing">Discussing</option><option value="completed">Completed</option><option value="closed">Closed</option></select></label></section>
    <div className="community-v6-explainer"><Icon name="info"/><p><strong>Four clear choices on either side.</strong> Ask or offer money, accept any card, name a specific card, or stay open to any action. An asking price of €0 is displayed as a free giveaway.</p></div>
    {runtime.loading ? <EmptyState icon="refresh" title="Loading trade board" detail="Retrieving member-only posts…"/>
      : runtime.error ? <EmptyState icon="info" title="Trade board needs attention" detail={runtime.error} action={<Button onClick={() => void runtime.refresh()} icon="refresh">Try again</Button>}/>
      : posts.length === 0 ? <EmptyState icon="trade" title="No matching posts" detail="Create the first offer or wanted-card post for this community." action={<Button onClick={() => setCreateOpen(true)}>Create post</Button>}/>
      : <div className="community-trade-grid-v6">{posts.map((post) => <CommunityTradeCardV6 key={post.id} post={post} collectionAssets={collectionAssets} mutating={runtime.mutating} onStatus={updateStatus}/>)}</div>}
    <CommunityTradeCreateModalV6 open={createOpen} onClose={() => setCreateOpen(false)} communityId={communityId} collectionAssets={collectionAssets} runtime={runtime} notify={notify}/>
  </div>;
}

function CommunityTradeCardV6({
  post,
  collectionAssets,
  mutating,
  onStatus,
}: {
  readonly post: CommunityTradePostV6;
  readonly collectionAssets: readonly DemoAsset[];
  readonly mutating: boolean;
  readonly onStatus: (postId: string, status: CommunityTradeStatusV6) => Promise<void>;
}) {
  const primary = assetForV6(post.primaryAssetId, collectionAssets);
  const specific = assetForV6(post.specificAssetId, collectionAssets);
  if (!primary) return null;
  const condition = conditionLabelV6(post.condition);
  return <article className="panel community-trade-card-v6"><header><Avatar initials={post.authorInitials} size="sm"/><span><strong>{post.authorName}</strong><small>{dateLabelV6(post.createdAt)} · {post.own ? 'Your post' : 'Community member'}</small></span><Chip tone={post.status === 'open' ? 'positive' : post.status === 'discussing' ? 'gold' : 'neutral'}>{conditionLabelV6(post.status)}</Chip></header><div className="community-trade-direction-v6"><p className={`eyebrow ${post.postKind === 'offering_card' ? 'offering' : 'looking'}`}><Icon name={post.postKind === 'offering_card' ? 'arrow-up' : 'search'}/>{post.postKind === 'offering_card' ? 'Offering' : 'Looking for'}</p><div className="community-trade-primary-v6"><CardArt asset={primary} size="md"/><span><strong>{primary.name}</strong><small>{primary.number} · {primary.setCode} · {primary.variant}</small><em>{condition} · {post.language} · Qty {post.quantity}</em></span></div></div><div className="community-trade-terms-v6"><span><Icon name={post.exchangeMode === 'money' ? 'chart' : post.exchangeMode === 'open' ? 'sparkle' : 'trade'}/></span><div><small>{post.postKind === 'offering_card' ? 'Requested in return' : 'Available action'}</small><strong>{tradeActionLabelV6(post)}</strong>{specific && <p><CardArt asset={specific} size="xs"/><span>{specific.name}<small>{specific.number} · {specific.variant}</small></span></p>}</div></div>{post.notes && <p className="community-trade-note-v6">“{post.notes}”</p>}<footer><span><Icon name="map"/>Meet at the approved community location</span>{post.own && post.status !== 'completed' && post.status !== 'closed' && <div><Button variant="ghost" size="sm" disabled={mutating} onClick={() => void onStatus(post.id, 'closed')}>Close</Button><Button variant="secondary" size="sm" disabled={mutating} onClick={() => void onStatus(post.id, 'completed')}>Mark complete</Button></div>}</footer></article>;
}

function CommunityTradeCreateModalV6({
  open,
  onClose,
  communityId,
  collectionAssets,
  runtime,
  notify,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly communityId: string;
  readonly collectionAssets: readonly DemoAsset[];
  readonly runtime: ProductionCommunityTradingRuntimeV6;
  readonly notify: (message: string) => void;
}) {
  const ownedCards = useMemo(() => supportedCardsV6(collectionAssets), [collectionAssets]);
  const allCards = useMemo(() => supportedCardsV6(catalogAssets), []);
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
    const source = postKind === 'offering_card' ? ownedCards : allCards;
    setPrimaryId((current) => source.some((asset) => asset.id === current) ? current : source[0]?.id ?? '');
    setSpecificId('');
    setQuantity(1);
    setError('');
  }, [allCards, ownedCards, postKind]);
  useEffect(() => {
    if (exchangeMode !== 'specific_card') setSpecificId('');
    if (exchangeMode !== 'money') setAmount('');
    setError('');
  }, [exchangeMode]);

  const primarySource = postKind === 'offering_card' ? ownedCards : allCards;
  const specificSource = postKind === 'offering_card' ? allCards : ownedCards;
  const primary = primarySource.find((asset) => asset.id === primaryId) ?? null;
  const specific = specificSource.find((asset) => asset.id === specificId) ?? null;
  const maximumQuantity = postKind === 'offering_card' ? Math.max(primary?.quantity ?? 1, 1) : 100;

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
      notify(postKind === 'offering_card' ? 'Card offer published.' : 'Wanted-card post published.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The post could not be created.');
    }
  };

  return <Modal open={open} onClose={onClose} title="Create a community card post" eyebrow="Exact card printing · account protected" wide><form className="community-trade-form-v6" onSubmit={submit}><Segmented label="Post direction" value={postKind} onChange={setPostKind} options={[{ value: 'offering_card', label: 'I am offering a card', icon: 'arrow-up' }, { value: 'seeking_card', label: 'I am looking for a card', icon: 'search' }]}/><section className="community-trade-form-section-v6"><p className={`eyebrow ${postKind === 'offering_card' ? 'offering' : 'looking'}`}>{postKind === 'offering_card' ? 'Card from your collection' : 'Card you want'}</p>{postKind === 'offering_card' && ownedCards.length === 0 ? <div className="community-trade-empty-v6"><Icon name="collection"/><span><strong>Your collection has no cards to offer</strong><small>Add a card first, or create a wanted-card post that does not promise a specific return card.</small></span></div> : <><label>{postKind === 'offering_card' ? 'Owned card printing' : 'Catalog card printing'}<select value={primaryId} onChange={(event) => setPrimaryId(event.target.value)} required>{primarySource.map((asset) => <option value={asset.id} key={asset.id}>{asset.name} · {asset.number} · {asset.variant} · {asset.language}</option>)}</select></label>{primary && <div className="community-trade-preview-v6"><CardArt asset={primary} size="sm"/><span><strong>{primary.name}</strong><small>{primary.number} · {primary.setCode}</small><em>{primary.variant} · {primary.language}{postKind === 'offering_card' ? ` · ${primary.quantity} owned` : ''}</em></span></div>}<div className="form-grid"><label>Quantity<input type="number" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} min="1" max={maximumQuantity} required/></label><label>{postKind === 'offering_card' ? 'Condition shown' : 'Desired condition'}<select value={condition} onChange={(event) => setCondition(event.target.value as CommunityTradeDraftV6['desiredCondition'])}><option value="near_mint">Near Mint</option><option value="excellent">Excellent</option><option value="good">Good</option><option value="light_played">Light Played</option><option value="played">Played</option></select></label><label className="read-only-field">Language<output>{primary?.language ?? '—'}</output></label></div></>}</section><fieldset className="community-trade-modes-v6"><legend>{postKind === 'offering_card' ? 'What do you want in return?' : 'How do you want to get it?'}</legend>{([
    ['money', postKind === 'offering_card' ? 'Ask for money' : 'Buy it', 'chart'],
    ['any_card', postKind === 'offering_card' ? 'Any card' : 'Trade with any card', 'cards'],
    ['specific_card', postKind === 'offering_card' ? 'A specific card' : 'Trade a specific card', 'trade'],
    ['open', 'Open to any action', 'sparkle'],
  ] as const).map(([value, label, icon]) => <label className={exchangeMode === value ? 'active' : ''} key={value}><input type="radio" name="exchange-mode" value={value} checked={exchangeMode === value} onChange={() => setExchangeMode(value)}/><span><Icon name={icon}/><strong>{label}</strong></span></label>)}</fieldset>{exchangeMode === 'money' && <section className="community-money-v6"><label>{postKind === 'offering_card' ? 'Asking price in EUR' : 'Maximum budget in EUR (optional)'}<span className="community-euro-input-v6"><b>€</b><input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder={postKind === 'offering_card' ? '0.00' : 'Optional'} required={postKind === 'offering_card'} aria-describedby="community-money-help-v6"/></span></label><p id="community-money-help-v6"><Icon name="info"/>{postKind === 'offering_card' ? '€0 means you are giving the card away for free.' : 'Leave the budget empty to say only that you are looking to buy.'} TCG Harbor does not process the payment.</p></section>}{exchangeMode === 'specific_card' && <section className="community-trade-form-section-v6"><p className="eyebrow">{postKind === 'offering_card' ? 'Specific card wanted in return' : 'Specific owned card offered in return'}</p>{postKind === 'seeking_card' && ownedCards.length === 0 ? <div className="community-trade-empty-v6"><Icon name="collection"/><span><strong>No owned card is available</strong><small>Choose “Trade with any card” or another action, or add a card to your collection.</small></span></div> : <><label>Exact card printing<select value={specificId} onChange={(event) => setSpecificId(event.target.value)} required><option value="">Choose a card</option>{specificSource.filter((asset) => asset.id !== primaryId).map((asset) => <option value={asset.id} key={asset.id}>{asset.name} · {asset.number} · {asset.variant} · {asset.language}</option>)}</select></label>{specific && <div className="community-trade-preview-v6"><CardArt asset={specific} size="sm"/><span><strong>{specific.name}</strong><small>{specific.number} · {specific.setCode}</small><em>{specific.variant} · {specific.language}</em></span></div>}</>}</section>}<label className="community-trade-notes-v6">Community note <small>{notes.length}/1000</small><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} rows={3} placeholder="Condition details, meetup availability, or what you are flexible about…"/></label>{error && <p className="form-error" role="alert"><Icon name="info"/>{error}</p>}<footer><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={runtime.mutating || !primaryId || (exchangeMode === 'specific_card' && !specificId)} icon="send">{runtime.mutating ? 'Publishing…' : 'Publish to community'}</Button></footer></form></Modal>;
}
