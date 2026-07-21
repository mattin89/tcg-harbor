# TCG Harbor production operations v3

This runbook covers the production account, physical-store QR, and store-group
moderation release. It supplements `PRODUCTION_ACCOUNTS_v2.md`; the v2 file is
preserved as the design record for the preceding authentication slice.

## Current deployment state

As of 2026-07-21, all twelve migrations and the reviewed Auth configuration have
been applied to the linked hosted project. The frontend release remains tied to
the Git commit deployed by Render. Always verify the current migration list,
advisor results, deployed commit, and administrator role in each environment;
a successful frontend build is not evidence that those controls are live.

## Secret boundaries

- The browser receives only `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY` (or the legacy browser-safe anon key).
- `SUPABASE_SECRET_KEY`, the legacy service-role key, database passwords, and
  CLI access tokens are server/operator secrets. Never put them in a `VITE_`
  variable, Git, Render's client bundle, a QR code, or a chat transcript.
- The one-time administrator bootstrap script rejects a publishable key and
  never grants a role based on email alone. Promotion must target the UUID
  returned by Supabase Auth.

Official references:

- https://supabase.com/docs/guides/getting-started/api-keys
- https://supabase.com/docs/reference/javascript/auth-admin-createuser
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Hosted Auth configuration

In the hosted project's Auth URL settings, use:

- Site URL: `https://tcg-harbor.onrender.com/`
- Redirect URLs: `https://tcg-harbor.onrender.com/` and
  `https://tcg-harbor.onrender.com/join/store`
- Development redirect URLs: `http://127.0.0.1:4173/` and
  `http://127.0.0.1:4173/join/store`

These exact paths cover password reset and the email-confirmation handoff
without granting arbitrary callback paths. Keep email confirmation enabled.
Configure custom SMTP before public signup;
the default sender is suitable only for limited testing. Passwords are set to
12 or more characters and must contain upper-case, lower-case, numeric, and
symbol characters in `supabase/config.toml` for local parity.

Reference: https://supabase.com/docs/guides/auth/redirect-urls

## Link and apply the database

Run these commands from the repository root. Login opens an interactive flow,
so it must be completed in the project owner's own terminal; never paste the resulting
access token into chat.

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase db lint --linked --level warning --fail-on error
npx supabase db advisors --linked --type security --level warn --fail-on error
npx supabase db advisors --linked --type performance --level warn --fail-on error
```

Do not add `--include-seed`. `supabase/seed.sql` contains documented local demo
identities and join codes and must never be applied to production. Migration
`20260720180849_physical_store_qr_invites.sql` defensively retires the six
known fixture IDs if they were previously loaded into a hosted project.

Reference: https://supabase.com/docs/guides/deployment/database-migrations

## Bootstrap the first platform administrator

After migrations are live, run the guarded utility from a trusted local shell
with `SUPABASE_URL`, a server-only `SUPABASE_SECRET_KEY`, and `ADMIN_EMAIL` set
in that process. Do not write the secret to a checked-in file.

```powershell
$env:BOOTSTRAP_ADMIN_CONFIRM = "CREATE_TCG_HARBOR_PLATFORM_ADMIN"
$env:ADMIN_EMAIL = "ADMIN_EMAIL_HERE"
$env:ADMIN_USERNAME = "platform_admin"
$env:ADMIN_DISPLAY_NAME = "Platform Administrator"
npm run bootstrap:admin
```

The utility creates an email-confirmed Auth user and prints a one-time random
temporary password plus the exact user UUID. It deliberately does not assign
authorization. Promote only that returned UUID with a linked database query:

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

Exactly one row must be returned and its roles must contain
`platform_administrator`. If no row returns, stop; do not broaden the `where`
clause. Sign in once with the temporary password, replace it immediately, and
do not retain the temporary credential in notes or CI logs.

## Physical-store QR lifecycle

- Each approved, active physical store can have one active primary QR.
- Generate and rotate return a 256-bit `thq_` token once. The database stores
  only its SHA-256 digest and a redacted prefix.
- The QR URL uses `/join/store#token=...`. A URL fragment is not sent in the
  HTTP request; the client extracts it and immediately removes it from browser
  history before calling Supabase.
- Rotation revokes the printed predecessor atomically. Revocation remains
  available even if the store is later inactive.
- A player must have an active, non-anonymous account. An ordinary `left`
  membership can be reactivated; a moderator suspension cannot be bypassed by
  scanning the QR again.
- A QR is still a bearer invitation: somebody can photograph and forward it.
  Stores should rotate any code that is posted outside the intended venue.

## Store group moderation

An active `store_administrators` assignment authorizes management of that
store's community channels and guarded removal of its messages. Message removal
is a soft delete: members no longer receive the body, while actor, target,
reason, channel, and timestamp remain in the immutable moderation audit.
Store/platform roles do not bypass participant-only direct-message access.

Store authority is removed only through the platform-only
`revoke_store_administrator` RPC. An assigned administrator cannot leave,
demote, or suspend only their membership while silently retaining store powers.
Revocation locks and updates the assignment, membership, protected role arrays,
and audit records as one transaction. It requires a reason, forbids
self-revocation, and requires at least one other effective active administrator;
assign a replacement before removing a store's sole owner. Store closure is a
separate future operation and must not be simulated by partial row edits.

## Release verification

Before public signup, test with two stores and at least three separate users:

1. An unapproved store cannot generate a QR or appear in public discovery.
2. Store A cannot list, rotate, revoke, or moderate Store B.
3. A signed-out scan survives sign-in/email confirmation without leaving the
   raw token in the address bar, history, request path, or referrer.
4. Concurrent generation leaves one active primary code; rotation immediately
   rejects the previous printed code.
5. A player can join once, receives `already_member` on a repeat scan, can
   rejoin after leaving, and cannot rejoin while suspended.
6. A store administrator can remove a community message with a required reason
   but cannot read any participant direct message.
7. Membership leave/suspend/demote cannot partially disable an assigned store
   administrator; explicit revocation fails for self and the last effective
   administrator and succeeds atomically after a replacement exists.
8. The administrator account opens the approval area and self-approval remains
   impossible for an ordinary store applicant.
9. Database lint and both advisor commands complete without unresolved errors.
