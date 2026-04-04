BEGIN;

ALTER TABLE properties
  ALTER COLUMN specs_area_m2 TYPE NUMERIC(10,2)
  USING (
    CASE
      WHEN specs_area_m2 IS NULL THEN NULL
      ELSE specs_area_m2::numeric(10,2)
    END
  );

COMMIT;
