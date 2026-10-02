/**
 * Centralized Legal and Brand Configuration
 *
 * All public-facing legal documents, privacy notices, cookie disclosures,
 * and footers draw their parameters from this single module.
 *
 * When changing the service name, operating entity, domain, or physical
 * address, update the values here. Changes propagate immediately across all
 * Terms of Service, Privacy Policies, Legal Notices (Impressum), and UI disclaimers.
 */

export interface StorageDisclosureItem {
  readonly key: string;
  readonly storageType: 'localStorage' | 'sessionStorage';
  readonly classification: 'Strictly Necessary' | 'Functional Preference';
  readonly purpose: string;
  readonly retention: string;
}

export interface LegalConfig {
  readonly brandName: string;
  readonly brandShortName: string;
  readonly serviceDescription: string;
  readonly domainName: string;
  readonly publicSiteUrl: string;
  readonly operatorName: string;
  readonly operatorAddress: string;
  readonly supportEmail: string;
  readonly legalEmail: string;
  readonly privacyEmail: string;
  readonly minimumAge: number;
  readonly effectiveDate: string;
  readonly governingLaw: string;
  readonly disputeResolutionUrl: string;
  readonly ipHolders: {
    readonly gameName: string;
    readonly trademarkOwners: string;
    readonly marketDataSources: string;
  };
  readonly clientStorageRegistry: readonly StorageDisclosureItem[];
}

export const LEGAL_CONFIG: LegalConfig = Object.freeze({
  /** Brand identity */
  brandName: 'TCG Harbor',
  brandShortName: 'Harbor',
  serviceDescription: 'Fan-made One Piece Card Game portfolio tracker, catalog reference, and local community board',

  /** Network endpoints */
  domainName: 'tcg-harbor.onrender.com',
  publicSiteUrl: 'https://tcg-harbor.onrender.com',

  /** Operator & legal entity contact details (German DDG § 5 / MStV § 18) */
  operatorName: 'Mario De Lorenzo',
  operatorAddress: '[Street Address, Postal Code, City, Country]',
  supportEmail: 'delorenzomario9@gmail.com',
  legalEmail: 'delorenzomario9@gmail.com',
  privacyEmail: 'delorenzomario9@gmail.com',

  /** Regulatory parameters */
  minimumAge: 16,
  effectiveDate: 'October 2, 2026',
  governingLaw: 'Federal Republic of Germany / European Union',
  disputeResolutionUrl: 'https://ec.europa.eu/consumers/odr',

  /** Intellectual Property rights-holders */
  ipHolders: Object.freeze({
    gameName: 'One Piece Card Game',
    trademarkOwners: 'Eiichiro Oda / Shueisha, Toei Animation, and Bandai Co., Ltd.',
    marketDataSources: 'Cardmarket (Sammelkartenmarkt GmbH & Co. KG) and TCGplayer (eBay Inc.)',
  }),

  /** Client-side storage registry under EU ePrivacy Directive Art. 5(3) */
  clientStorageRegistry: Object.freeze<StorageDisclosureItem[]>([
    {
      key: 'sb-*-auth-token',
      storageType: 'localStorage',
      classification: 'Strictly Necessary',
      purpose: 'Stores Supabase authentication tokens to maintain user sessions across page reloads.',
      retention: 'Cleared automatically upon user sign-out or session expiration.',
    },
    {
      key: 'tcg-harbor-session',
      storageType: 'localStorage',
      classification: 'Strictly Necessary',
      purpose: 'Tracks local session state for demo mode and guest transitions.',
      retention: 'Until sign-out or browser storage is cleared.',
    },
    {
      key: 'tcg-harbor-profile-settings-v5',
      storageType: 'localStorage',
      classification: 'Functional Preference',
      purpose: 'Caches user display preferences, chosen market provider (Cardmarket/TCGplayer), and currency.',
      retention: 'Persistent until modified in settings or browser cache is cleared.',
    },
    {
      key: 'tcg-harbor-notification-settings-v5',
      storageType: 'localStorage',
      classification: 'Functional Preference',
      purpose: 'Caches local toggle states for in-app alert subscriptions.',
      retention: 'Persistent until modified in settings or browser cache is cleared.',
    },
    {
      key: 'tcg-harbor-assets-source-backed-v5',
      storageType: 'localStorage',
      classification: 'Functional Preference',
      purpose: 'Stores local portfolio cards and valuation estimates in demo preview mode.',
      retention: 'Persistent until cleared by user or browser storage wipe.',
    },
    {
      key: 'tcg-harbor-card-price-history-v1',
      storageType: 'localStorage',
      classification: 'Functional Preference',
      purpose: 'Caches recent daily market quotes locally to minimize redundant network requests.',
      retention: 'Persistent with rolling 30-day data pruning.',
    },
    {
      key: 'tcg-harbor-store-join-intent / pending-join',
      storageType: 'sessionStorage',
      classification: 'Strictly Necessary',
      purpose: 'Temporarily preserves a scanned QR store join code during account registration.',
      retention: 'Removed immediately once registration completes or browser tab is closed.',
    },
  ]),
});
