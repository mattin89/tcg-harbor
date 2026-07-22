function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (key == null) continue;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

function candidateSummary(products, priceByProduct) {
  const candidates = products
    .map((product) => ({
      productId: Number(product.idProduct),
      trend: priceByProduct.get(Number(product.idProduct))?.trend ?? null,
    }))
    .sort((left, right) => left.productId - right.productId);
  const trends = candidates
    .map((candidate) => candidate.trend)
    .filter((trend) => Number.isFinite(trend) && trend >= 0);
  return {
    candidates,
    priceRange: {
      minimumTrend: trends.length > 0 ? Math.min(...trends) : null,
      maximumTrend: trends.length > 0 ? Math.max(...trends) : null,
      pricedCandidates: trends.length,
      totalCandidates: candidates.length,
    },
  };
}

/**
 * Matches Cardmarket products only when release + printed number leaves exactly
 * one unused product and one unused source printing. Existing independently
 * verified mappings are reserved first. Product ID order and price are never
 * used to infer Cardmarket V.1/V.2 artwork identity.
 */
export function matchCardmarketReleaseProducts({
  groupCode,
  expansionId,
  cards,
  products,
  priceByProduct,
  seededMatches = new Map(),
  usedProductIds = new Set(),
  cardIdentity,
  cardNumber,
  productNumber,
}) {
  const cardsByNumber = groupBy(cards, cardNumber);
  const productsByNumber = groupBy(products, productNumber);
  const exact = [];
  const ambiguous = [];
  const unavailable = [];
  const numbers = new Set([...cardsByNumber.keys(), ...productsByNumber.keys()]);

  for (const number of [...numbers].sort()) {
    const cardCandidates = (cardsByNumber.get(number) ?? [])
      .filter((card) => !seededMatches.has(cardIdentity(card)));
    const productCandidates = (productsByNumber.get(number) ?? [])
      .filter((product) => !usedProductIds.has(Number(product.idProduct)));
    if (cardCandidates.length === 0) continue;

    if (cardCandidates.length === 1 && productCandidates.length === 1) {
      const [card] = cardCandidates;
      const [product] = productCandidates;
      exact.push({
        identity: cardIdentity(card),
        card,
        number,
        groupCode,
        expansionId,
        product,
        price: priceByProduct.get(Number(product.idProduct)) ?? null,
        mappingEvidence: 'Unique source printing + unique Cardmarket product in the same proven English release and printed number',
      });
      continue;
    }

    if (productCandidates.length > 0) {
      const summary = candidateSummary(productCandidates, priceByProduct);
      for (const card of cardCandidates) {
        ambiguous.push({
          identity: cardIdentity(card),
          number,
          groupCode,
          expansionId,
          sourcePrintingCount: cardCandidates.length,
          reason: `Cardmarket exports ${productCandidates.length} possible product${productCandidates.length === 1 ? '' : 's'} for ${cardCandidates.length} source printing${cardCandidates.length === 1 ? '' : 's'} in this release, without artwork-version metadata.`,
          ...summary,
        });
      }
      continue;
    }

    for (const card of cardCandidates) {
      unavailable.push({
        identity: cardIdentity(card),
        number,
        groupCode,
        expansionId,
        reason: 'No unused Cardmarket product remains for this printing in the proven English release.',
      });
    }
  }

  return {
    exact,
    ambiguous,
    unavailable,
    stats: {
      exactMappings: exact.length,
      exactMappingsWithTrend: exact.filter((match) => match.price?.trend != null).length,
      ambiguousCardPrintings: ambiguous.length,
      unavailableCardPrintings: unavailable.length,
      ambiguousGroups: new Set(ambiguous.map((entry) => entry.number)).size,
    },
  };
}

function positiveProductId(value) {
  const productId = Number(value);
  return Number.isInteger(productId) && productId > 0 ? productId : null;
}

function activeContinuityApproval(approval, generatedAt) {
  if (!approval || typeof approval.reason !== 'string' || approval.reason.trim().length === 0) {
    return false;
  }
  const expiresAt = Date.parse(approval.expiresAt ?? '');
  const snapshotTime = Date.parse(generatedAt ?? '');
  return Number.isFinite(expiresAt)
    && Number.isFinite(snapshotTime)
    && expiresAt > snapshotTime;
}

/**
 * Prevents a daily catalog refresh from silently rebinding an already exact
 * card printing to another Cardmarket product (or dropping it). New exact
 * mappings are allowed. Every exception must name the old and new product ID,
 * carry a reason, and remain unexpired at the snapshot timestamp.
 */
export function assertCardmarketMappingContinuity({
  previousAssets = [],
  nextAssets = [],
  approvals = new Map(),
  generatedAt,
}) {
  const nextById = new Map(nextAssets.map((asset) => [asset.id, asset]));
  const violations = [];
  const approvedChanges = [];

  for (const previous of previousAssets) {
    if (previous.kind !== 'card') continue;
    const previousProductId = positiveProductId(previous.cardmarketProductId);
    if (previousProductId == null) continue;

    const nextProductId = positiveProductId(nextById.get(previous.id)?.cardmarketProductId);
    if (nextProductId === previousProductId) continue;

    const approval = approvals.get(previous.id);
    const approvalMatches = activeContinuityApproval(approval, generatedAt)
      && positiveProductId(approval.previousProductId) === previousProductId
      && (approval.nextProductId == null
        ? nextProductId == null
        : positiveProductId(approval.nextProductId) === nextProductId);
    const change = {
      assetId: previous.id,
      previousProductId,
      nextProductId,
    };
    if (approvalMatches) {
      approvedChanges.push({ ...change, reason: approval.reason, expiresAt: approval.expiresAt });
    } else {
      violations.push(change);
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Cardmarket exact-mapping continuity failed for ${violations.length} card printing(s): ${JSON.stringify(violations.slice(0, 20))}`,
    );
  }
  return approvedChanges;
}
