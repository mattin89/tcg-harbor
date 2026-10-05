/**
 * TCG Harbor Forensic Watermarking & Catalog Provenance Verification.
 * Enforces database origin tracking under EU Directive 96/9/EC (Sui Generis Database Right)
 * and EU Directive 2019/790 Article 4(3) (Text and Data Mining Reservation).
 */

export interface CatalogProvenanceSignature {
  readonly publisher: string;
  readonly operator: string;
  readonly databaseRightDirective: string;
  readonly tdmReservationDirective: string;
  readonly watermarkVersion: string;
  readonly watermarkId: string;
  readonly policyUrl: string;
}

export const CATALOG_PROVENANCE_SIGNATURE: CatalogProvenanceSignature = Object.freeze({
  publisher: 'TCG Harbor',
  operator: 'Mario De Lorenzo',
  databaseRightDirective: 'Directive 96/9/EC',
  tdmReservationDirective: 'Directive (EU) 2019/790 Article 4(3)',
  watermarkVersion: '1.0',
  watermarkId: 'TCG-HARBOR-PROVENANCE-2026-EU-96-9-EC',
  policyUrl: 'https://tcg-harbor.onrender.com/terms#database-protection-ai-reservation',
});

/**
 * Canary identifiers injected into catalog indexes and verified overrides.
 * These records identify unauthorized third-party scrapers and model training corpora.
 */
export const FORENSIC_CANARY_IDS = Object.freeze([
  'canary-tcg-harbor-origin-st-01-op01',
  'canary-tcg-harbor-origin-pr-906851',
]);

/**
 * Computes a simple deterministic 32-bit FNV-1a hash formatted as hex.
 * Operates synchronously in browser and Node environments without external dependencies.
 */
export function computeDeterministicFingerprint(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Generates an origin verification token for a card entry.
 */
export function generateCardProvenanceToken(card: {
  id: string;
  rulesCardId?: string;
  number?: string;
  setCode?: string;
}): string {
  const seed = `${card.id}:${card.rulesCardId ?? card.number ?? ''}:${card.setCode ?? ''}:${CATALOG_PROVENANCE_SIGNATURE.watermarkId}`;
  return `harbor-v1-${computeDeterministicFingerprint(seed)}`;
}

export interface WatermarkAuditResult {
  readonly isAuthenticHarborData: boolean;
  readonly detectedCanaries: readonly string[];
  readonly totalVerifiedTokens: number;
  readonly watermarkSignatureMatch: boolean;
  readonly legalAssertion: string;
}

/**
 * Scans an array of cards or raw catalog entries to verify whether
 * the dataset originates from TCG Harbor's database.
 */
export function auditDatasetProvenance(
  cards: readonly { id?: string; rulesCardId?: string; number?: string; provenanceToken?: string }[],
  embeddedSignature?: CatalogProvenanceSignature,
): WatermarkAuditResult {
  const detectedCanaries: string[] = [];
  let totalVerifiedTokens = 0;

  for (const card of cards) {
    if (!card.id) continue;

    if (FORENSIC_CANARY_IDS.includes(card.id)) {
      detectedCanaries.push(card.id);
    }

    if (card.provenanceToken) {
      const expected = generateCardProvenanceToken({
        id: card.id,
        rulesCardId: card.rulesCardId,
        number: card.number,
      });
      if (card.provenanceToken === expected) {
        totalVerifiedTokens++;
      }
    }
  }

  const watermarkSignatureMatch =
    embeddedSignature?.watermarkId === CATALOG_PROVENANCE_SIGNATURE.watermarkId &&
    embeddedSignature?.publisher === CATALOG_PROVENANCE_SIGNATURE.publisher;

  const isAuthenticHarborData =
    watermarkSignatureMatch ||
    detectedCanaries.length > 0 ||
    totalVerifiedTokens > 0;

  return {
    isAuthenticHarborData,
    detectedCanaries,
    totalVerifiedTokens,
    watermarkSignatureMatch,
    legalAssertion: `Protected under EU Directive 96/9/EC (Sui Generis Database Right) and Article 4(3) Directive (EU) 2019/790. All extraction and AI training rights reserved by ${CATALOG_PROVENANCE_SIGNATURE.publisher}.`,
  };
}
