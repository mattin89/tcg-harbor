function positiveInteger(value) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizedCatalogSetCode(value) {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '');
  return normalized
    .replace(/^(OP|ST|EB|PRB)-(\d{1,2})$/, (_match, prefix, ordinal) =>
      `${prefix}${String(ordinal).padStart(2, '0')}`)
    .replace(/^(OP|ST|EB|PRB)(\d)$/, (_match, prefix, ordinal) =>
      `${prefix}0${ordinal}`);
}

function validReleasedSetCode(value) {
  return /^(?:(?:OP|ST|EB|PRB)\d{2}|OP\d{2}-EB\d{2})$/.test(value);
}

function normalizedEvidenceSetCode(value, source) {
  if (value == null) return null;
  const normalized = normalizedCatalogSetCode(value);
  if (!validReleasedSetCode(normalized)) {
    throw new Error(`Invalid ${source} sealed-set evidence ${String(value)}.`);
  }
  return normalized;
}

export function normalizedDeckProductTitleV1(value) {
  const withoutSetCode = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\[ST-?\d{2}\]/gi, '');
  const withoutStarterPrefix = withoutSetCode.replace(/^\s*starter\s+deck\b/i, '');
  const withoutExMarker = withoutStarterPrefix.replace(
    /^\s*[:\-]?\s*EX\b\s*[:\-]?\s*/,
    '',
  );
  return withoutExMarker
    .replace(/^\s*[:\-]\s*/, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

export function buildReleasedSealedSetCodeByExpansionV1(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('Released sealed-set expansion evidence must be an array.');
  }
  const byExpansion = new Map();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TypeError('Released sealed-set expansion evidence requires [setCode, idExpansion] pairs.');
    }
    const setCode = normalizedCatalogSetCode(entry[0]);
    const idExpansion = positiveInteger(entry[1]);
    if (!validReleasedSetCode(setCode) || idExpansion == null) {
      throw new Error(`Invalid released sealed-set expansion evidence ${String(entry[0])}/${String(entry[1])}.`);
    }
    const existing = byExpansion.get(idExpansion);
    if (existing && existing !== setCode) {
      throw new Error(
        `Cardmarket expansion ${idExpansion} maps to multiple released set codes: ${existing}, ${setCode}.`,
      );
    }
    byExpansion.set(idExpansion, setCode);
  }
  return byExpansion;
}

function explicitSetCodeFromProductName(value) {
  const match = String(value ?? '').match(/\b(OP|ST|EB|PRB)[-\s]?(\d{1,2})\b/i);
  return match
    ? normalizedCatalogSetCode(`${match[1]}${match[2].padStart(2, '0')}`)
    : null;
}

function compatibleCompositeAndMemberSetCodes(setCodes) {
  const compositeSetCodes = setCodes.filter((setCode) => setCode.includes('-'));
  const memberSetCodes = setCodes.filter((setCode) => !setCode.includes('-'));
  if (compositeSetCodes.length !== 1 || memberSetCodes.length !== 1) return false;
  const compositeMembers = compositeSetCodes[0].match(/(?:OP|ST|EB|PRB)\d{2}/g) ?? [];
  return compositeMembers.includes(memberSetCodes[0]);
}

export function resolveSealedSetCodeV1({
  product,
  category,
  exactSetCodeOverrides = new Map(),
  officialDeckSetCodesByTitle = new Map(),
  releasedSetCodeByExpansionId = new Map(),
}) {
  const productId = positiveInteger(product?.idProduct);
  const idExpansion = positiveInteger(product?.idExpansion);
  const exactOverride = productId == null
    ? null
    : normalizedEvidenceSetCode(
      exactSetCodeOverrides.get(productId),
      'exact product override',
    );
  const explicitSetCode = explicitSetCodeFromProductName(product?.name);
  const expansionSetCode = idExpansion == null
    ? null
    : normalizedEvidenceSetCode(
      releasedSetCodeByExpansionId.get(idExpansion),
      'released Cardmarket expansion',
    );
  const titleSetCode = category?.productType === 'Preconstructed deck'
    ? normalizedEvidenceSetCode(
      officialDeckSetCodesByTitle.get(normalizedDeckProductTitleV1(product?.name)),
      'exact official deck title',
    )
    : null;
  const evidence = [
    ['exact product override', exactOverride],
    ['explicit product title', explicitSetCode],
    ['released Cardmarket expansion', expansionSetCode],
    ['exact official deck title', titleSetCode],
  ].filter(([, setCode]) => setCode);
  const distinctSetCodes = [...new Set(evidence.map(([, setCode]) => setCode))];
  if (
    distinctSetCodes.length > 1
    && !compatibleCompositeAndMemberSetCodes(distinctSetCodes)
  ) {
    throw new Error(
      `Sealed product ${productId ?? 'unknown'} has conflicting set evidence: ${evidence
        .map(([source, setCode]) => `${source}=${setCode}`)
        .join(', ')}.`,
    );
  }
  return exactOverride
    ?? explicitSetCode
    ?? titleSetCode
    ?? expansionSetCode
    ?? category?.setCode
    ?? 'SEALED';
}
