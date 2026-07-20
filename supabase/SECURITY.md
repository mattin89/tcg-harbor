# TCG Harbor database security notes

The migration in `migrations/202607160001_initial_schema.sql` assumes PostgreSQL
15+ on Supabase. Supabase Auth (`auth.users`) is the identity authority;
`app_users` is a protected application shadow and `user_profiles` stores private
onboarding preferences. RLS predicate helpers live in a non-exposed `private` schema,
so their security-definer parameters cannot be used as public PostgREST enumeration
RPCs.

## Authorization boundaries

- Collection rows, quantity history, cost basis, notes, preferences, notifications,
  and activity are owner-only. There is no platform- or store-admin RLS bypass.
- The community directory is a deliberately narrow security-definer view containing
  only username, display name, avatar, role, and join date. It omits email, location,
  market preferences, holdings, cost basis, and private notes.
- Chat, membership-directory rows, trade posts, trade items, and captured trade
  references require an active membership in that exact community. Suspension,
  leaving, store deactivation, or community deactivation removes access.
- A trade item copies only the explicitly offered catalog identity, condition,
  language, and quantity. Its optional source collection row stays protected by
  owner-only collection RLS. Market references are trigger-captured into a table
  without client write grants; there is no sale-price field.
- One-to-one conversations can only be opened through
  `create_direct_conversation(other_user_id, context_community_id)`. The function
  proves both users are active in the selected community, checks bilateral blocks,
  canonicalizes/locks the pair, and creates both participant rows atomically.
  Sending re-checks that some active community is still shared. DM RLS has only a
  participant policy: store moderators, store administrators, and platform
  administrators gain no visibility merely from their role. The trusted Supabase
  `service_role` remains an operational bypass and must never be exposed to clients.
- Store join codes are bearer onboarding tokens whose raw value is returned only at
  creation. The table stores SHA-256 digests and a short non-secret prefix. Clients
  validate/redeem through RPCs; the admin view excludes the digest. Revocation,
  expiry, usage caps, duplicate memberships, and per-user attempt limits are enforced
  under row locks.

## Abuse and data-integrity controls

- Database triggers cap community chat (12/minute), DMs (20/minute), trade posts
  (6/hour), and QR redemption attempts (10/15 minutes). Authenticated message/trade
  timestamps are server-assigned so backdating cannot bypass these limits. Production
  deployments should add edge/WAF IP and device limits as a second layer.
- User text is normalized, length-limited, and treated as plain text. The application
  must still render it escaped and apply Zod validation before database writes.
- XOR constraints protect every card-variant/sealed-product polymorphic relation.
  Price triggers require denormalized targets, condition, language, provider, and
  provider product ID to match their stable mapping.
- Collection quantity events are append-only, enabling historical portfolio math to
  separate inventory changes from price movement.
- Provider credentials are never stored in public tables. `credential_secret_name`
  names a server-side secret. Original payloads are isolated in the no-client-grant
  `provider_raw_responses` table; normalized quotes link to them by an idempotent
  provider request ID. Only trusted ingestion jobs write mappings, raw responses,
  quotes, and snapshots. Cache expiry, sync locks, failure counters, and refresh/rate
  fields support respectful licensed integrations.
- Realtime is enabled only for community messages, direct messages, and notifications;
  subscriber delivery is still filtered by each table's RLS policy.

## Seed operation

`seed.sql` always installs public catalog/store/community/hashed-code/market fixtures.
User-owned fixtures are conditional on the four documented Auth UUID placeholders.
Create those users through Supabase Auth, not direct password-hash SQL. If the Auth
fixture tool cannot preserve explicit IDs, substitute its generated IDs in the seed's
conditional DO block, then rerun. Every seeded quote is marked `demo_fixture`; no
fixture is represented as live Cardmarket or TCGPlayer data.
