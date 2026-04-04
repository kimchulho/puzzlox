-- rooms: stable creator reference for "my rooms" and listing private active rooms for the creator.
-- users.id is BIGINT in this project (not UUID).
-- Run in Supabase SQL Editor, or via apply script using exec_sql RPC if configured.

-- If a failed attempt added created_by as the wrong type, drop it first:
-- ALTER TABLE rooms DROP COLUMN IF EXISTS created_by;

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS created_by BIGINT NULL REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pixi_rooms_created_by
  ON rooms (created_by)
  WHERE created_by IS NOT NULL;

COMMENT ON COLUMN rooms.created_by IS 'users.id when the room was created by a logged-in user; NULL for guests or legacy rows.';

-- If Row Level Security hides private rows from the anon key, add a policy so creators can read their own rooms.
-- Match created_by to your JWT user id claim (type must match BIGINT), e.g.:
-- USING (is_private = false OR created_by = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint);

