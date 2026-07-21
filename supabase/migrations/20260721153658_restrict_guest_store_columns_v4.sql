-- Guests may discover approved stores, but store application contact details
-- remain private. RLS continues to restrict rows to verified, active stores.
revoke select on table public.stores from anon;

grant select (
  id,
  slug,
  name,
  description,
  address_line_1,
  address_line_2,
  city,
  region,
  postcode,
  country_code,
  latitude,
  longitude,
  timezone,
  opening_hours,
  website_url,
  image_url,
  is_verified,
  is_active,
  created_at,
  updated_at,
  deleted_at
) on table public.stores to anon;
