-- Per-user room visit times for cross-device "이어하기" (continue) labels and ordering.
-- pixi_users.id and pixi_rooms.id types must match your schema (BIGINT / INTEGER).

CREATE TABLE IF NOT EXISTS pixi_user_room_visits (
  user_id BIGINT NOT NULL REFERENCES pixi_users (id) ON DELETE CASCADE,
  -- Use the same type as pixi_rooms.id (often INTEGER; if yours is BIGINT, change this column).
  room_id INTEGER NOT NULL REFERENCES pixi_rooms (id) ON DELETE CASCADE,
  last_visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_pixi_user_room_visits_user_time
  ON pixi_user_room_visits (user_id, last_visited_at DESC);

COMMENT ON TABLE pixi_user_room_visits IS 'Last time a logged-in user entered a room; used for Continue (이어하기) across devices.';

-- If RLS is enabled, allow the anon role to upsert/select own rows (match your auth model), e.g. using request.user_id from a custom JWT.
