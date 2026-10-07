# Repository Guidelines & Agent Operational Rules

## 1. Zero Mutation of Production User Collections & Inventories
* **Strict Boundary:** Never execute SQL statements, CLI commands, migrations, or scripts that directly insert, update, or delete records in `public.collection_items`, `public.collection_acquisition_lots`, `public.collection_quantity_history`, `public.collection_disposal_events`, or `public.collection_daily_valuation_snapshots` for real user accounts in the remote/production database.
* **No Artificial Feature Seeding:** When asked to support new cards, sets, art variants, languages, or products in the inventory or catalog, implement features strictly at the **catalog data layer** (`onepiece-market-v10.json`, `cards`, `card_variants`, `sealed_products`) and UI search/filter layer. Never attempt to "demonstrate" or "seed" catalog capabilities by artificially inserting sample items into an active user or store operator's personal collection.
* **Development Seeding Only:** Test and demo inventory fixtures belong exclusively in local development environments via `supabase/seed.sql` for designated test accounts.

## 2. Catalog Immutability & Provenance
* Frozen snapshots like `onepiece-market-v10.json` must preserve historical integrity and provider continuity.
* Do not synthesize unreleased or non-existent cards (e.g. Bandai does not print German One Piece cards).
* Any administrative catalog overrides must use the verified admin storage schema (`adminCatalogStore.ts`) rather than ad-hoc table mutations.
