import { describe, expect, it } from 'vitest';
import {
  auditDatasetProvenance,
  CATALOG_PROVENANCE_SIGNATURE,
  computeDeterministicFingerprint,
  FORENSIC_CANARY_IDS,
  generateCardProvenanceToken,
} from '../domain/catalogWatermark';

describe('catalog watermark and forensic provenance verification', () => {
  it('exposes valid provenance signature referencing EU database and TDM directives', () => {
    expect(CATALOG_PROVENANCE_SIGNATURE.publisher).toBe('TCG Harbor');
    expect(CATALOG_PROVENANCE_SIGNATURE.operator).toBe('Mario De Lorenzo');
    expect(CATALOG_PROVENANCE_SIGNATURE.databaseRightDirective).toContain('96/9/EC');
    expect(CATALOG_PROVENANCE_SIGNATURE.tdmReservationDirective).toContain('2019/790');
    expect(CATALOG_PROVENANCE_SIGNATURE.policyUrl).toContain('/terms#database-protection-ai-reservation');
  });

  it('generates deterministic card provenance tokens', () => {
    const cardA = { id: 'card-op01-001', rulesCardId: 'OP01-001', setCode: 'OP01' };
    const cardB = { id: 'card-op01-001', rulesCardId: 'OP01-001', setCode: 'OP01' };
    const cardC = { id: 'card-op01-002', rulesCardId: 'OP01-002', setCode: 'OP01' };

    const tokenA = generateCardProvenanceToken(cardA);
    const tokenB = generateCardProvenanceToken(cardB);
    const tokenC = generateCardProvenanceToken(cardC);

    expect(tokenA).toMatch(/^harbor-v1-[0-9a-f]{8}$/);
    expect(tokenA).toBe(tokenB);
    expect(tokenA).not.toBe(tokenC);
  });

  it('detects forensic canaries and embedded tokens in a scraped catalog sample', () => {
    const scrapedDataset = [
      {
        id: 'card-op01-001',
        rulesCardId: 'OP01-001',
        provenanceToken: generateCardProvenanceToken({ id: 'card-op01-001', rulesCardId: 'OP01-001' }),
      },
      {
        id: FORENSIC_CANARY_IDS[0],
      },
      {
        id: 'generic-third-party-entry',
      },
    ];

    const audit = auditDatasetProvenance(scrapedDataset, CATALOG_PROVENANCE_SIGNATURE);

    expect(audit.isAuthenticHarborData).toBe(true);
    expect(audit.watermarkSignatureMatch).toBe(true);
    expect(audit.detectedCanaries).toEqual([FORENSIC_CANARY_IDS[0]]);
    expect(audit.totalVerifiedTokens).toBe(1);
    expect(audit.legalAssertion).toContain('Directive 96/9/EC');
    expect(audit.legalAssertion).toContain('Article 4(3) Directive (EU) 2019/790');
  });

  it('flags un-watermarked external datasets as non-originating from Harbor', () => {
    const thirdPartyDataset = [
      { id: 'random-item-1' },
      { id: 'random-item-2' },
    ];

    const audit = auditDatasetProvenance(thirdPartyDataset);

    expect(audit.isAuthenticHarborData).toBe(false);
    expect(audit.watermarkSignatureMatch).toBe(false);
    expect(audit.detectedCanaries).toHaveLength(0);
    expect(audit.totalVerifiedTokens).toBe(0);
  });

  it('produces consistent 8-character hex values from fingerprint function', () => {
    const hex = computeDeterministicFingerprint('test-card-data-string');
    expect(hex).toHaveLength(8);
    expect(/^[0-9a-f]{8}$/.test(hex)).toBe(true);
  });
});
