import { describe, expect, it } from 'vitest';
import { LEGAL_CONFIG } from '../config/legalConfig';
import {
  getAllLegalDocuments,
  getCookiePolicy,
  getDisclaimers,
  getLegalNotice,
  getPrivacyPolicy,
  getTermsOfService,
} from '../domain/legalContent';
import {
  isGuestPublicPathV4,
  PUBLIC_LEGAL_PATHS,
  resolveViewerPathV4,
} from '../domain/guestAccessV4';
// @ts-expect-error - JavaScript build script without ambient typings
import { STATIC_SPA_ENTRYPOINT_ROUTES_V1 } from '../../scripts/create-static-spa-entrypoints-v1.mjs';
// @ts-expect-error - JavaScript build script without ambient typings
import { PUBLIC_CANONICAL_PATHS_V1 } from '../../scripts/generate-public-discovery-v1.mjs';

describe('legal compliance & EU data protection suite', () => {
  it('generates all five required legal documents with valid metadata', () => {
    const docs = getAllLegalDocuments(LEGAL_CONFIG);
    const requiredSlugs = ['terms', 'privacy', 'cookies', 'impressum', 'disclaimers'];

    expect(Object.keys(docs).sort()).toEqual(requiredSlugs.sort());

    for (const slug of requiredSlugs) {
      const doc = docs[slug as keyof typeof docs];
      expect(doc.title).toBeTruthy();
      expect(doc.subtitle).toBeTruthy();
      expect(doc.lastUpdated).toBe(LEGAL_CONFIG.effectiveDate);
      expect(doc.sections.length).toBeGreaterThan(0);

      // Verify no broken template strings or unreplaced null/undefined
      for (const section of doc.sections) {
        expect(section.title).toBeTruthy();
        expect(section.content.length).toBeGreaterThan(0);
        for (const paragraph of section.content) {
          expect(paragraph).not.toContain('undefined');
          expect(paragraph).not.toContain('null');
        }
      }
    }
  });

  it('supports seamless parameterization when domain, brand name, or address changes', () => {
    const customConfig = {
      ...LEGAL_CONFIG,
      brandName: 'Card Haven',
      domainName: 'cardhaven.eu',
      operatorName: 'Card Haven UG (haftungsbeschraenkt)',
      operatorAddress: 'Koenigsallee 1, 40212 Duesseldorf, Germany',
      minimumAge: 18,
      supportEmail: 'contact@cardhaven.eu',
      privacyEmail: 'dpo@cardhaven.eu',
      legalEmail: 'legal@cardhaven.eu',
    };

    const terms = getTermsOfService(customConfig);
    const privacy = getPrivacyPolicy(customConfig);
    const impressum = getLegalNotice(customConfig);
    const disclaimers = getDisclaimers(customConfig);
    const cookies = getCookiePolicy(customConfig);

    // Terms reflect updated brand and minimum age
    expect(terms.subtitle).toContain('Card Haven');
    const ageSection = terms.sections.find((s) => s.id === 'eligibility');
    expect(ageSection?.content[0]).toContain('18 years of age');

    // Privacy reflects controller name and privacy email
    const controllerSection = privacy.sections.find((s) => s.id === 'controller-identity');
    expect(controllerSection?.content).toContain('Card Haven UG (haftungsbeschraenkt)');
    expect(controllerSection?.content).toContain('Koenigsallee 1, 40212 Duesseldorf, Germany');
    expect(controllerSection?.content.some((c) => c.includes('dpo@cardhaven.eu'))).toBe(true);

    // Impressum reflects new operator details and legal email
    const providerSection = impressum.sections.find((s) => s.id === 'provider-info');
    expect(providerSection?.content.some((c) => c.includes('Card Haven UG'))).toBe(true);
    expect(providerSection?.content.some((c) => c.includes('legal@cardhaven.eu'))).toBe(true);

    // Disclaimers acknowledge Bandai while maintaining new brand
    expect(disclaimers.sections[0].content[0]).toContain('Bandai Co., Ltd.');
    expect(disclaimers.sections[0].content[1]).toContain('Card Haven');

    // Cookie policy includes new brand
    expect(cookies.subtitle).toContain('Card Haven');
  });

  it('explicitly separates free collector tools from future commercial store subscription terms', () => {
    const terms = getTermsOfService(LEGAL_CONFIG);
    const storeSection = terms.sections.find((s) => s.id === 'store-services-and-fees');
    expect(storeSection).toBeDefined();
    expect(storeSection?.title).toContain('Commercial Store Services');
    expect(storeSection?.content[0]).toContain('without charge');
    expect(storeSection?.content[1]).toContain('reserves the right to introduce commercial subscription tiers');
    expect(storeSection?.content[2]).toContain('will not affect the free status of standard collector and player portfolios');

    const ageSection = terms.sections.find((s) => s.id === 'eligibility');
    expect(ageSection?.content[1]).toContain('affirmatively confirm that you are at least 16 years of age');
  });

  it('correctly sets Mario De Lorenzo and active contact email across legal policies', () => {
    expect(LEGAL_CONFIG.operatorName).toBe('Mario De Lorenzo');
    expect(LEGAL_CONFIG.supportEmail).toBe('delorenzomario9@gmail.com');
    expect(LEGAL_CONFIG.legalEmail).toBe('delorenzomario9@gmail.com');
    expect(LEGAL_CONFIG.privacyEmail).toBe('delorenzomario9@gmail.com');

    const privacy = getPrivacyPolicy(LEGAL_CONFIG);
    const impressum = getLegalNotice(LEGAL_CONFIG);

    const controllerSection = privacy.sections.find((s) => s.id === 'controller-identity');
    expect(controllerSection?.content.some((c) => c.includes('Mario De Lorenzo'))).toBe(true);
    expect(controllerSection?.content.some((c) => c.includes('delorenzomario9@gmail.com'))).toBe(true);

    const providerSection = impressum.sections.find((s) => s.id === 'provider-info');
    expect(providerSection?.content.some((c) => c.includes('Mario De Lorenzo'))).toBe(true);
    expect(providerSection?.content.some((c) => c.includes('delorenzomario9@gmail.com'))).toBe(true);
  });

  it('verifies client storage registry satisfies EU ePrivacy Directive Art. 5(3)', () => {
    const registry = LEGAL_CONFIG.clientStorageRegistry;
    expect(registry.length).toBeGreaterThan(0);

    for (const item of registry) {
      expect(item.key).toBeTruthy();
      expect(['localStorage', 'sessionStorage']).toContain(item.storageType);
      expect(['Strictly Necessary', 'Functional Preference']).toContain(item.classification);
      expect(item.purpose.length).toBeGreaterThan(15);
      expect(item.retention.length).toBeGreaterThan(5);
    }

    // Verify key security items are present
    const keys = registry.map((item) => item.key);
    expect(keys.some((k) => k.includes('auth-token'))).toBe(true);
    expect(keys.some((k) => k.includes('session'))).toBe(true);
  });

  it('allows unauthenticated guest access to all public legal routes', () => {
    for (const legalPath of PUBLIC_LEGAL_PATHS) {
      expect(isGuestPublicPathV4(legalPath)).toBe(true);
      expect(resolveViewerPathV4(legalPath, 'guest')).toBe(legalPath);
      expect(resolveViewerPathV4(`${legalPath}/`, 'guest')).toBe(legalPath);
    }
  });

  it('includes all legal paths in static SPA entrypoint build routes', () => {
    for (const legalPath of PUBLIC_LEGAL_PATHS) {
      expect(STATIC_SPA_ENTRYPOINT_ROUTES_V1).toContain(legalPath);
    }
  });

  it('includes all legal paths in public canonical discovery search indexes', () => {
    for (const legalPath of PUBLIC_LEGAL_PATHS) {
      expect(PUBLIC_CANONICAL_PATHS_V1).toContain(legalPath);
    }
  });
});
