# TCG Harbor database security model v2

This document extends `SECURITY.md` for migrations
`202607200003_store_applications_and_approval.sql` and
`202607200004_store_chat_channels_and_moderation.sql`. The original document is
preserved because it describes the v1 schema boundary.

## Identity and capabilities

- Supabase Auth is the identity authority. `app_users.roles` and protected
  assignment tables are the authorization authority.
- `user_profiles.account_kind` and Auth `user_metadata.account_kind` are only
  onboarding preferences. Users can influence those values, so neither is
  trusted for authorization.
- Every active account has player access to its own private data. Store
  capabilities are additive and require a non-revoked `store_administrators`
  assignment created by the approval workflow.
- Platform administration is a protected role bootstrapped through trusted SQL
  or future server-side tooling. Signup can never assign it.

## Store registration and approval

- Applicants invoke a security-definer submission RPC; direct table mutations
  and direct store creation are not granted.
- Applicants can select only their own application history. Platform
  administrators can select the review queue.
- Only `review_store_application` accepts a decision, and it checks the caller's
  protected platform role.
- Approval is transactional. It creates a verified/active store, the default
  community, the owner assignment, an active moderator membership, a user
  notification, and an activity record. Any failure rolls back the decision.
- Public store/community reads require a verified, active, non-deleted store.
- Authenticated clients receive only a column whitelist for store updates;
  verification, activation, deletion, identifiers, and slugs are not included.

## Store group chats

- A community is the store membership boundary; `community_channels` are named
  group chats inside it.
- A composite foreign key requires every message channel to belong to the same
  community as the message.
- Active members may read active channels and non-deleted messages and post only
  as themselves. Store/platform administrators manage channel structure through
  narrow RPCs, not direct table writes.
- Store owners can create, edit, and archive non-default channels. Every store
  retains one active, non-archivable General channel.
- Community moderators may remove messages but cannot restructure channels.
- Deleted message provenance is server-assigned and cannot be restored or
  rewritten by the author. Moderators retain an evidence view; ordinary members
  do not receive deleted bodies.
- Store/community/platform roles never grant direct-message visibility. Direct
  messages remain participant-only.

## Moderation and audit

- Store and platform administrators can appoint moderators. A community
  moderator cannot moderate another moderator; only a platform administrator
  can moderate a store administrator.
- Message removal, membership status changes, and role changes create immutable
  `moderation_actions` rows.
- Moderation helpers require an active application account and an active
  community under a verified, active store.
- Direct client updates to community identity/lifecycle fields are revoked.
  Presentation and rules changes use a field-whitelisted RPC.

## Secrets, files, and operations

- Only the Supabase URL and publishable/anon key may enter the Vite bundle. The
  service-role key bypasses RLS and must stay in trusted server infrastructure.
- Verification evidence is currently an optional URL in a private application
  row. Before accepting uploads, create a private Storage bucket with
  applicant/platform-only object policies and malware/content controls.
- Free-plan projects need scheduled off-site database dumps. Do not apply
  `seed.sql` to production because it contains fake stores and development join
  codes.
- Configure custom SMTP, redirect allow lists, abuse controls, retention, and
  monitoring before inviting the public.

## Mandatory integration tests

Validate with at least two players, two stores, one owner, one community
moderator, and one platform administrator:

1. applicant self-approval and cross-applicant reads fail;
2. approval creates every dependent row exactly once;
3. unverified stores never appear publicly;
4. cross-store channel reads and mutations fail;
5. removed message bodies disappear for members and cannot be restored;
6. moderator hierarchy and immutable audit rows hold;
7. revoked/suspended users lose community and channel access;
8. store and platform roles cannot read participant direct messages;
9. Realtime subscriptions return no rows that the same user cannot select;
10. a database dump can be restored into a disposable project.
