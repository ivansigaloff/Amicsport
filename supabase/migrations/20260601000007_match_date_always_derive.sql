-- Migration: match_date_always_derive
-- Date: 2026-06-01
--
-- Closes review risk R2 (date / match_date drift). The admin picks a localized
-- display string `date` ("Lun 12 Abr"); `match_date` (the real sortable date the
-- list orders/filters by) is derived from it. They can drift if a write touches
-- one without the other.
--
-- This upgrades the R3 trigger from "derive match_date only when NULL" to
-- "ALWAYS derive match_date from `date` when `date` is parseable", making
-- match_date a pure function of `date` so the two can never disagree. The app
-- already computes match_date the same way (lib/date.ts parseMatchDate), so this
-- produces identical values — it just enforces the invariant server-side.
--
-- LIMITATION (tracked separately): `date` has no year, so the year is guessed
-- (>2 months in the past -> next year). That's the existing design and is fine
-- for near-term matches; far-future / recurring matches need a real-date input
-- (match_date as the authoritative source). Out of scope here.

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
  -- No display string → can't derive; leave match_date as provided.
  IF NEW.date IS NULL OR btrim(NEW.date) = '' THEN
    RETURN NEW;
  END IF;

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

  -- Unparseable → leave match_date as provided (don't clobber with NULL).
  IF v_day IS NULL OR v_day < 1 OR v_day > 31 OR v_month IS NULL THEN
    RETURN NEW;
  END IF;

  v_date := to_date(extract(year FROM now())::int || '-' || v_month || '-' || v_day, 'YYYY-MM-DD');
  IF v_date < (current_date - interval '2 months') THEN
    v_date := (v_date + interval '1 year')::date;
  END IF;

  -- ALWAYS set (not only when NULL) → date and match_date can never drift.
  NEW.match_date := v_date;
  RETURN NEW;
END;
$$;

-- NO blanket backfill here: re-deriving existing rows would re-run the year
-- guess against TODAY and wrongly push past matches to next year (e.g. a "12
-- Mar" match seen in June becomes 2027). Existing rows already have a correct
-- match_date from the original backfill; the trigger only governs new writes.
