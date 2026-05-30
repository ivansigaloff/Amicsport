-- A1: give matches a real, sortable date so the app can filter/order/limit
-- upcoming matches server-side instead of downloading the entire history and
-- filtering in JS.
--
-- The existing `date` column is a localized DISPLAY string (e.g. "lun, 12 abr")
-- with no year, so it cannot be used in WHERE/ORDER BY. We add `match_date`
-- (a real date) alongside it; `date`/`time` stay for display.
--
-- ROLLOUT ORDER (important):
--   1. Apply this migration (adds + backfills match_date).
--   2. Deploy the app build that WRITES match_date on create/edit/duplicate and
--      READS with `.gte('match_date', today)`. The read path depends on this
--      column existing and being backfilled, so the migration must go first.

-- 1. Column + index ---------------------------------------------------------
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_date date;
CREATE INDEX IF NOT EXISTS idx_matches_match_date ON matches (match_date);

-- 2. Backfill existing rows -------------------------------------------------
-- Mirrors lib/date.ts parseMatchDate: take the day + month tokens from the
-- Spanish display string and guess the year (if the resulting date is more
-- than 2 months in the past, assume it belongs to next year).
-- Rows whose `date` cannot be parsed are left NULL (they only surface in the
-- admin "show past" view, never in the default upcoming list).
WITH t AS (
  SELECT id,
         regexp_split_to_array(btrim(lower(regexp_replace(date, '[.,]', '', 'g'))), '\s+') AS toks
  FROM matches
  WHERE match_date IS NULL AND date IS NOT NULL AND btrim(date) <> ''
),
picked AS (
  SELECT id,
         NULLIF(regexp_replace(
           CASE WHEN array_length(toks, 1) >= 3 THEN toks[2] ELSE toks[1] END,
           '\D', '', 'g'), '')::int AS day,
         CASE WHEN array_length(toks, 1) >= 3 THEN toks[3] ELSE toks[2] END AS mon_tok
  FROM t
),
mapped AS (
  SELECT id, day,
         CASE
           WHEN mon_tok LIKE 'ene%' THEN 1  WHEN mon_tok LIKE 'feb%' THEN 2
           WHEN mon_tok LIKE 'mar%' THEN 3  WHEN mon_tok LIKE 'abr%' THEN 4
           WHEN mon_tok LIKE 'may%' THEN 5  WHEN mon_tok LIKE 'jun%' THEN 6
           WHEN mon_tok LIKE 'jul%' THEN 7  WHEN mon_tok LIKE 'ago%' THEN 8
           WHEN mon_tok LIKE 'sep%' THEN 9  WHEN mon_tok LIKE 'oct%' THEN 10
           WHEN mon_tok LIKE 'nov%' THEN 11 WHEN mon_tok LIKE 'dic%' THEN 12
           ELSE NULL
         END AS month
  FROM picked
),
guessed AS (
  SELECT id,
         to_date(extract(year FROM now())::int || '-' || month || '-' || day, 'YYYY-MM-DD') AS d0
  FROM mapped
  WHERE day BETWEEN 1 AND 31 AND month IS NOT NULL
)
UPDATE matches m
SET match_date = CASE
                   WHEN g.d0 < (current_date - interval '2 months') THEN (g.d0 + interval '1 year')::date
                   ELSE g.d0
                 END
FROM guessed g
WHERE m.id = g.id;
