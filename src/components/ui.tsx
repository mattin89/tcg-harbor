import { useId, useMemo, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { formatMoney, type DemoAsset, type Market, type Period } from '../data/demo';
import sealedProductPlaceholder from '../assets/sealed-product-placeholder-v1.png';

export function Button({ children, variant = 'primary', size = 'md', icon, className = '', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'icon'; icon?: Parameters<typeof Icon>[0]['name'] }) {
  return <button className={`button button-${variant} button-${size} ${className}`} {...props}>{icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}{children}</button>;
}

export function DemoBadge({ compact = false }: { compact?: boolean }) {
  return <span className="demo-badge"><span className="demo-dot" />{compact ? 'Demo app' : 'Interactive product demo'}</span>;
}

export function MarketDataBadge({ compact = false }: { compact?: boolean }) {
  return <span className="demo-badge market-data-badge"><span className="live-pulse" />{compact ? 'Daily market data' : 'Source-backed daily market data'}</span>;
}

export function Avatar({ initials, size = 'md', tone = 0 }: { initials: string; size?: 'sm' | 'md' | 'lg'; tone?: number }) {
  return <span className={`avatar avatar-${size} avatar-tone-${tone % 6}`} aria-label={`Avatar for ${initials}`}>{initials}</span>;
}

export function CardArt({ asset, size = 'md' }: { asset: DemoAsset; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const monogram = asset.name.split(' ').filter((word) => word.length > 2).slice(0, 2).map((word) => word[0]).join('');
  const usesSealedPlaceholder = asset.kind === 'sealed' && !asset.imageUrl;
  const displayImageUrl = asset.imageUrl ?? (usesSealedPlaceholder ? sealedProductPlaceholder : undefined);
  const unavailableLabel = usesSealedPlaceholder ? ', placeholder image; official product artwork unavailable' : asset.imageState === 'unavailable' ? ', source artwork unavailable' : '';
  return <div className={`card-art art-${asset.color} art-${size} ${displayImageUrl ? 'has-card-image' : ''} ${asset.kind === 'sealed' ? 'is-sealed-product' : ''} ${usesSealedPlaceholder ? 'is-sealed-placeholder' : ''} ${asset.imageState === 'unavailable' ? 'art-source-unavailable' : ''}`} role="img" aria-label={`${asset.name}${asset.number ? `, ${asset.number}` : ''}${unavailableLabel}`} title={usesSealedPlaceholder ? asset.imageUnavailableReason ?? 'Placeholder image · official product artwork unavailable' : asset.imageUnavailableReason}>
    <div className="art-compass"><span>{monogram}</span></div>
    <div className="art-waves" />
    <div className="art-meta"><small>{asset.setCode}</small><strong>{asset.kind === 'card' ? asset.rarity : asset.productType}</strong></div>
    {displayImageUrl && <img className="card-art-image" src={displayImageUrl} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}
    {usesSealedPlaceholder ? <span className="art-unavailable art-placeholder-label"><Icon name="info" size={size === 'xs' ? 10 : 13}/><small>Placeholder image</small></span> : asset.imageState === 'unavailable' && <span className="art-unavailable"><Icon name="info" size={size === 'xs' ? 10 : 13}/><small>Art unavailable</small></span>}
  </div>;
}

export function Chip({ children, tone = 'neutral', icon }: { children: ReactNode; tone?: 'neutral' | 'positive' | 'negative' | 'gold' | 'blue'; icon?: Parameters<typeof Icon>[0]['name'] }) {
  return <span className={`chip chip-${tone}`}>{icon && <Icon name={icon} size={13} />}{children}</span>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (value: T) => void; options: { value: T; label: string; icon?: Parameters<typeof Icon>[0]['name'] }[]; label: string }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map((option) => <button key={option.value} className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)} aria-pressed={value === option.value}>{option.icon && <Icon name={option.icon} size={15} />}{option.label}</button>)}</div>;
}

export function Modal({ open, onClose, title, eyebrow, children, wide = false }: { open: boolean; onClose: () => void; title: string; eyebrow?: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header className="modal-header"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id="modal-title">{title}</h2></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></Button></header>
      <div className="modal-body">{children}</div>
    </section>
  </div>;
}

export function EmptyState({ icon, title, detail, action }: { icon: Parameters<typeof Icon>[0]['name']; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={26} /></span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return <div className="skeleton-stack" aria-label="Loading" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div className="skeleton-row" key={i}><span /><div><b /><i /></div></div>)}</div>;
}

export function Trend({ value, suffix = '%' }: { value: number | null; suffix?: string }) {
  if (value === null) return <span className="trend trend-neutral">No history</span>;
  const positive = value >= 0;
  return <span className={`trend ${positive ? 'trend-positive' : 'trend-negative'}`}><Icon name={positive ? 'arrow-up' : 'arrow-down'} size={14} />{positive ? '+' : ''}{value.toFixed(2)}{suffix}</span>;
}

export function PriceChart({ assets, market, period, compact = false }: { assets: DemoAsset[]; market: Market; period: Period; compact?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const points = useMemo(() => {
    const current = assets.reduce((sum, asset) => sum + (asset.quote[market] ?? 0) * asset.quantity, 0);
    const start = assets.reduce((sum, asset) => {
      const q = asset.quote[market], c = asset.change[market][period];
      return q === null ? sum : sum + (c === null ? q : q / (1 + c / 100)) * asset.quantity;
    }, 0);
    return [start, current];
  }, [assets, market, period]);
  const min = Math.min(...points) * 0.998;
  const max = Math.max(...points) * 1.002;
  const coords = points.map((value, i) => ({ x: (i / (points.length - 1)) * 1000, y: 260 - ((value - min) / Math.max(1, max - min)) * 220, value }));
  const line = coords.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L1000,280 L0,280 Z`;
  const active = coords[hover ?? coords.length - 1];
  const start = points[0];
  const pct = start ? ((active.value - start) / start) * 100 : 0;
  return <div className={`price-chart ${compact ? 'price-chart-compact' : ''}`} tabIndex={0} role="img" aria-label={`Portfolio chart. Current value ${formatMoney(points.at(-1) ?? 0, market)}. ${pct >= 0 ? 'Up' : 'Down'} ${Math.abs(pct).toFixed(2)} percent.`} onMouseLeave={() => setHover(null)} onMouseMove={(event) => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - box.left) / box.width) * (points.length - 1))));
    setHover(index);
  }}>
    <svg viewBox="0 0 1000 290" preserveAspectRatio="none" aria-hidden="true">
      {!compact && [40, 100, 160, 220].map((y) => <line key={y} x1="0" x2="1000" y1={y} y2={y} className="chart-gridline" />)}
      <defs><linearGradient id={`area-${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f0a36b" stopOpacity=".35"/><stop offset="1" stopColor="#f0a36b" stopOpacity="0"/></linearGradient></defs>
      <path d={area} fill={`url(#area-${id})`} />
      <path d={line} className="chart-line" vectorEffect="non-scaling-stroke" />
      {hover !== null && <><line x1={active.x} x2={active.x} y1="20" y2="278" className="chart-cursor" vectorEffect="non-scaling-stroke"/><circle cx={active.x} cy={active.y} r="7" className="chart-point" vectorEffect="non-scaling-stroke"/></>}
    </svg>
    {!compact && <div className="chart-tooltip" style={{ left: `${Math.min(74, Math.max(24, active.x / 10))}%` }}><span>{active.x === 0 ? `${period === '1D' ? '1-day' : period === '1W' ? '7-day' : '30-day'} average` : 'Current trend'} · {market === 'cardmarket' ? 'Cardmarket' : 'US market'}</span><strong>{formatMoney(active.value, market)}</strong><em className={pct >= 0 ? 'positive' : 'negative'}>{pct >= 0 ? '+' : ''}{formatMoney(active.value - start, market)} · {pct.toFixed(2)}%</em></div>}
  </div>;
}

export function Toggle({ checked, onChange, label, detail }: { checked: boolean; onChange: (checked: boolean) => void; label: string; detail?: string }) {
  return <label className="toggle-row"><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}
