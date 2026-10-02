import { LEGAL_CONFIG, type LegalConfig } from '../config/legalConfig';

export interface LegalSection {
  readonly id: string;
  readonly title: string;
  readonly content: string[];
  readonly listItems?: string[];
}

export interface LegalDocument {
  readonly slug: 'terms' | 'privacy' | 'cookies' | 'impressum' | 'disclaimers';
  readonly title: string;
  readonly subtitle: string;
  readonly lastUpdated: string;
  readonly sections: LegalSection[];
}

/**
 * Builds the complete Terms of Service document.
 */
export function getTermsOfService(config: LegalConfig = LEGAL_CONFIG): LegalDocument {
  return {
    slug: 'terms',
    title: 'Terms of Service',
    subtitle: `Rules and conditions governing the use of ${config.brandName}.`,
    lastUpdated: config.effectiveDate,
    sections: [
      {
        id: 'scope-and-nature',
        title: '1. Nature of the Service',
        content: [
          `${config.brandName} is a fan-created, community-driven collection manager and catalog for the ${config.ipHolders.gameName}.`,
          'The platform operates strictly as an informational utility and community bulletin board. We do not operate a commercial marketplace, web shop, payment gateway, escrow service, or auction house. We do not sell cards, take custody of assets, handle shipping, or process transactions between users.',
        ],
      },
      {
        id: 'eligibility',
        title: '2. Eligibility and Age Verification',
        content: [
          `You must be at least ${config.minimumAge} years of age to register an account or participate in community discussions.`,
          `By creating an account, you represent and warrant that you meet this minimum age requirement under the laws of your residence, including the digital consent age established under Article 8 of the General Data Protection Regulation (GDPR). If you are under ${config.minimumAge}, you may only browse the public catalog as an unauthenticated guest.`,
        ],
      },
      {
        id: 'account-security',
        title: '3. User Accounts and Credentials',
        content: [
          'You agree to provide accurate information when creating an account and to update your details if they change.',
          'You remain responsible for maintaining the confidentiality of your credentials. Notify us immediately at ' + config.supportEmail + ' if you detect unauthorized access to your account. We bear no liability for losses arising from compromised user credentials.',
        ],
      },
      {
        id: 'trading-rules',
        title: '4. Peer-to-Peer Community Trading',
        content: [
          'Users may publish trade postings and send direct messages to arrange card-for-card exchanges with members of their local store communities.',
          'All trades occur directly between users. We do not verify card authenticity, inspect card condition, guarantee counterparty performance, or insure shipments. You arrange and complete all trades at your own risk. Exercise caution when meeting other collectors or sending items by mail.',
        ],
      },
      {
        id: 'market-pricing',
        title: '5. Market Reference Data and Valuations',
        content: [
          'Market trends, average prices, and portfolio totals displayed across the service represent aggregated public reference figures sourced daily from third-party catalogs, including ' + config.ipHolders.marketDataSources + '.',
          'These figures serve informational purposes only. They do not constitute financial appraisals, investment advice, or guaranteed buyback quotes. Actual market prices fluctuate based on physical condition, seller reputation, regional liquidity, and currency exchange rates.',
        ],
      },
      {
        id: 'prohibited-conduct',
        title: '6. Prohibited Activities',
        content: [
          'You agree not to misuse the platform or assist others in doing so. Prohibited activities include:',
        ],
        listItems: [
          'Scraping, harvesting, or extracting bulk data without our prior written consent.',
          'Posting counterfeit, stolen, or misrepresented cards or merchandise.',
          'Harassing, threatening, stalking, or defaming other members or store managers.',
          'Attempting to bypass authentication gates, probe server vulnerabilities, or flood platform infrastructure.',
          'Impersonating platform administrators, official Bandai staff, or verified store representatives.',
          'Publishing commercial advertisements, unsolicited promotions, or referral schemes in community chat.',
        ],
      },
      {
        id: 'user-content',
        title: '7. User Content and License',
        content: [
          'You retain ownership of any text, images, or trade listings you submit. By uploading content to public or community areas, you grant us a worldwide, non-exclusive, royalty-free license to host, display, and format that content solely to operate the platform.',
          'We reserve the right to remove any content that violates these Terms or applicable laws.',
        ],
      },
      {
        id: 'liability-limits',
        title: '8. Limitation of Liability',
        content: [
          `To the maximum extent permitted by applicable law in ${config.governingLaw}, ${config.brandName} and its operators provide the service on an "as is" and "as available" basis without warranties of any kind.`,
          'We are liable only for damages caused by willful misconduct or gross negligence. Statutory liability for bodily injury, life, health, or claims under mandatory consumer protection legislation remains unaffected.',
        ],
      },
      {
        id: 'termination-severability',
        title: '9. Suspension, Termination, and Severability',
        content: [
          'We may suspend or terminate your access if you breach these Terms. You may delete your account at any time through your account settings.',
          'If any provision in these Terms is deemed invalid or unenforceable, that provision will be severed, and the remaining provisions will continue in full force and effect.',
        ],
      },
    ],
  };
}

/**
 * Builds the complete GDPR Privacy Policy document.
 */
export function getPrivacyPolicy(config: LegalConfig = LEGAL_CONFIG): LegalDocument {
  return {
    slug: 'privacy',
    title: 'Privacy Policy',
    subtitle: `How ${config.brandName} collects, protects, and handles your personal data in accordance with the EU General Data Protection Regulation (GDPR).`,
    lastUpdated: config.effectiveDate,
    sections: [
      {
        id: 'controller-identity',
        title: '1. Data Controller',
        content: [
          'The Data Controller responsible for processing personal data on this platform under Article 4(7) of Regulation (EU) 2016/679 (GDPR) is:',
          `${config.operatorName}`,
          `${config.operatorAddress}`,
          `Contact Email: ${config.privacyEmail}`,
        ],
      },
      {
        id: 'data-categories',
        title: '2. Personal Data We Collect',
        content: [
          'We collect only the minimum data required to provide portfolio management, local store discovery, and community interactions:',
        ],
        listItems: [
          'Account Data: Email address, username, display name, and securely salted password hashes managed via Supabase Auth.',
          'Collection Records: Cards added to your binder, acquisition dates, purchased prices, condition notes, and trade flags. These records remain strictly private by default.',
          'Profile Settings: Preferred display currency (EUR/USD), primary market preference (Cardmarket/TCGplayer), and general location (approximate city and postcode only, never exact GPS coordinates).',
          'Community Interactions: Trade proposals you publish to store boards and direct messages exchanged with other verified community members.',
          'Technical Logs: Server requests record IP addresses, user agent headers, and request timestamps in rolling logs for security and threat mitigation.',
        ],
      },
      {
        id: 'lawful-bases',
        title: '3. Legal Bases for Processing (GDPR Art. 6)',
        content: [
          'Under Article 6(1) of the GDPR, we process your information based on:',
        ],
        listItems: [
          'Contractual Necessity (Art. 6(1)(b)): Authenticating your login, saving your personal card collections, rendering notifications, and delivering direct messages you send.',
          'Legitimate Interests (Art. 6(1)(f)): Protecting against brute-force attacks, preventing spam, maintaining server stability, and calculating aggregate card price trends.',
          'Compliance with Legal Obligations (Art. 6(1)(c)): Retaining records when statutory tax, accounting, or law enforcement mandates apply.',
        ],
      },
      {
        id: 'privacy-by-design',
        title: '4. Privacy by Design & Default',
        content: [
          'We enforce strict isolation between accounts. Your collection inventory, valuations, purchase costs, and private notes are protected by database Row-Level Security (RLS). Other users cannot see what you own unless you choose to create a public trade post.',
          'Store managers can moderate group chat within their verified store channel, but they have no technical access to your private collection or direct messages.',
        ],
      },
      {
        id: 'subprocessors',
        title: '5. Sub-processors and Hosting Infrastructure',
        content: [
          'We partner with reputable infrastructure providers committed to European data protection standards:',
        ],
        listItems: [
          'Supabase Inc.: Provides PostgreSQL database storage and user authentication services. Data is hosted in European Union data centers under standard contractual clauses.',
          'Render Services Inc.: Hosts web application instances and static asset distribution.',
        ],
      },
      {
        id: 'data-retention',
        title: '6. Data Retention',
        content: [
          'We keep your account information and collection records as long as your account remains active. If you delete your account, our database immediately cascades deletions across your collections, acquisition logs, trade posts, and direct messages.',
          'Technical connection logs rotate automatically and are purged within 30 days.',
        ],
      },
      {
        id: 'user-rights',
        title: '7. Your Rights Under GDPR (Articles 15–22)',
        content: [
          'Under European data protection law, you possess enforceable rights regarding your personal information:',
        ],
        listItems: [
          'Right of Access (Art. 15): You can request a summary of all personal data we hold about you.',
          'Right to Rectification (Art. 16): You can edit your username, location, currency, and preferences at any time in Settings.',
          'Right to Erasure (Art. 17): You can permanently delete your account through your account settings or by emailing ' + config.privacyEmail + '.',
          'Right to Data Portability (Art. 20): You can download a complete, structured JSON export of your profile, collection items, and trades directly from the Settings page.',
          'Right to Object (Art. 21): You can object at any time to processing based on legitimate interests.',
        ],
      },
      {
        id: 'complaint-authority',
        title: '8. Right to Lodge a Complaint (GDPR Art. 77)',
        content: [
          'If you believe our processing of your personal data infringes European data protection regulations, you have the right to lodge a complaint with a supervisory authority in your EU member state of habitual residence, place of work, or place of the alleged infringement.',
        ],
      },
    ],
  };
}

/**
 * Builds the Cookie & Local Storage Policy document.
 */
export function getCookiePolicy(config: LegalConfig = LEGAL_CONFIG): LegalDocument {
  return {
    slug: 'cookies',
    title: 'Cookie & Storage Policy',
    subtitle: `Disclosure of client-side storage technologies used by ${config.brandName} under EU ePrivacy Directive Art. 5(3).`,
    lastUpdated: config.effectiveDate,
    sections: [
      {
        id: 'tracking-cookies-statement',
        title: '1. No Third-Party Tracking or Advertising Cookies',
        content: [
          `${config.brandName} uses zero third-party advertising cookies, zero marketing trackers, and zero behavioral analytics scripts.`,
          'We do not load Google Analytics, Meta Pixels, advertising beacons, or data broker scripts. We do not track your browsing activity across other websites or sell behavioral profiles.',
        ],
      },
      {
        id: 'client-storage-purpose',
        title: '2. Technical Local Storage Usage',
        content: [
          'Modern web applications use browser storage mechanisms (such as localStorage and sessionStorage) instead of traditional server cookies to keep your session active, remember your theme or currency preferences, and speed up page load times.',
          'Under European ePrivacy regulations, strictly necessary technical storage keys used solely to provide a service explicitly requested by the user do not require prior cookie consent banners.',
        ],
      },
      {
        id: 'storage-inventory',
        title: '3. Stored Keys Registry',
        content: [
          'Below is a complete inventory of every browser storage key utilized by this application:',
        ],
      },
      {
        id: 'managing-storage',
        title: '4. How to Clear Browser Storage',
        content: [
          'You can clear these stored keys at any time through your browser settings by navigating to "Clear Browsing Data" and selecting "Cookies and site data". Doing so will sign you out and reset your local preferences.',
        ],
      },
    ],
  };
}

/**
 * Builds the Statutory Legal Notice (German DDG § 5 / MStV § 18 Impressum).
 */
export function getLegalNotice(config: LegalConfig = LEGAL_CONFIG): LegalDocument {
  return {
    slug: 'impressum',
    title: 'Legal Notice (Impressum)',
    subtitle: `Statutory provider identification in accordance with § 5 Digitale-Dienste-Gesetz (DDG) and § 18 Medienstaatsvertrag (MStV).`,
    lastUpdated: config.effectiveDate,
    sections: [
      {
        id: 'provider-info',
        title: '1. Service Provider Information',
        content: [
          `Provider / Operating Entity: ${config.operatorName}`,
          `Address: ${config.operatorAddress}`,
          `Contact Email: ${config.legalEmail}`,
          `Support Contact: ${config.supportEmail}`,
        ],
      },
      {
        id: 'content-editorial',
        title: '2. Editorial & Content Responsibility (§ 18 Abs. 2 MStV)',
        content: [
          `Responsible for editorial and journalistic content under § 18(2) of the German Interstate Media Treaty (Medienstaatsvertrag):`,
          `${config.operatorName}`,
          `${config.operatorAddress}`,
        ],
      },
      {
        id: 'eu-dispute-resolution',
        title: '3. EU Online Dispute Resolution & Consumer Arbitration',
        content: [
          `The European Commission provides a platform for online dispute resolution (ODR), accessible at: ${config.disputeResolutionUrl}.`,
          'We are neither willing nor obliged to participate in dispute resolution proceedings before a consumer arbitration board (Verbraucherschlichtungsstelle).',
        ],
      },
      {
        id: 'notice-takedown',
        title: '4. Notice & Takedown (EU Digital Services Act Art. 16)',
        content: [
          'If you believe that any content hosted on this platform infringes your intellectual property, personality rights, or statutory laws, please send a detailed notice to ' + config.legalEmail + '.',
          'We investigate legitimate notices promptly and will disable or remove infringing content in compliance with the Digital Services Act (Regulation EU 2022/2065).',
        ],
      },
    ],
  };
}

/**
 * Builds the Intellectual Property & Fair Use Disclaimers document.
 */
export function getDisclaimers(config: LegalConfig = LEGAL_CONFIG): LegalDocument {
  return {
    slug: 'disclaimers',
    title: 'Intellectual Property & Disclaimers',
    subtitle: `Trademark ownership acknowledgments, nominative fair use doctrine, and trading disclaimers for ${config.brandName}.`,
    lastUpdated: config.effectiveDate,
    sections: [
      {
        id: 'trademark-recognition',
        title: '1. Trademark and Copyright Ownership',
        content: [
          `"One Piece", all characters, card artwork, card names, set titles, and game logos are registered trademarks and copyrighted material of ${config.ipHolders.trademarkOwners}.`,
          `${config.brandName} is an independent fan-made reference tool. It is not produced, endorsed, sponsored, affiliated with, or supported by Bandai Co., Ltd., Shueisha, or Toei Animation in any manner.`,
        ],
      },
      {
        id: 'fair-use-doctrine',
        title: '2. Nominative Fair Use & Information Purpose',
        content: [
          'Card names, symbols, game terms, and visual reproductions appear exclusively for identification, cataloging, personal collection tracking, and news commentary.',
          'This usage constitutes nominative fair use under applicable intellectual property laws (including 17 U.S.C. § 107 in the United States and statutory citation exceptions under European copyright directives). No claim of ownership or proprietary rights is made regarding any third-party intellectual property displayed.',
        ],
      },
      {
        id: 'market-sources',
        title: '3. Market Pricing Data Attribution',
        content: [
          `Pricing metrics and historical trends reference publicly accessible data from ${config.ipHolders.marketDataSources}.`,
          'All trademarks, logos, and brand names of Cardmarket and TCGplayer belong to their respective corporate entities. Reference to them does not imply affiliation or direct commercial endorsement.',
        ],
      },
      {
        id: 'community-disclaimer',
        title: '4. Trading and Financial Risk Disclaimer',
        content: [
          `${config.brandName} provides collection software and local community directories. We do not act as an escrow agent, broker, insurer, or payment intermediary.`,
          'Collectible trading cards carry price volatility. Market quotes provided on this platform reflect automated public estimates and do not constitute financial advice, investment counsel, or guarantees of future value. Always exercise personal discretion when trading or purchasing collectibles.',
        ],
      },
    ],
  };
}

/**
 * Retrieves all legal documents in an indexed map.
 */
export function getAllLegalDocuments(config: LegalConfig = LEGAL_CONFIG): Record<LegalDocument['slug'], LegalDocument> {
  return {
    terms: getTermsOfService(config),
    privacy: getPrivacyPolicy(config),
    cookies: getCookiePolicy(config),
    impressum: getLegalNotice(config),
    disclaimers: getDisclaimers(config),
  };
}
