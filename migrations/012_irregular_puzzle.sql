-- Irregular (SVG-defined) puzzle templates and room linkage.

CREATE TABLE IF NOT EXISTS public.irregular_puzzle_templates (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  cut_kind TEXT NOT NULL DEFAULT 'generic'
    CHECK (cut_kind = ANY (ARRAY['generic'::text, 'image_specific'::text])),
  svg_url TEXT NOT NULL,
  definition JSONB NOT NULL,
  piece_count INTEGER NOT NULL,
  assembly_count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NULL DEFAULT timezone('utc'::text, now()),
  created_by BIGINT NULL,
  CONSTRAINT irregular_puzzle_templates_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL
) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_irregular_templates_created_at
  ON public.irregular_puzzle_templates USING btree (created_at DESC) TABLESPACE pg_default;

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS puzzle_kind TEXT NOT NULL DEFAULT 'regular'
    CHECK (puzzle_kind = ANY (ARRAY['regular'::text, 'irregular'::text]));

ALTER TABLE public.rooms
  ADD COLUMN IF NOT EXISTS irregular_template_id INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rooms_irregular_template_id_fkey'
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_irregular_template_id_fkey
      FOREIGN KEY (irregular_template_id)
      REFERENCES public.irregular_puzzle_templates (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rooms_irregular_template
  ON public.rooms USING btree (irregular_template_id) TABLESPACE pg_default
  WHERE irregular_template_id IS NOT NULL;

ALTER TABLE public.irregular_puzzle_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "irregular_templates_select_public" ON public.irregular_puzzle_templates;
CREATE POLICY "irregular_templates_select_public"
  ON public.irregular_puzzle_templates
  FOR SELECT
  USING (true);
