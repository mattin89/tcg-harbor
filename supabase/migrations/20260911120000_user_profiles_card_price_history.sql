-- Add card_price_history column to public.user_profiles to record daily average card prices
alter table public.user_profiles
  add column if not exists card_price_history jsonb not null default '{}'::jsonb;

comment on column public.user_profiles.card_price_history is
  'Historical daily card average prices captured per market for the user collection chart.';
