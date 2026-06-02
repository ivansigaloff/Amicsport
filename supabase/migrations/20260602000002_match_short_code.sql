-- Migration: match_short_code
-- Date: 2026-06-02
--
-- ADDITIVE: a short, human-friendly code per match for the WhatsApp deep links
-- (wa.me?text=VOY <code>). New nullable column + a BEFORE INSERT trigger that
-- fills it; existing reads/writes are unaffected. Prod-only (the WhatsApp flow
-- is prod, like join_match_as).
--
-- 4 chars from an unambiguous alphabet (no 0/O/1/I/L), unique. ~810k combos.

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS short_code text;
CREATE UNIQUE INDEX IF NOT EXISTS matches_short_code_idx
  ON public.matches (short_code) WHERE short_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.gen_match_short_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- 30 chars, no 0 O 1 I L
  code text;
  i int;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..4 LOOP
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.matches WHERE short_code = code);
  END LOOP;
  RETURN code;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_match_short_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.short_code IS NULL THEN
    NEW.short_code := public.gen_match_short_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_set_short_code ON public.matches;
CREATE TRIGGER matches_set_short_code
  BEFORE INSERT ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_match_short_code();

-- Backfill existing rows one at a time so each gen() call sees the prior
-- assignments (a single set-based UPDATE wouldn't, risking intra-statement
-- collisions on the unique index).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.matches WHERE short_code IS NULL LOOP
    UPDATE public.matches SET short_code = public.gen_match_short_code() WHERE id = r.id;
  END LOOP;
END $$;
