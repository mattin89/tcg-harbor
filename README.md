# TCG Harbor

TCG Harbor is an unofficial, collector-focused One Piece Card Game portfolio and local-community demo. It combines collection tracking and source-backed EU/US market references with store discovery, QR-gated communities, card-for-card trade posts, community chat, and private-message flows.

This project is not affiliated with Bandai, Cardmarket, TCGPlayer, or any local game store represented by the fixtures. It is not a marketplace: there are no sale listings, user-entered trade prices, payments, auctions, bidding, checkout, or shipping features.

## Project status

The repository contains three complementary layers:

1. A polished, runnable Vite/React browser demo in `src/App.tsx`, with a generated card/market snapshot plus seeded community fixtures and browser state.
2. Framework-neutral domain and service modules for business rules, local persistence, authentication boundaries, repositories, and normalized pricing providers.
3. A production-oriented PostgreSQL/Supabase migration, RLS policies, RPCs, triggers, and seed data.

The first layer is the current end-to-end UI. The service graph and Supabase schema are deliberately present as integration-ready boundaries, but the browser UI does not yet use a Supabase client and is not fully wired through `createDemoServices()`.

## Quick start

Prerequisites:

- Node.js 18 or newer
- npm

Install and start the development server:

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173). The port is fixed in `vite.config.ts` for both development and preview.

The current browser demo needs no environment variables. `.env.example` documents the optional values needed when adding Supabase and authorized live-provider transports.

### Demo login

- Email: `mario@tcgharbor.demo`
- Password: `HarborDemo!2026`

The first browser visit may open directly on the populated dashboard. To exercise sign-in, go to **Settings**, sign out, and use the prefilled credentials or **Continue with demo account**.

The current client sign-in is a demonstration gate: it validates email shape and persists a local session flag, but it does not authenticate against Supabase or verify a password server-side. Do not use it as a security boundary.

## Available commands

These commands match `package.json`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite on `127.0.0.1` for development. |
| `npm run build` | Run strict TypeScript checking, then create the Vite production bundle. |
| `npm run preview` | Serve the completed production bundle on `127.0.0.1`. Run `npm run build` first. |
| `npm run sync:data` | Refresh the generated One Piece snapshot from Cardmarket, OPTCG API, and TCGCSV. Requires network access. |
| `npm test` | Run the Vitest business-rule suite once. |
| `npm run test:watch` | Run Vitest in watch mode. |

Direct visits to nested routes require an SPA fallback/rewrite to `index.html` when deployed to a static host.

Production check:

```bash
npm test
npm run build
npm run preview
```

## Market data and card images

`scripts/sync-onepiece-data.mjs` performs a build-time/server-side ingestion and writes the versioned `src/data/generated/onepiece-market-v7.json`; the browser never polls provider APIs. The prior v6 snapshot remains preserved. The current searchable snapshot contains 5,349 distinct card printings and 380 priced English sealed products. The demo-owned collection remains a separate 40-card subset and never expands merely because the catalog does.

- Cardmarket EUR values come from its public [One Piece product catalog](https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json) and [daily price guide](https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json). Portfolio value uses `trend`; comparisons use the real `avg1`, `avg7`, and `avg30` fields.
- The Cardmarket card join is deliberately conservative: the sync scans all 21 Bandai-confirmed released English main and special booster groups through OP16, including EB01–EB03, PRB01–PRB02, and both EB04 halves inside OP14/OP15. A standard printing receives a value only when the Cardmarket product identity is unique; alternate, promo, reprint, or ambiguous products remain `null`, and the app never uses price to guess identity.
- OPTCG API supplies set, starter-deck, and DON!! printing metadata/art plus non-promo USD references. All 187 DON!! designs share one rules identity while retaining distinct printing IDs.
- [TCGCSV](https://tcgcsv.com/docs) supplies direct TCGplayer product IDs and USD market prices. The current snapshot has 1,655 exact standard-printing mappings, of which 1,650 have positive prices from both markets. All 21 released groups are fetched and audited; PRB01/PRB02 correctly contribute no comparison rows because Cardmarket's public export gives their base and alternate versions indistinguishable titles and numbers. The sync reports these zero-row groups explicitly instead of guessing. It also includes numbered promotional products and exact promo artwork. Explicit Japanese anniversary/version products are labelled Japanese; all other included promo records are source-defensible English. German is not offered.
- Cross-market ratios use the official [ECB daily USD-per-EUR reference rate](https://data.ecb.europa.eu/help/api/data) embedded at sync time. The comparison is `TCGplayer USD / (Cardmarket EUR × USD per EUR)` and always displays the observation date.
- Of 5,349 card printings, 5,342 have exact source-backed images. Seven remain in the catalog with an explicit “art unavailable” state because no exact trusted image exists; the app never reuses a different printing's artwork.
- Card numbers are rules identities, not unique collectible variants. The model therefore keeps `rulesCardId`, `printingId`, Cardmarket/TCGplayer product IDs, language evidence, source timestamps, and image state separately.

Run `npm run sync:data` at most once daily from a trusted server/build job. TCGCSV explicitly requires backend ingestion, a custom User-Agent, and no more than daily polling. Review provider terms and obtain the necessary commercial data/art rights before production redistribution.

## What to try

- Switch the dashboard between Cardmarket/EUR and the source-backed US/USD market reference, comparing current trend with available rolling averages.
- Open **Market compare** to switch between the 20 highest and 20 lowest exact-printing TCGplayer/Cardmarket ratios, then constrain either ranking with inclusive minimum and maximum Cardmarket EUR prices. The table shows native prices, converted Cardmarket USD, absolute spread, product IDs, and source dates.
- Inspect collection grid and table views, filters, item details, quantity controls, missing-price states, and private notes.
- Search the full catalog, choose an exact alternate art/language printing, or add a real sealed product. Every add/confirmed merge automatically stores its timestamp, quantity, and current EU/US reference; there is no user-entered acquisition date.
- Drag, zoom, and search the Dresden store map, fit all registered stores, request approximate browser location, and open coordinate-based OpenStreetMap directions.
- Join a seeded store community with a manual code or simulated scan.
- Send community chat messages, create and filter price-free trade posts, and inspect read-only market references.
- Open a seeded one-to-one conversation and test optimistic/failed message presentation.
- Generate, preview, deactivate, regenerate, and download the store-admin join QR SVG.
- Resize to mobile width to use the bottom navigation and list/map switcher.

## QR-code test guide

The runnable frontend uses the static fixtures in `src/data/demo.ts`:

| Store | Store ID | Manual join code | Initial state |
| --- | --- | --- | --- |
| Dresden Card Dock | `berlin-dock` | `HARBOR-DRESDEN-7K2M` | Already joined |
| Elbe Mana Wharf | `amsterdam-wharf` | `HARBOR-ELBE-4P9Q` | Already joined |
| Altstadt Deckhouse | `london-deckhouse` | `HARBOR-ALTSTADT-8J3R` | Already joined |
| Neustadt Shuffle Club | `ny-shuffle` | `HARBOR-NEUSTADT-2X5A` | Available to join |
| Blasewitz Harbor Games | `seattle-harbor` | `HARBOR-BLASEWITZ-6T1N` | Available to join |
| Pieschen Topdeck | `la-topdeck` | `HARBOR-PIESCHEN-9V4C` | Available to join |

To test a successful new membership:

1. Open `/scan` or choose **Scan store QR** from Stores.
2. Enter `HARBOR-NEUSTADT-2X5A` in the manual-code field.
3. Confirm the store identity and join.
4. Open the new community from `/communities`.

Additional states:

- Already joined: `HARBOR-DRESDEN-7K2M`
- Invalid: `HARBOR-INVALID-0000`
- Expired/revoked presentation: `HARBOR-EXPIRED-0000`
- Upload fallback: choose any image; the demo simulates detection of the Dresden fixture.
- Development shortcut: **Simulate Dresden scan** on `/scan`.

The scanner requests permission only after an explicit click and uses ZXing to decode QR frames from the live camera. Uploaded QR images are decoded locally in the browser; manual entry and clearly labelled simulation links remain accessible fallbacks. The store-admin generator encodes a real `/join/:code` URL and downloads a print-quality SVG. Regenerated admin codes remain local to that screen and are not added to the static join-code fixture registry.

The separate database seed has its own hashed development tokens, documented in `supabase/seed.sql`. Those tokens exercise the database RPC model and are not connected to the browser fixture registry.

## Architecture at a glance

The detailed design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### Browser demo

- React 18 and strict TypeScript
- Vite 6
- Hand-authored responsive CSS and accessible UI primitives
- Zod validation where used by browser forms
- `qrcode` for standards-compliant SVG generation
- Lazy-loaded ZXing for live-camera and uploaded-image QR decoding
- Seeded data from `src/data/demo.ts`
- Browser `localStorage` for the collection and demo session flag
- In-memory React state for memberships, chat, trades, messages, and notifications
- Inline SVG portfolio charts and a custom illustrative store map

### Domain layer

`src/domain` contains pure, testable business rules for:

- Provider-native pricing and missing/stale quote handling
- 1D/1W/1M portfolio calculations and quantity history
- Duplicate-safe card and sealed-product collection changes
- Store-code validation, membership checks, and protected community data
- Trade-post rejection of user-entered price fields
- Read-only market-reference snapshots
- Shared-community direct-message authorization
- Collection, cost-basis, note, and message privacy

### Service layer

`src/services/index.ts` exports:

- `createDemoServices()` and the `DemoServices` composition interface
- `AuthService`, `DemoAuthService`, session/profile types, and demo auth errors
- `DemoDataAdapter`, `LocalDemoDataAdapter`, and `localDemoDataAdapter`
- `DemoRepository`, `AdapterDemoRepository`, and repository conflict/not-found errors
- `PricingProvider`, `PricingService`, `BasePricingProvider`, and normalized quote types
- `CardmarketPricingProvider`, `TCGPlayerPricingProvider`, and `MockPricingProvider`
- Explicit `DEMO_PRICING_FIXTURES` and `createDemoPricingProviders()`
- In-memory TTL caching, request coalescing, freshness calculation, and fixed-window rate limiting
- A browser guard that rejects live credentials in client code

`LocalDemoDataAdapter` persists namespaced JSON envelopes and sessions in `localStorage` when a browser is available, with an in-memory fallback for non-browser or unavailable-storage runtimes. This is suitable for an offline demonstration, not for authorization.

### Supabase target

The target database is defined by:

- [`supabase/migrations/202607160001_initial_schema.sql`](supabase/migrations/202607160001_initial_schema.sql)
- [`supabase/seed.sql`](supabase/seed.sql)
- [`supabase/SECURITY.md`](supabase/SECURITY.md)

The migration models users and profiles, extensible games/catalogs, collections and quantity history, provider mappings/raw responses/quotes/snapshots, stores and revocable join codes, communities, trades, direct messages, notifications, blocks, reports, and activity logs. It enables RLS across application tables and supplies guarded RPCs for QR redemption, direct-conversation creation, membership moderation, and other privileged workflows.

The local frontend does not install `@supabase/supabase-js`, does not read Supabase environment variables, and does not run Realtime subscriptions. The schema is the production authorization design to connect in a subsequent integration phase.

## Optional Supabase setup

Supabase is not required to run the browser demo. To inspect or adopt the database design:

1. Create a PostgreSQL 15+/Supabase project.
2. Apply `supabase/migrations/202607160001_initial_schema.sql` using your normal migration workflow. If the separately installed Supabase CLI is linked to a disposable project, `supabase db push` will apply repository migrations.
3. Read the Auth UUID instructions at the top of `supabase/seed.sql`. Create development users through Supabase Auth; never insert password hashes through SQL.
4. Apply `supabase/seed.sql`. Public catalog, store, hashed-code, and market fixtures always load; private fixtures load only when the documented Auth users exist.
5. Configure browser-safe project values from `.env.example`, install a Supabase client, and implement repositories that satisfy the existing domain/service interfaces.
6. Move authenticated writes and provider ingestion behind server routes/functions. Never expose the service-role key to Vite client code.

There is intentionally no `supabase/config.toml` or automated Auth-user bootstrap in this repository, so `supabase start`/`supabase db reset` is not a one-command setup yet.

## Replacing mock prices with authorized live data

Only use official, licensed, or otherwise permitted provider access. Do not scrape protected pages or bypass access controls.

1. Obtain provider authorization and confirm permitted storage, caching, and display behavior.
2. Store credentials in a server secret manager using non-`VITE_` variables. `.env.example` shows suggested names.
3. Implement a server-only `ProviderTransport<CardmarketLicensedQuoteResponse>` and/or `ProviderTransport<TCGPlayerLicensedQuoteResponse>` that calls the authorized API.
4. Resolve each catalog item through `provider_catalog_mappings` using provider product ID, card/set identifiers, variant, language, and condition. Never fall back to display-name matching alone.
5. Construct `CardmarketPricingProvider` or `TCGPlayerPricingProvider` on the server and register it with `PricingService`. Their runtime guard rejects credentials when `window` exists.
6. Persist the untouched response in `provider_raw_responses`; persist the normalized native-currency quote in `price_quotes`; append periodic observations to `price_snapshots`.
7. Respect provider quotas through the included cache/rate-limit interfaces plus a shared distributed cache/rate limiter in multi-instance production.
8. Return normalized, non-secret quote data to the browser. Keep `marketValue` nullable, preserve every provider field actually returned, label source/timestamp/freshness, and record currency conversion separately.
9. Switch the provider/database `data_mode` from `demo_fixture` to `live` only for genuinely licensed responses. Never relabel seeded fixtures as live data.

No live HTTP transport or provider endpoint is shipped because credentials and commercial permissions are deployment-specific.

## Privacy and security model

The intended production invariants are enforced in the migration, not merely hidden in the UI:

- Collections, quantities, portfolio values, cost basis, acquisition details, and private notes are owner-only.
- Community content requires active membership in that exact store community.
- Only catalog items deliberately published in a trade post are disclosed; source collection rows remain private.
- Trade posts have no user-entered sale-price field. Captured/current market values are read-only references, not fairness guarantees.
- Direct conversations require a shared active community and no bilateral block. Only participants can read direct messages; store administrators receive no DM bypass.
- Join codes are revocable bearer tokens. The database stores hashes, not raw production tokens, and enforces expiry, usage caps, duplicate membership prevention, and attempt limits.
- Chat, DM, trade-post, and QR-join rate limits are enforced by database functions/triggers; production should add edge/IP/device controls.
- Provider and Supabase service credentials remain server-only.
- User content is length-limited and normalized in the database and must still be escaped when rendered.
- The app exposes only approximate store-search location and never publishes a collector's exact location.

See `supabase/SECURITY.md` for the detailed RLS and abuse-control audit.

## Complete practical file tree

Generated directories such as `node_modules/` and `dist/` are omitted.

```text
tcg-harbor/
├── .env.example
├── .gitignore
├── README.md
├── docs/
│   └── ARCHITECTURE.md
├── index.html
├── package-lock.json
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   ├── styles-community.css
│   ├── styles-responsive.css
│   ├── styles-secondary.css
│   ├── __tests__/
│   │   └── domain.test.ts
│   ├── components/
│   │   ├── Icon.tsx
│   │   ├── ScannerPage.tsx
│   │   └── ui.tsx
│   ├── data/
│   │   └── demo.ts
│   ├── domain/
│   │   ├── collection.ts
│   │   ├── community.ts
│   │   ├── errors.ts
│   │   ├── index.ts
│   │   ├── messages.ts
│   │   ├── portfolio.ts
│   │   ├── pricing.ts
│   │   ├── privacy.ts
│   │   ├── trade.ts
│   │   └── types.ts
│   └── services/
│       ├── createDemoServices.ts
│       ├── index.ts
│       ├── auth/
│       │   ├── DemoAuthService.ts
│       │   ├── index.ts
│       │   └── types.ts
│       ├── demo/
│       │   ├── LocalDemoDataAdapter.ts
│       │   ├── index.ts
│       │   ├── repository.ts
│       │   └── types.ts
│       └── pricing/
│           ├── BasePricingProvider.ts
│           ├── PricingService.ts
│           ├── cache.ts
│           ├── demoFixtures.ts
│           ├── freshness.ts
│           ├── index.ts
│           ├── normalization.ts
│           ├── rateLimit.ts
│           ├── serverBoundary.ts
│           ├── types.ts
│           └── providers/
│               ├── CardmarketPricingProvider.ts
│               ├── MockPricingProvider.ts
│               └── TCGPlayerPricingProvider.ts
└── supabase/
    ├── SECURITY.md
    ├── seed.sql
    └── migrations/
        └── 202607160001_initial_schema.sql
```

## Honest limitations

- The current UI is a client-side demo. Its login, authorization checks, and mutable community state are not trusted server controls.
- `createDemoServices()` and the Supabase schema are not yet connected to `App.tsx`; the UI currently manages most state directly.
- Only collection assets and the simple demo session flag persist directly in the UI. Joined communities, chats, trades, conversations, and notification changes reset on refresh.
- Realtime behavior is simulated with local React state. There is no Supabase Realtime connection, multi-user delivery, offline queue, or server retry pipeline.
- The store map uses interactive MapLibre with OpenStreetMap raster tiles and six registered Dresden demo stores. The distance selector is still presentational and does not calculate geospatial distance or clustering.
- Live camera and uploaded-image QR decoding depend on browser media support and image quality; manual code entry remains the guaranteed accessible fallback.
- Regenerated store-admin tokens are not persisted into the frontend join registry or database.
- Portfolio and item charts show only the two source-backed endpoints (Cardmarket current trend versus the selected rolling average), not an invented transaction history. The SQL seed still includes 31 days of database snapshots for a future adapter.
- Cardmarket, OPTCG, and TCGCSV data are generated daily snapshots, not streaming quotes. The Dresden stores remain illustrative registered app records, not verified real businesses.
- Cross-market ratios cover only exact English base printings with both provider identities and positive daily prices. They exclude alternate arts without a two-provider match, and do not include fees, tax, shipping, condition adjustments, liquidity, or executable sale prices.
- No publisher artwork is bundled locally. Remote art loads from its recorded OPTCG or TCGplayer source; seven unresolved exact printings show a clearly labelled unavailable state rather than a misleading substitute.
- Password reset, account creation, avatar upload, report/block workflows, notification delivery, and several moderation actions are UI/demo structures rather than connected backend operations.
- No email, push, payment, sale, auction, escrow, shipping, or store inventory integration is included.
