-- Public profile: others may see aggregates & room participation, but never image URLs for rooms this user created.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_public BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.profile_public IS
  'When true, GET /api/profile/:username returns stats and room list; image_url is omitted for rooms created_by this user.';
