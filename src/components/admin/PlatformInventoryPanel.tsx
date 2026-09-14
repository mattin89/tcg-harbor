import { useEffect, useMemo, useState } from 'react';
import { catalogAssets, marketDataMeta, type DemoAsset } from '../../data/demo';
import { Icon } from '../Icon';
import {
  applyCatalogOverrides,
  clearAllAdminCatalogOverrides,
  diagnoseCatalogItem,
  exportCatalogOverridesJson,
  getAdminCatalogOverrides,
  importCatalogOverridesJson,
  resetAdminCatalogOverride,
  saveAdminCatalogOverride,
  type AdminCatalogOverride,
  type CatalogItemIssue,
} from '../../services/adminCatalogStore';
import type { ProductionAccessController } from '../../production';

type TabMode = 'all' | 'cards' | 'sealed' | 'flagged' | 'overrides';

interface PlatformInventoryPanelProps {
  access?: ProductionAccessController;
}

export function PlatformInventoryPanel({ access: _access }: PlatformInventoryPanelProps) {
  const [overrides, setOverrides] = useState<Record<string, AdminCatalogOverride>>(() => getAdminCatalogOverrides());
  const [activeTab, setActiveTab] = useState<TabMode>('all');
  const [issueFilter, setIssueFilter] = useState<'all' | CatalogItemIssue>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const [editingAsset, setEditingAsset] = useState<DemoAsset | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Sync state if storage changes
  useEffect(() => {
    const handleUpdate = () => setOverrides(getAdminCatalogOverrides());
    window.addEventListener('tcg-harbor:catalog-updated', handleUpdate);
    return () => window.removeEventListener('tcg-harbor:catalog-updated', handleUpdate);
  }, []);

  // Quick auto-dismiss toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const flaggedAssetIds = useMemo(() => {
    const ids = new Set<string>();
    const changes = (marketDataMeta as unknown as { crossMarketCoverage?: { flaggedMappingChanges?: Array<{ assetId?: string }> } })
      ?.crossMarketCoverage?.flaggedMappingChanges;
    if (Array.isArray(changes)) {
      for (const change of changes) {
        if (change?.assetId) ids.add(change.assetId);
      }
    }
    return ids;
  }, []);

  const activeCatalog = useMemo(() => {
    return applyCatalogOverrides(catalogAssets, overrides);
  }, [overrides]);

  const diagnosticsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof diagnoseCatalogItem>>();
    for (const asset of activeCatalog) {
      map.set(asset.id, diagnoseCatalogItem(asset, flaggedAssetIds));
    }
    return map;
  }, [activeCatalog, flaggedAssetIds]);

  const counts = useMemo(() => {
    let cards = 0;
    let sealed = 0;
    let flagged = 0;
    for (const asset of activeCatalog) {
      if (asset.kind === 'card') cards++;
      if (asset.kind === 'sealed') sealed++;
      if (diagnosticsMap.get(asset.id)?.isFlaggedOrError) flagged++;
    }
    return {
      total: activeCatalog.length,
      cards,
      sealed,
      flagged,
      overrides: Object.keys(overrides).length,
    };
  }, [activeCatalog, diagnosticsMap, overrides]);

  const filteredAssets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return activeCatalog.filter((asset) => {
      // Tab filter
      if (activeTab === 'cards' && asset.kind !== 'card') return false;
      if (activeTab === 'sealed' && asset.kind !== 'sealed') return false;
      if (activeTab === 'overrides' && !overrides[asset.id]) return false;
      if (activeTab === 'flagged') {
        const diag = diagnosticsMap.get(asset.id);
        if (!diag?.isFlaggedOrError) return false;
        if (issueFilter !== 'all' && !diag.issues.includes(issueFilter)) return false;
      }

      // Query filter
      if (!query) return true;

      const nameMatch = asset.name.toLowerCase().includes(query) || (asset.productName && asset.productName.toLowerCase().includes(query));
      const setMatch = asset.setCode.toLowerCase().includes(query) || asset.set.toLowerCase().includes(query);
      const numMatch = asset.number?.toLowerCase().includes(query) || asset.rulesCardId?.toLowerCase().includes(query);
      const variantMatch = asset.variant ? asset.variant.toLowerCase().includes(query) : false;
      const cmMatch = asset.cardmarketProductId ? String(asset.cardmarketProductId).includes(query) : false;
      const tcgMatch = asset.tcgplayerProductId ? String(asset.tcgplayerProductId).includes(query) : false;

      return nameMatch || setMatch || numMatch || variantMatch || cmMatch || tcgMatch;
    });
  }, [activeCatalog, activeTab, issueFilter, searchQuery, overrides, diagnosticsMap]);

  // Reset pagination on filter change
  useEffect(() => {
    setPage(1);
  }, [activeTab, issueFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
  const currentPageAssets = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAssets.slice(start, start + pageSize);
  }, [filteredAssets, page, pageSize]);

  const handleExportJson = () => {
    const json = exportCatalogOverridesJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tcg-harbor-catalog-overrides-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setToastMessage('Exported overrides JSON to download.');
  };

  const handleImportSubmit = () => {
    const res = importCatalogOverridesJson(importText);
    if (res.error) {
      setImportStatus(`Error: ${res.error}`);
    } else {
      setImportStatus(null);
      setImportModalOpen(false);
      setImportText('');
      setOverrides(getAdminCatalogOverrides());
      setToastMessage(`Successfully imported ${res.imported} catalog override(s).`);
    }
  };

  const handleClearAllOverrides = () => {
    if (!window.confirm('Reset all catalog overrides back to clean upstream baseline? This cannot be undone.')) {
      return;
    }
    clearAllAdminCatalogOverrides();
    setOverrides({});
    setToastMessage('Cleared all catalog overrides.');
  };

  return (
    <section className="production-panel production-inventory-panel">
      <header className="production-panel-header">
        <div>
          <p className="production-eyebrow">Platform inventory administration</p>
          <h2>Catalog & Diagnostic Management</h2>
          <p>
            Browse all individual cards and sealed products, audit items causing errors or discrepancies,
            and push live overrides directly to the catalog.
          </p>
        </div>
        <div className="production-header-actions">
          <button type="button" className="production-secondary" onClick={handleExportJson}>
            <Icon name="download" size={15} />
            <span>Export JSON</span>
          </button>
          <button type="button" className="production-secondary" onClick={() => { setImportModalOpen(true); setImportStatus(null); }}>
            <Icon name="upload" size={15} />
            <span>Import JSON</span>
          </button>
          {counts.overrides > 0 && (
            <button type="button" className="production-reject" onClick={handleClearAllOverrides}>
              <Icon name="trash" size={15} />
              <span>Reset All ({counts.overrides})</span>
            </button>
          )}
        </div>
      </header>

      {toastMessage && (
        <div className="production-inventory-toast" role="status">
          <Icon name="check" size={16} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Metrics Row */}
      <div className="production-inventory-metrics">
        <button
          type="button"
          className={`production-metric-tile ${activeTab === 'all' ? 'is-selected' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          <span className="production-metric-number">{counts.total.toLocaleString()}</span>
          <span className="production-metric-label">Total catalog items</span>
        </button>
        <button
          type="button"
          className={`production-metric-tile ${activeTab === 'cards' ? 'is-selected' : ''}`}
          onClick={() => setActiveTab('cards')}
        >
          <span className="production-metric-number">{counts.cards.toLocaleString()}</span>
          <span className="production-metric-label">Individual cards</span>
        </button>
        <button
          type="button"
          className={`production-metric-tile ${activeTab === 'sealed' ? 'is-selected' : ''}`}
          onClick={() => setActiveTab('sealed')}
        >
          <span className="production-metric-number">{counts.sealed.toLocaleString()}</span>
          <span className="production-metric-label">Sealed products</span>
        </button>
        <button
          type="button"
          className={`production-metric-tile is-flagged ${activeTab === 'flagged' ? 'is-selected' : ''}`}
          onClick={() => { setActiveTab('flagged'); setIssueFilter('all'); }}
        >
          <span className="production-metric-number">{counts.flagged.toLocaleString()}</span>
          <span className="production-metric-label">Items with flags / errors</span>
        </button>
        <button
          type="button"
          className={`production-metric-tile is-overridden ${activeTab === 'overrides' ? 'is-selected' : ''}`}
          onClick={() => setActiveTab('overrides')}
        >
          <span className="production-metric-number">{counts.overrides.toLocaleString()}</span>
          <span className="production-metric-label">Live admin overrides</span>
        </button>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="production-inventory-toolbar">
        <div className="production-inventory-tabs" role="tablist">
          <button
            type="button"
            className={`production-inventory-tab ${activeTab === 'all' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All items ({counts.total})
          </button>
          <button
            type="button"
            className={`production-inventory-tab ${activeTab === 'cards' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('cards')}
          >
            Cards ({counts.cards})
          </button>
          <button
            type="button"
            className={`production-inventory-tab ${activeTab === 'sealed' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('sealed')}
          >
            Sealed ({counts.sealed})
          </button>
          <button
            type="button"
            className={`production-inventory-tab is-error ${activeTab === 'flagged' ? 'is-active' : ''}`}
            onClick={() => { setActiveTab('flagged'); setIssueFilter('all'); }}
          >
            <Icon name="shield" size={14} />
            Flags & Errors ({counts.flagged})
          </button>
          {counts.overrides > 0 && (
            <button
              type="button"
              className={`production-inventory-tab is-live ${activeTab === 'overrides' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('overrides')}
            >
              <Icon name="sparkle" size={14} />
              Pushed Live ({counts.overrides})
            </button>
          )}
        </div>

        <label className="production-search-field">
          <Icon name="search" size={15} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search card name, number, set code, Cardmarket ID, TCGplayer ID…"
          />
          {searchQuery && (
            <button type="button" className="production-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
              <Icon name="close" size={14} />
            </button>
          )}
        </label>
      </div>

      {/* Sub-filters when Flagged & Errors tab is active */}
      {activeTab === 'flagged' && (
        <div className="production-subfilter-chips">
          <span className="production-subfilter-label">Filter issue kind:</span>
          {(['all', 'unmapped-cardmarket', 'missing-image', 'ambiguous-artwork', 'trend-unavailable', 'price-unavailable', 'continuity-flagged'] as const).map((issue) => (
            <button
              key={issue}
              type="button"
              className={`production-chip ${issueFilter === issue ? 'is-active' : ''}`}
              onClick={() => setIssueFilter(issue)}
            >
              {issue === 'all' && 'All Issues'}
              {issue === 'unmapped-cardmarket' && 'Unmapped Cardmarket'}
              {issue === 'missing-image' && 'Missing Image'}
              {issue === 'ambiguous-artwork' && 'Ambiguous Artwork'}
              {issue === 'trend-unavailable' && 'Trend Unavailable'}
              {issue === 'price-unavailable' && 'Price Unavailable'}
              {issue === 'continuity-flagged' && 'Continuity Discrepancy'}
            </button>
          ))}
        </div>
      )}

      {/* Table Results */}
      {filteredAssets.length === 0 ? (
        <div className="production-empty">
          <Icon name="cards" size={32} />
          <h3>No matching items found</h3>
          <p>Try refining your search terms or selecting a different filter tab.</p>
        </div>
      ) : (
        <>
          <div className="production-inventory-table-wrap">
            <table className="production-inventory-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Art</th>
                  <th>Item / Product</th>
                  <th>Set & Number</th>
                  <th>Cardmarket Info</th>
                  <th>TCGplayer Info</th>
                  <th>Diagnostics / Status</th>
                  <th style={{ width: '130px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {currentPageAssets.map((asset) => {
                  const diag = diagnosticsMap.get(asset.id);
                  const isOverridden = Boolean(overrides[asset.id]);

                  return (
                    <tr key={asset.id} className={diag?.isFlaggedOrError ? 'has-issue' : ''}>
                      <td className="cell-art">
                        <div className="production-art-thumb">
                          {asset.imageUrl ? (
                            <img
                              src={asset.imageUrl}
                              alt={asset.name}
                              loading="lazy"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none';
                                (e.currentTarget.parentElement?.querySelector('.art-fallback') as HTMLElement)?.removeAttribute('style');
                              }}
                            />
                          ) : null}
                          <div className="art-fallback" style={asset.imageUrl ? { display: 'none' } : undefined}>
                            <Icon name={asset.kind === 'sealed' ? 'box' : 'cards'} size={20} />
                          </div>
                        </div>
                      </td>

                      <td className="cell-info">
                        <strong>{asset.name}</strong>
                        {asset.productName && asset.productName !== asset.name && (
                          <small className="sub-name">{asset.productName}</small>
                        )}
                        <div className="cell-meta-badges">
                          <span className="badge-pill">{asset.kind}</span>
                          {asset.rarity && <span className="badge-pill">{asset.rarity}</span>}
                          {asset.variant && <span className="badge-pill variant">{asset.variant}</span>}
                        </div>
                      </td>

                      <td className="cell-set">
                        <span className="set-code">{asset.setCode}</span>
                        <small className="set-name">{asset.set}</small>
                        {asset.number && <span className="card-number">{asset.number}</span>}
                      </td>

                      <td className="cell-market">
                        <div className="market-row">
                          <span className="market-label">ID:</span>
                          <strong>{asset.cardmarketProductId ?? '—'}</strong>
                        </div>
                        <div className="market-row">
                          <span className="market-label">Trend:</span>
                          <span>{asset.quote.cardmarket != null ? `€${asset.quote.cardmarket.toFixed(2)}` : '—'}</span>
                        </div>
                        <span className={`state-badge state-${asset.cardmarketPriceState ?? 'unknown'}`}>
                          {asset.cardmarketPriceState ?? 'unmapped'}
                        </span>
                      </td>

                      <td className="cell-market">
                        <div className="market-row">
                          <span className="market-label">ID:</span>
                          <strong>{asset.tcgplayerProductId ?? '—'}</strong>
                        </div>
                        <div className="market-row">
                          <span className="market-label">Price:</span>
                          <span>{asset.quote.tcgplayer != null ? `$${asset.quote.tcgplayer.toFixed(2)}` : '—'}</span>
                        </div>
                        <span className={`state-badge state-${asset.tcgplayerPriceState ?? 'unknown'}`}>
                          {asset.tcgplayerPriceState ?? 'unknown'}
                        </span>
                      </td>

                      <td className="cell-diagnostics">
                        {isOverridden && (
                          <span className="diag-tag is-live" title="Active admin override pushed live">
                            <Icon name="check" size={12} /> Live Override
                          </span>
                        )}
                        {diag?.issues.map((issue) => (
                          <span key={issue} className={`diag-tag is-${issue}`}>
                            {issue === 'unmapped-cardmarket' && 'Unmapped Cardmarket'}
                            {issue === 'missing-image' && 'Missing Image'}
                            {issue === 'ambiguous-artwork' && 'Ambiguous Art'}
                            {issue === 'trend-unavailable' && 'No EUR Trend'}
                            {issue === 'price-unavailable' && 'No USD Price'}
                            {issue === 'continuity-flagged' && 'Continuity Discrepancy'}
                          </span>
                        ))}
                        {!isOverridden && (!diag || !diag.isFlaggedOrError) && (
                          <span className="diag-tag is-healthy">
                            <Icon name="check" size={12} /> Verified
                          </span>
                        )}
                      </td>

                      <td className="cell-actions">
                        <button
                          type="button"
                          className="production-primary btn-edit"
                          onClick={() => setEditingAsset(asset)}
                        >
                          <Icon name="edit" size={14} />
                          <span>Edit</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="production-inventory-pagination">
            <span className="pagination-summary">
              Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredAssets.length)} of {filteredAssets.length.toLocaleString()} items
            </span>
            <div className="pagination-controls">
              <button
                type="button"
                className="production-secondary"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="pagination-current">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="production-secondary"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Edit & Push Live Modal */}
      {editingAsset && (
        <InventoryEditModal
          asset={editingAsset}
          existingOverride={overrides[editingAsset.id]}
          onClose={() => setEditingAsset(null)}
          onSave={(override) => {
            saveAdminCatalogOverride(override);
            setOverrides(getAdminCatalogOverrides());
            setEditingAsset(null);
            setToastMessage(`Pushed live: "${override.name || editingAsset.name}" updated in catalog.`);
          }}
          onReset={(id) => {
            resetAdminCatalogOverride(id);
            setOverrides(getAdminCatalogOverrides());
            setEditingAsset(null);
            setToastMessage(`Reverted: "${editingAsset.name}" restored to baseline data.`);
          }}
        />
      )}

      {/* Import Modal */}
      {importModalOpen && (
        <div className="production-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setImportModalOpen(false); }}>
          <div className="production-modal-dialog" role="dialog" aria-labelledby="import-modal-heading">
            <header className="production-modal-header">
              <div>
                <p className="production-eyebrow">Batch configuration</p>
                <h2 id="import-modal-heading">Import Catalog Overrides</h2>
                <p>Paste a valid JSON object of catalog overrides to apply them in bulk.</p>
              </div>
              <button type="button" className="production-modal-close" onClick={() => setImportModalOpen(false)} aria-label="Close">
                <Icon name="close" size={18} />
              </button>
            </header>

            <div className="production-form">
              {importStatus && <div className="production-error-banner">{importStatus}</div>}
              <label className="production-field">
                <span>Overrides JSON</span>
                <textarea
                  rows={10}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="Paste JSON object here..."
                  style={{ fontFamily: 'monospace', fontSize: '12px' }}
                />
              </label>
              <footer className="production-modal-actions">
                <button type="button" className="production-secondary" onClick={() => setImportModalOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="production-primary" onClick={handleImportSubmit} disabled={!importText.trim()}>
                  <Icon name="upload" size={15} />
                  <span>Import & Apply</span>
                </button>
              </footer>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface InventoryEditModalProps {
  asset: DemoAsset;
  existingOverride?: AdminCatalogOverride;
  onClose: () => void;
  onSave: (override: AdminCatalogOverride) => void;
  onReset: (id: string) => void;
}

function InventoryEditModal({ asset, existingOverride, onClose, onSave, onReset }: InventoryEditModalProps) {
  const [name, setName] = useState(existingOverride?.name ?? asset.name);
  const [productName, setProductName] = useState(existingOverride?.productName ?? asset.productName ?? '');
  const [setCode, setSetCode] = useState(existingOverride?.setCode ?? asset.setCode);
  const [setNameText, setSetNameText] = useState(existingOverride?.set ?? asset.set);
  const [number, setNumber] = useState(existingOverride?.number ?? asset.number ?? '');
  const [rulesCardId, setRulesCardId] = useState(existingOverride?.rulesCardId ?? asset.rulesCardId ?? '');
  const [variant, setVariant] = useState(existingOverride?.variant ?? asset.variant ?? '');
  const [rarity, setRarity] = useState(existingOverride?.rarity ?? asset.rarity ?? '');
  const [language, setLanguage] = useState(existingOverride?.language ?? asset.language ?? 'English');

  const [imageUrl, setImageUrl] = useState(existingOverride?.imageUrl ?? asset.imageUrl ?? '');
  const [imageState, setImageState] = useState<'available' | 'unavailable'>(existingOverride?.imageState ?? asset.imageState ?? 'available');

  const [cardmarketProductId, setCardmarketProductId] = useState<string>(
    existingOverride?.cardmarketProductId !== undefined
      ? String(existingOverride.cardmarketProductId ?? '')
      : String(asset.cardmarketProductId ?? '')
  );
  const [cardmarketExpansionId, setCardmarketExpansionId] = useState<string>(
    existingOverride?.cardmarketExpansionId !== undefined
      ? String(existingOverride.cardmarketExpansionId ?? '')
      : String(asset.cardmarketExpansionId ?? '')
  );
  const [cardmarketPriceState, setCardmarketPriceState] = useState(
    existingOverride?.cardmarketPriceState ?? asset.cardmarketPriceState ?? 'available'
  );
  const [cardmarketPriceReason, setCardmarketPriceReason] = useState(
    existingOverride?.cardmarketPriceReason ?? asset.cardmarketPriceReason ?? ''
  );
  const [cardmarketTrendPrice, setCardmarketTrendPrice] = useState<string>(
    existingOverride?.cardmarketTrendPrice !== undefined && existingOverride.cardmarketTrendPrice !== null
      ? String(existingOverride.cardmarketTrendPrice)
      : asset.quote.cardmarket !== null
      ? String(asset.quote.cardmarket)
      : ''
  );

  const [tcgplayerProductId, setTcgplayerProductId] = useState<string>(
    existingOverride?.tcgplayerProductId !== undefined
      ? String(existingOverride.tcgplayerProductId ?? '')
      : String(asset.tcgplayerProductId ?? '')
  );
  const [tcgplayerMarketPrice, setTcgplayerMarketPrice] = useState<string>(
    existingOverride?.tcgplayerMarketPrice !== undefined && existingOverride.tcgplayerMarketPrice !== null
      ? String(existingOverride.tcgplayerMarketPrice)
      : asset.quote.tcgplayer !== null
      ? String(asset.quote.tcgplayer)
      : ''
  );

  const [errorResolved, setErrorResolved] = useState(true);
  const [adminNote, setAdminNote] = useState(existingOverride?.adminNote ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const override: AdminCatalogOverride = {
      id: asset.id,
      name: name.trim(),
      productName: productName.trim() || undefined,
      setCode: setCode.trim(),
      set: setNameText.trim(),
      number: number.trim() || undefined,
      rulesCardId: rulesCardId.trim() || undefined,
      variant: variant.trim() || undefined,
      rarity: rarity.trim() || undefined,
      language: language.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
      imageState: errorResolved && imageUrl.trim() ? 'available' : imageState,
      cardmarketProductId: cardmarketProductId ? Number(cardmarketProductId) : null,
      cardmarketExpansionId: cardmarketExpansionId ? Number(cardmarketExpansionId) : null,
      cardmarketPriceState: errorResolved && cardmarketProductId ? 'available' : cardmarketPriceState,
      cardmarketPriceReason: cardmarketPriceReason.trim() || undefined,
      cardmarketTrendPrice: cardmarketTrendPrice ? Number(cardmarketTrendPrice) : null,
      tcgplayerProductId: tcgplayerProductId ? Number(tcgplayerProductId) : null,
      tcgplayerMarketPrice: tcgplayerMarketPrice ? Number(tcgplayerMarketPrice) : null,
      errorResolved,
      adminNote: adminNote.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };

    onSave(override);
  };

  return (
    <div className="production-modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="production-modal-dialog production-modal-dialog-wide" role="dialog" aria-labelledby="inventory-edit-title">
        <header className="production-modal-header">
          <div>
            <p className="production-eyebrow">Catalog editor & live publisher</p>
            <h2 id="inventory-edit-title">Edit Entry: {asset.name}</h2>
            <p>Update metadata, correct image URLs, assign Cardmarket mappings, and resolve diagnostic errors.</p>
          </div>
          <button type="button" className="production-modal-close" onClick={onClose} aria-label="Close dialog">
            <Icon name="close" size={18} />
          </button>
        </header>

        <form className="production-form" onSubmit={handleSubmit}>
          {/* Top visual summary */}
          <div className="production-edit-card-preview">
            <div className="preview-image-box">
              {imageUrl ? (
                <img src={imageUrl} alt="Card preview" />
              ) : (
                <div className="preview-placeholder">
                  <Icon name="cards" size={32} />
                  <span>No image URL</span>
                </div>
              )}
            </div>
            <div className="preview-details">
              <span className="preview-asset-id">Internal ID: {asset.id}</span>
              <h3>{name || 'Untitled Item'}</h3>
              <p>{setCode} · {number || 'No number'} · {rarity || 'Unspecified rarity'}</p>
              <div className="preview-states">
                <span className={`state-badge state-${errorResolved && cardmarketProductId ? 'available' : cardmarketPriceState}`}>
                  Cardmarket: {errorResolved && cardmarketProductId ? 'available' : cardmarketPriceState}
                </span>
                <span className={`state-badge state-${errorResolved && imageUrl ? 'available' : imageState}`}>
                  Image: {errorResolved && imageUrl ? 'available' : imageState}
                </span>
              </div>
            </div>
          </div>

          {/* Section: Basic Info */}
          <fieldset>
            <legend>Item & Card Metadata</legend>
            <div className="production-form-grid">
              <label className="production-field">
                <span>Display Name *</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label className="production-field">
                <span>Product Name</span>
                <input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Full catalog title" />
              </label>
              <label className="production-field">
                <span>Set Code *</span>
                <input value={setCode} onChange={(e) => setSetCode(e.target.value)} required />
              </label>
              <label className="production-field">
                <span>Set Name *</span>
                <input value={setNameText} onChange={(e) => setSetNameText(e.target.value)} required />
              </label>
              <label className="production-field">
                <span>Card Number / ID</span>
                <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. OP01-001 or P-041" />
              </label>
              <label className="production-field">
                <span>Rules Card ID</span>
                <input value={rulesCardId} onChange={(e) => setRulesCardId(e.target.value)} placeholder="e.g. OP01-001" />
              </label>
              <label className="production-field">
                <span>Variant</span>
                <input value={variant} onChange={(e) => setVariant(e.target.value)} placeholder="Standard, Parallel, Manga, etc." />
              </label>
              <label className="production-field">
                <span>Rarity</span>
                <input value={rarity} onChange={(e) => setRarity(e.target.value)} placeholder="C, UC, R, SR, SEC, L, PR" />
              </label>
            </div>
          </fieldset>

          {/* Section: Image Details */}
          <fieldset>
            <legend>Image Configuration</legend>
            <div className="production-form-grid">
              <label className="production-field" style={{ gridColumn: 'span 2' }}>
                <span>Image URL / Asset Path</span>
                <input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://... or /catalog/cards/P-..."
                />
              </label>
              <label className="production-field">
                <span>Image State</span>
                <select value={imageState} onChange={(e) => setImageState(e.target.value as 'available' | 'unavailable')}>
                  <option value="available">available</option>
                  <option value="unavailable">unavailable</option>
                </select>
              </label>
            </div>
          </fieldset>

          {/* Section: Cardmarket Mapping & Price */}
          <fieldset>
            <legend>Cardmarket Provider Details</legend>
            <div className="production-form-grid">
              <label className="production-field">
                <span>Cardmarket Product ID</span>
                <input
                  type="number"
                  value={cardmarketProductId}
                  onChange={(e) => setCardmarketProductId(e.target.value)}
                  placeholder="e.g. 906851"
                />
              </label>
              <label className="production-field">
                <span>Cardmarket Expansion ID</span>
                <input
                  type="number"
                  value={cardmarketExpansionId}
                  onChange={(e) => setCardmarketExpansionId(e.target.value)}
                  placeholder="e.g. 5262"
                />
              </label>
              <label className="production-field">
                <span>Price State</span>
                <select
                  value={cardmarketPriceState}
                  onChange={(e) => setCardmarketPriceState(e.target.value as any)}
                >
                  <option value="available">available</option>
                  <option value="trend-unavailable">trend-unavailable</option>
                  <option value="ambiguous-artwork">ambiguous-artwork</option>
                  <option value="unmapped">unmapped</option>
                  <option value="not-listed">not-listed</option>
                </select>
              </label>
              <label className="production-field">
                <span>Trend Price (EUR €)</span>
                <input
                  type="number"
                  step="0.01"
                  value={cardmarketTrendPrice}
                  onChange={(e) => setCardmarketTrendPrice(e.target.value)}
                  placeholder="45.00"
                />
              </label>
              <label className="production-field" style={{ gridColumn: 'span 2' }}>
                <span>Price Reason / Explanation</span>
                <input
                  value={cardmarketPriceReason}
                  onChange={(e) => setCardmarketPriceReason(e.target.value)}
                  placeholder="Reason for price state or mapping source notes"
                />
              </label>
            </div>
          </fieldset>

          {/* Section: TCGplayer Mapping & Price */}
          <fieldset>
            <legend>TCGplayer Provider Details</legend>
            <div className="production-form-grid">
              <label className="production-field">
                <span>TCGplayer Product ID</span>
                <input
                  type="number"
                  value={tcgplayerProductId}
                  onChange={(e) => setTcgplayerProductId(e.target.value)}
                  placeholder="e.g. 518392"
                />
              </label>
              <label className="production-field">
                <span>Market Price (USD $)</span>
                <input
                  type="number"
                  step="0.01"
                  value={tcgplayerMarketPrice}
                  onChange={(e) => setTcgplayerMarketPrice(e.target.value)}
                  placeholder="52.00"
                />
              </label>
            </div>
          </fieldset>

          {/* Section: Diagnostic Resolution & Notes */}
          <fieldset>
            <legend>Audit & Resolution</legend>
            <div className="production-form-grid">
              <label className="production-checkbox-field" style={{ gridColumn: 'span 2' }}>
                <input
                  type="checkbox"
                  checked={errorResolved}
                  onChange={(e) => setErrorResolved(e.target.checked)}
                />
                <span>
                  <strong>Mark Diagnostic Errors as Resolved</strong>
                  <small>Promotes item out of error lists and marks price & image states as available</small>
                </span>
              </label>
              <label className="production-field" style={{ gridColumn: 'span 2' }}>
                <span>Admin Audit Note</span>
                <input
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  placeholder="Describe fix or manual verification reason..."
                />
              </label>
            </div>
          </fieldset>

          <footer className="production-modal-actions">
            {existingOverride && (
              <button
                type="button"
                className="production-reject"
                onClick={() => onReset(asset.id)}
              >
                <Icon name="trash" size={15} />
                <span>Revert to Baseline</span>
              </button>
            )}
            <button type="button" className="production-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="production-primary">
              <Icon name="check" size={16} />
              <span>Save & Push Live</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
