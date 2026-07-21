# Production accounts and store onboarding v2

This is the first production-authentication slice for TCG Harbor. It preserves
the original browser demo as a no-configuration fallback, while a configured
Supabase project activates real sessions, player/store onboarding, store
applications, administrator review, and database-enforced permissions.

## Product model

Accounts are capability-based, not mutually exclusive personas:

- Every authenticated account remains a player and keeps collection, market,
  map, community, and messaging functionality.
- Selecting **Store** during signup records an onboarding preference only. It
  grants no store permissions.
- A store applicant submits an address, contact details, map coordinates, and
  optional verification evidence.
- Only an existing `platform_administrator` can approve the application.
- Approval runs as one database transaction: it creates a verified store,
  creates its default community/chat, assigns the applicant as store
  administrator and moderator, activates their membership, and writes a
  notification and audit event.
- Store and community permissions are derived from protected assignment rows
  and RLS helpers. Client-editable Auth metadata and `account_kind` are never
  authorization inputs.

## Data placement on the free tier

Use Supabase Postgres for durable user-generated state:

- profiles and protected roles;
- collections, quantities, acquisition-value snapshots, and preferences;
- store applications and approval evidence references;
- approved stores, coordinates, opening hours, and administrators;
- community memberships, chat channels/messages, reports, and audit events.

Keep the large immutable card catalogue and permitted card-art URLs in
versioned static data/CDN assets. Do not copy image binaries into Postgres.
Initially restrict Supabase Storage to small avatars, store logos, and private
verification files. This separation protects the Free plan's 500 MB database
allowance.

## Create the Supabase project

1. Create a Supabase project in an appropriate EU region and record the actual
   region in the environment runbook. Changing region later is a database
   migration, not a configuration toggle.
2. Apply migrations in filename order. Do not run `supabase/seed.sql` against
   production; it contains obvious local fixtures and development join codes.
3. In Supabase Auth, set the Site URL to the production Render URL and add the
   exact local and production callback URLs. Email confirmation for a pending
   store invitation returns to `http://127.0.0.1:4173/join/store` locally or
   `https://YOUR-RENDER-HOST/join/store` in production. Add those exact URLs
   rather than a broad production wildcard. URL fragments are never part of
   the redirect allow-list because browsers do not send them to the server.
4. Copy the project URL and publishable key into local `.env`:

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_BROWSER_SAFE_KEY
   ```

5. Add the same two `VITE_` variables to the Render static-site environment and
   redeploy. Never add `SUPABASE_SERVICE_ROLE_KEY` to a Vite/browser variable.
6. Configure custom SMTP before inviting real users. Supabase's default email
   sender is intended only for initial testing and has a very small rate limit.

Production QR links use `/join/store#token=...`. The client captures the
fragment and immediately replaces the visible URL with `/join/store`, keeping
the bearer token out of Render/CDN request logs and HTTP Referer headers. The
same-tab intent expires after 30 minutes. A one-time local-storage handoff is
created only when email confirmation is required, expires after 15 minutes,
and is removed when claimed or when the join reaches a terminal state.

## Bootstrap the first platform administrator

There is intentionally no public "make me administrator" endpoint. First sign
up normally and verify the email. Capture the exact Auth user UUID from a
trusted operator workflow, then run this once through the trusted Supabase SQL
editor. The UUID, active profile, email, and confirmation state must all match:

```sql
update public.app_users as app_user
set roles = case
  when 'platform_administrator'::public.app_role = any(app_user.roles)
    then app_user.roles
  else array_append(app_user.roles, 'platform_administrator'::public.app_role)
end
where app_user.id = 'RETURNED_AUTH_USER_UUID'::uuid
  and app_user.status = 'active'
  and exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = app_user.id
      and lower(auth_user.email) = lower('ADMIN_EMAIL_HERE')
      and auth_user.email_confirmed_at is not null
  )
returning app_user.id, app_user.email, app_user.roles;
```

Exactly one returned row with the administrator role is the evidence that the
bootstrap succeeded. A zero-row result is a hard stop; never broaden the
predicate to email alone. Future reviewer assignments should use a separate
audited server-side administrative workflow.

## Approval invariants

`202607200003_store_applications_and_approval.sql` enforces these rules:

- applicants can read only their own application history;
- applicants cannot approve themselves or write directly to stores;
- only platform administrators can call the review RPC;
- public store discovery requires both `is_verified` and `is_active`;
- ordinary store administrators cannot change verification, activation,
  deletion, IDs, or slugs;
- the approved owner is inserted into the community as an active moderator, so
  chat read/post/moderation policies work immediately;
- rejection requires a reason, and both decisions produce user-visible and
  auditable records.

The follow-up chat-channel migration provides store-scoped group-chat
management while keeping direct messages inaccessible to store staff.

## Required validation before public use

Run integration tests against a disposable Supabase project for:

1. player sign-up, email confirmation, session restore, and sign-out;
2. store sign-up without privileges before approval;
3. applicant self-approval denial;
4. atomic approval and correct administrator/moderator membership;
5. unverified-store invisibility and cross-store RLS isolation;
6. store-channel creation, member access, moderator deletion, and audit rows;
7. direct-message privacy from store and platform administrators;
8. suspended-account behavior;
9. password reset redirect allow-listing;
10. external database dumps and restore drills.

## Free-tier operating constraints

At the time this integration was designed, Supabase Free includes 50,000 MAU,
a 500 MB database, 1 GB file storage, 2 million Realtime messages per month, 200
peak Realtime connections, and 500,000 Edge Function invocations. Free projects
may pause after a week of low activity, and downloadable automatic backups are
not included. Schedule regular off-site `supabase db dump` exports from the
beginning.

Official references:

- https://supabase.com/pricing
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/auth/users
- https://supabase.com/docs/guides/realtime/authorization
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/auth/auth-smtp
