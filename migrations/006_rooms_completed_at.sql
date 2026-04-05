-- Add explicit completion timestamp for completed room ordering.
ALTER TABLE public.rooms
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

-- Backfill missing completion times for already completed rooms.
UPDATE public.rooms
SET completed_at = created_at + (COALESCE(total_play_time_seconds, 0) * INTERVAL '1 second')
WHERE status = 'completed'
  AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rooms_completed_at
  ON public.rooms (completed_at DESC)
  WHERE status = 'completed';
