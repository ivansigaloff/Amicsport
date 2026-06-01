-- Migration: match_date_trigger
-- Date: 2026-06-01
--
-- Closes review risk R3: matches with match_date NULL are invisible in the
-- default list (`.gte('match_date', today)` excludes NULL). The 2026-05-29
-- backfill set match_date for existing rows, but any write path that sets the
-- display `date` string without computing `match_date` recreates the hole and
-- the match silently disappears.
--
-- Fix: a BEFORE INSERT/UPDATE trigger that derives match_date from the Spanish
-- display `date` whenever match_date is missing — same parse the backfill used.
-- It only fills when match_date IS NULL, so the app's explicit writes (which set
-- both) are never overridden. Genuinely unparseable dates stay NULL (admin-only
-- "show past" view), same as before.
--
-- PROD ONLY: match_date lives only on `matches` (the original column migration
-- never added it to matches_dev). The dev split is dormant — like
-- reserve_paid_slot / join_match, this targets prod only. (The defensive drop
-- below clears any matches_dev trigger left by an earlier failed attempt.)

-- ── 1. Derivation function (mirrors lib/date.ts parseMatchDate / the backfill) ─
CREATE OR REPLACE FUNCTION public.set_match_date_from_date()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  toks      text[];
  v_day     int;
  v_mon_tok text;
  v_month   int;
  v_date    date;
BEGIN
  -- Only derive when the real date is missing but a display string exists.
  IF NEW.match_date IS NOT NULL OR NEW.date IS NULL OR btrim(NEW.date) = '' THEN
    RETURN NEW;
  END IF;

  -- Tokenize: "lun, 12 abr." -> {lun,12,abr} (or "12 abr" -> {12,abr}).
  toks := regexp_split_to_array(btrim(lower(regexp_replace(NEW.date, '[.,]', '', 'g'))), '\s+');

  v_day := NULLIF(regexp_replace(
             CASE WHEN array_length(toks, 1) >= 3 THEN toks[2] ELSE toks[1] END,
             '\D', '', 'g'), '')::int;
  v_mon_tok := CASE WHEN array_length(toks, 1) >= 3 THEN toks[3] ELSE toks[2] END;

  v_month := CASE
    WHEN v_mon_tok LIKE 'ene%' THEN 1  WHEN v_mon_tok LIKE 'feb%' THEN 2
    WHEN v_mon_tok LIKE 'mar%' THEN 3  WHEN v_mon_tok LIKE 'abr%' THEN 4
    WHEN v_mon_tok LIKE 'may%' THEN 5  WHEN v_mon_tok LIKE 'jun%' THEN 6
    WHEN v_mon_tok LIKE 'jul%' THEN 7  WHEN v_mon_tok LIKE 'ago%' THEN 8
    WHEN v_mon_tok LIKE 'sep%' THEN 9  WHEN v_mon_tok LIKE 'oct%' THEN 10
    WHEN v_mon_tok LIKE 'nov%' THEN 11 WHEN v_mon_tok LIKE 'dic%' THEN 12
    ELSE NULL END;

  -- Unparseable → leave NULL (same as the backfill).
  IF v_day IS NULL OR v_day < 1 OR v_day > 31 OR v_month IS NULL THEN
    RETURN NEW;
  END IF;

  v_date := to_date(extract(year FROM now())::int || '-' || v_month || '-' || v_day, 'YYYY-MM-DD');
  -- More than 2 months in the past → assume next year (matches parseMatchDate).
  IF v_date < (current_date - interval '2 months') THEN
    v_date := (v_date + interval '1 year')::date;
  END IF;

  NEW.match_date := v_date;
  RETURN NEW;
END;
$$;

-- ── 2. Trigger on prod matches ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS matches_set_match_date ON public.matches;
CREATE TRIGGER matches_set_match_date
  BEFORE INSERT OR UPDATE ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.set_match_date_from_date();

-- Defensive: remove any matches_dev trigger created by an earlier failed run
-- (matches_dev has no match_date column, so such a trigger would error on write).
DROP TRIGGER IF EXISTS matches_dev_set_match_date ON public.matches_dev;

-- ── 3. Backfill existing parseable NULLs by firing the trigger (no-op update) ─
UPDATE public.matches SET date = date WHERE match_date IS NULL AND date IS NOT NULL AND btrim(date) <> '';
