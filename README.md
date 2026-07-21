# TCG Harbor

TCG Harbor is an unofficial, collector-focused One Piece Card Game portfolio and local-community platform in transition from a browser demo to a real multi-user product. It combines collection tracking and source-backed EU/US market references with store discovery, QR-gated communities, card-for-card trade posts, community chat, and private-message flows.

This project is not affiliated with Bandai, Cardmarket, TCGPlayer, or any local game store represented by the fixtures. It is not a marketplace: there are no sale listings, user-entered trade prices, payments, auctions, bidding, checkout, or shipping features.

## Project status

The repository contains four complementary layers:

1. A production-gated Vite/React application shell in `src/App.tsx`, with a generated card/market snapshot plus temporary community fixtures while those repositories are migrated.
2. Framework-neutral domain and service modules for business rules, local persistence, authentication boundaries, repositories, and normalized pricing providers.
3. A production-oriented PostgreSQL/Supabase migration, RLS policies, RPCs, triggers, and seed data.
4. An environment-activated Supabase account layer with real player/store signup, session restoration, password reset, store applications, platform approval, per-store QR invitations, and store-owned chat/moderation tools.

`ProductionApp_v2.tsx` is the only shipped entry and requires a project URL plus browser-safe publishable key. Missing account configuration fails closed; there is no shared live/demo account or authentication bypass. Player collections are owner-scoped in Supabase. Community, trade, direct-message, and notification repositories are still being migrated from fixtures, so the production transition remains incremental.

## Quick start

Prerequisites:

- Node.js 22 or newer
- npm

Install and start the development server:

```bash
npm ci
npm run dev
```

Copy `.env.example` to the gitignored `.env`, configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, then open [http://127.0.0.1:4173](http://127.0.0.1:4173). The port is fixed in `vite.config.ts` for both development and preview. Use an account created through Supabase Auth; the repository contains no reusable login credential.

## Available commands

These commands match `package.json`:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite on `127.0.0.1` for development. |
| `npm run build` | Run strict TypeScript checking, then create the Vite production bundle. |
| `npm run preview` | Serve the completed production bundle on `127.0.0.1`. Run `npm run build` first. |
| `npm run bootstrap:admin` | Guarded, server-only creation of the first Auth account; role promotion remains a separate exact-UUID operation. |
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

`scripts/sync-onepiece-data.mjs` performs a build-time/server-side ingestion and writes the versioned `src/data/generated/onepiece-market-v7.json`; the browser never polls provider APIs. The prior v6 snapshot remains preserved. The snapshot refreshed on 21 July 2026 contains 5,349 distinct card printings and 394 released English sealed products. A user's owner-scoped collection remains separate and never expands merely because the catalog does.

- Cardmarket EUR values come from its public [One Piece product catalog](https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json) and [daily price guide](https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json). Portfolio value uses `trend`; comparisons use the real `avg1`, `avg7`, and `avg30` fields.
- The Cardmarket card join is deliberately conservative: the sync scans all 21 Bandai-confirmed released English main and special booster groups through OP16, including EB01–EB03, PRB01–PRB02, and both EB04 halves inside OP14/OP15. A standard printing receives a value only when the Cardmarket product identity is unique; alternate, promo, reprint, or ambiguous products remain `null`, and the app never uses price to guess identity.
- OPTCG API supplies set, starter-deck, and DON!! printing metadata/art plus non-promo USD references. All 187 DON!! designs share one rules identity while retaining distinct printing IDs.
- [TCGCSV](https://tcgcsv.com/docs) supplies direct TCGplayer product IDs and USD market prices. The current snapshot has 1,655 exact standard-printing mappings, of which 1,650 have positive prices from both markets. All 21 released groups are fetched and audited; PRB01/PRB02 correctly contribute no comparison rows because Cardmarket's public export gives their base and alternate versions indistinguishable titles and numbers. The sync reports these zero-row groups explicitly instead of guessing. It also includes numbered promotional products and exact promo artwork. Explicit Japanese anniversary/version products are labelled Japanese; all other included promo records are source-defensible English. German is not offered.
- Cross-market ratios use the official [ECB daily USD-per-EUR reference rate](https://data.ecb.europa.eu/help/api/data) embedded at sync time. The comparison is `TCGplayer USD / (Cardmarket EUR × USD per EUR)` and always displays the observation date.
- All 5,349 card printings have an exact source-backed image. Seven formerly missing records use individually audited product/printing overrides; the sync asserts every override and never substitutes a different printing's artwork.
- Card numbers are rules identities, not unique collectible variants. The model therefore keeps `rulesCardId`, `printingId`, Cardmarket/TCGplayer product IDs, language evidence, source timestamps, and image state separately.

Run `npm run sync:data` at most once daily from a trusted server/build job. The checked-in GitHub workflow discovers Bandai's released English groups, excludes future release dates, refreshes the snapshot daily, ingests verified catalog/prices, and then captures each account's daily valuation. TCGCSV explicitly requires backend ingestion, a custom User-Agent, and no more than daily polling. Review provider terms and obtain the necessary commercial data/art rights before production redistribution.

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

The scanner requests permission only after an explicit click and uses ZXing to decode QR frames from the live camera. Uploaded QR images are decoded locally in the browser; manual entry and clearly labelled simulation links remain accessible fallbacks. Production store QR codes use `/join/store#token=...`, keeping bearer tokens out of HTTP requests, while the legacy `/join/:code` demo links remain compatible. The store workspace downloads a print-quality SVG.

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
- Retained local fixture adapters for isolated development tests; the production entry never falls back to their session
- Owner-scoped Supabase collection rows, acquisition captures, and daily valuation history for signed-in production players
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
- [`supabase/migrations/202607160002_automatic_acquisition_lots.sql`](supabase/migrations/202607160002_automatic_acquisition_lots.sql)
- [`supabase/migrations/202607200003_store_applications_and_approval.sql`](supabase/migrations/202607200003_store_applications_and_approval.sql)
- [`supabase/migrations/202607200004_store_chat_channels_and_moderation.sql`](supabase/migrations/202607200004_store_chat_channels_and_moderation.sql)
- [`supabase/migrations/20260720180849_physical_store_qr_invites.sql`](supabase/migrations/20260720180849_physical_store_qr_invites.sql)
- [`supabase/migrations/20260721093251_fix_store_join_redemption_ambiguity.sql`](supabase/migrations/20260721093251_fix_store_join_redemption_ambiguity.sql)
- [`supabase/migrations/20260721093619_set_community_member_profiles_security_invoker.sql`](supabase/migrations/20260721093619_set_community_member_profiles_security_invoker.sql)
- [`supabase/migrations/20260721111856_secure_collection_crud_fifo_daily_valuations.sql`](supabase/migrations/20260721111856_secure_collection_crud_fifo_daily_valuations.sql)
- [`supabase/migrations/20260721115011_harden_portfolio_valuation_lot_purchase_v2.sql`](supabase/migrations/20260721115011_harden_portfolio_valuation_lot_purchase_v2.sql)
- [`supabase/migrations/20260721124718_bind_collection_add_to_expected_owner.sql`](supabase/migrations/20260721124718_bind_collection_add_to_expected_owner.sql)
- [`supabase/migrations/20260721131143_collection_owner_archived_catalog_read_v2.sql`](supabase/migrations/20260721131143_collection_owner_archived_catalog_read_v2.sql)
- [`supabase/migrations/20260721153100_clear_collection_lot_purchase_context_v2.sql`](supabase/migrations/20260721153100_clear_collection_lot_purchase_context_v2.sql)
- [`supabase/config.toml`](supabase/config.toml)
- [`supabase/seed.sql`](supabase/seed.sql)
- [`supabase/SECURITY.md`](supabase/SECURITY.md)
- [`supabase/SECURITY_v2.md`](supabase/SECURITY_v2.md)
- [`docs/PRODUCTION_ACCOUNTS_v2.md`](docs/PRODUCTION_ACCOUNTS_v2.md)
- [`docs/PRODUCTION_OPERATIONS_v3.md`](docs/PRODUCTION_OPERATIONS_v3.md)

The migrations model users and profiles, extensible games/catalogs, collections and quantity history, provider mappings/raw responses/quotes/snapshots, reviewed store applications, approved stores, store-owned chat channels, revocable join codes, communities, trades, direct messages, notifications, blocks, reports, moderation evidence, and activity logs. RLS and guarded RPCs make approval and store/community capabilities server-enforced.

The frontend installs `@supabase/supabase-js`, reads only the browser-safe project URL/publishable key, and connects Auth plus account/store-administration workflows. Signed-in player collections use owner-scoped Supabase RPCs and RLS instead of shared browser storage. Each addition creates a timestamped acquisition lot and captures the then-current provider reference; the daily catalog workflow appends current price snapshots and refreshes per-account valuation/growth history. Legacy fixture adapters remain isolated development utilities and are not an authentication fallback. Durable chat-message repositories and message Realtime subscriptions remain a subsequent integration phase.

### Production collection storage and growth

- `collection_items` stores one owner-only holding identity and current quantity.
- `collection_acquisition_lots` records every quantity addition at the server timestamp; users cannot backdate it.
- `collection_acquisition_market_references` preserves the Cardmarket/TCGplayer reference available when that lot was added.
- FIFO disposal allocations preserve the correct remaining acquisition basis when quantity is reduced.
- `collection_daily_valuation_snapshots` stores daily market value, acquisition value, growth, and priced/unpriced coverage per owner and provider.
- RLS plus narrow `SECURITY DEFINER` RPCs derive ownership from `auth.uid()`; production users cannot read or mutate another user's collection.
- `.github/workflows/sync-onepiece-catalog.yml` refreshes official release coverage, market data, database price snapshots, and account valuations daily. The trusted job requires encrypted `SUPABASE_URL` and `SUPABASE_SECRET_KEY` repository secrets; neither belongs in Vite variables.

## Optional Supabase setup

Supabase configuration is required by the shipped application entry. To inspect or adopt the database design:

1. Create a PostgreSQL 15+/Supabase project in an EU region appropriate for the deployment. The current hosted project uses `eu-west-1`; a future region change requires a planned database migration.
2. Apply every file in `supabase/migrations/` in filename order. A linked Supabase CLI can use `supabase db push`.
3. Do **not** apply `supabase/seed.sql` to production; it contains explicit local fixtures and development join codes. Create users through Supabase Auth, never by inserting password hashes.
4. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `.env.example`.
5. Follow `docs/PRODUCTION_OPERATIONS_v3.md` to bootstrap the first platform administrator with a one-time password and exact-UUID role promotion.
6. Configure Auth redirect URLs and custom SMTP, then validate the RLS denial cases against a disposable project before inviting users.
7. Keep provider ingestion and any service-role operation on a trusted server. Never expose the service-role key to Vite client code.

The repository now includes a pinned CLI, production-aware `supabase/config.toml`, and a guarded Auth-user bootstrap. Every deployment must still verify linked migrations, Auth redirects, the exact administrator UUID, and advisor results; production must never include `supabase/seed.sql`.

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
│   ├── ProductionApp_v2.tsx
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
│   ├── production/
│   │   ├── ProductionAccessGate.tsx
│   │   ├── ProductionAuthPanel.tsx
│   │   ├── StoreAccessPanels.tsx
│   │   ├── supabaseProductionAccess.ts
│   │   └── useProductionAccess.ts
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
│       ├── supabase/
│       │   └── client.ts
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
    ├── config.toml
    ├── SECURITY.md
    ├── SECURITY_v2.md
    ├── seed.sql
    └── migrations/
        ├── 202607160001_initial_schema.sql
        ├── 202607160002_automatic_acquisition_lots.sql
        ├── 202607200003_store_applications_and_approval.sql
        ├── 202607200004_store_chat_channels_and_moderation.sql
        ├── 20260720180849_physical_store_qr_invites.sql
        ├── 20260721093251_fix_store_join_redemption_ambiguity.sql
        └── 20260721093619_set_community_member_profiles_security_invoker.sql
```

## Honest limitations

- Real Supabase authentication, player/store onboarding, store approval, protected roles, owner-scoped collections, and chat-channel administration are connected. Missing Supabase configuration fails closed.
- Trade posts, community message bodies, direct messages, and most notification changes are still managed by the existing browser UI rather than durable Supabase repositories.
- Joined-community presentation, chats, trades, conversations, and notification changes still reset on refresh; collection holdings and daily growth history do not.
- The database publishes protected application, channel, message, and notification changes, but the current client does not yet provide full multi-user chat delivery, offline queueing, or server retry behavior.
- The store map uses interactive MapLibre with OpenStreetMap raster tiles. It shows approved Supabase store rows in production and six Dresden fixtures only in the local development adapter; the distance selector is still presentational and does not yet calculate geospatial distance or clustering.
- Live camera and uploaded-image QR decoding depend on browser media support and image quality; manual code entry remains the guaranteed accessible fallback.
- Production QR token hashes and lifecycle metadata are persisted in Supabase; raw tokens are returned only once and remain in short-lived browser join intent storage.
- Portfolio and item charts show only the two source-backed endpoints (Cardmarket current trend versus the selected rolling average), not an invented transaction history. The SQL seed still includes 31 days of database snapshots for a future adapter.
- Cardmarket, OPTCG, and TCGCSV data are generated daily snapshots, not streaming quotes. The Dresden stores remain illustrative registered app records, not verified real businesses.
- Cross-market ratios cover only exact English base printings with both provider identities and positive daily prices. They exclude alternate arts without a two-provider match, and do not include fees, tax, shipping, condition adjustments, liquidity, or executable sale prices.
- No publisher artwork is bundled locally. Every card printing loads exact remote art from its recorded/audited source; redistribution and hotlink permission still require deployment review.
- Account creation, password reset, and durable owner-scoped collections are connected through Supabase. Avatar upload, durable message adapters, notification delivery, and parts of the report/block UI remain to be connected.
- No email, push, payment, sale, auction, escrow, shipping, or store inventory integration is included.
