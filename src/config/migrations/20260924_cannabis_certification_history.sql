-- Certification history: cannabis_certifications gains first/last-seen
-- tracking so the platform can show when a physician was first listed and
-- whether they still appear on the current registry edition. Re-ingests
-- UPDATE survivors (last_confirmed_at, currently_listed) instead of
-- replacing rows, so matched NPIs and their provenance survive.
ALTER TABLE cannabis_certifications ADD COLUMN IF NOT EXISTS first_listed_at date;
ALTER TABLE cannabis_certifications ADD COLUMN IF NOT EXISTS last_confirmed_at date;
ALTER TABLE cannabis_certifications ADD COLUMN IF NOT EXISTS currently_listed boolean NOT NULL DEFAULT true;

-- Seed existing rows from their as_of date.
UPDATE cannabis_certifications SET first_listed_at = as_of::date WHERE first_listed_at IS NULL;
UPDATE cannabis_certifications SET last_confirmed_at = as_of::date WHERE last_confirmed_at IS NULL;
