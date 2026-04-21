# SQL Runbook (Client DB Isolation + Feed Validation)

Last updated: 2026-04-21
Branch: `Split`
Database: PostgreSQL (Railway)

## Purpose

Operational SQL checklist to:
- verify correct client DB context
- remove/demo-contain wrong seed data
- enforce listing uniqueness
- validate feed import quality
- support safe ongoing updates

## Safety Rules

1. Always run in the client environment DB connection.
2. Before `DELETE/UPDATE`, run corresponding `SELECT` preview.
3. Prefer transactions for destructive operations.
4. Keep an export/snapshot before cleanup operations.

## 0) Quick Context Check

```sql
-- current DB and schema context
SELECT current_database() AS db, current_schema() AS schema;

-- server time (helps verify you are in expected environment)
SELECT NOW() AS server_time;
```

## 1) Inventory by Client

```sql
-- listings volume by client
SELECT client_id, COUNT(*) AS listings
FROM properties
GROUP BY client_id
ORDER BY listings DESC, client_id;

-- leads by client
SELECT client_id, COUNT(*) AS leads
FROM lead_requests
GROUP BY client_id
ORDER BY leads DESC, client_id;

-- support tickets by client
SELECT client_id, COUNT(*) AS support_tickets
FROM support_requests
GROUP BY client_id
ORDER BY support_tickets DESC, client_id;
```

## 2) Detect Demo Leakage

```sql
-- check if demo data exists in client environment
SELECT COUNT(*) AS demo_listings
FROM properties
WHERE client_id = 'demo';

SELECT COUNT(*) AS demo_leads
FROM lead_requests
WHERE client_id = 'demo';

SELECT COUNT(*) AS demo_support
FROM support_requests
WHERE client_id = 'demo';
```

## 3) Optional Cleanup (Demo Rows)

Run only if demo rows should not exist in client environment.

```sql
BEGIN;

-- preview
SELECT COUNT(*) AS will_delete FROM properties WHERE client_id = 'demo';

-- delete listings for demo client in this environment
DELETE FROM properties
WHERE client_id = 'demo';

COMMIT;
```

For leads/support if required:

```sql
BEGIN;
DELETE FROM lead_requests WHERE client_id = 'demo';
DELETE FROM support_requests WHERE client_id = 'demo';
COMMIT;
```

## 4) Enforce Listing Identity

```sql
-- uniqueness guard for upsert imports
CREATE UNIQUE INDEX IF NOT EXISTS properties_client_external_uidx
ON properties (client_id, external_id);
```

## 5) Pre-Import Quality Checks

Target variable:
- `:client_id` (replace manually, e.g. `client_estyle`)

```sql
-- null/empty external_id (must be zero before/after import policy)
SELECT COUNT(*) AS bad_external_id
FROM properties
WHERE client_id = ':client_id'
  AND (external_id IS NULL OR BTRIM(external_id) = '');

-- duplicate external_id within client scope
SELECT BTRIM(external_id) AS ext_id, COUNT(*) AS cnt
FROM properties
WHERE client_id = ':client_id'
GROUP BY BTRIM(external_id)
HAVING COUNT(*) > 1
ORDER BY cnt DESC, ext_id;
```

## 6) Post-Import Acceptance Checks

```sql
-- total count for client after import
SELECT COUNT(*) AS total_after_import
FROM properties
WHERE client_id = ':client_id';

-- active vs inactive breakdown
SELECT is_active, COUNT(*) AS cnt
FROM properties
WHERE client_id = ':client_id'
GROUP BY is_active
ORDER BY is_active DESC;

-- basic null diagnostics in key card fields
SELECT
  SUM(CASE WHEN location_city IS NULL OR BTRIM(location_city) = '' THEN 1 ELSE 0 END) AS missing_city,
  SUM(CASE WHEN location_district IS NULL OR BTRIM(location_district) = '' THEN 1 ELSE 0 END) AS missing_district,
  SUM(CASE WHEN price_amount IS NULL THEN 1 ELSE 0 END) AS missing_price,
  SUM(CASE WHEN specs_rooms IS NULL THEN 1 ELSE 0 END) AS missing_rooms
FROM properties
WHERE client_id = ':client_id'
  AND is_active = true;
```

## 7) Spot Check Cards Payload Readiness

```sql
-- sample rows that should be renderable as cards
SELECT
  external_id,
  location_city,
  location_district,
  price_amount,
  specs_rooms,
  specs_floor,
  CASE
    WHEN images IS NULL THEN 'null'
    WHEN jsonb_typeof(images::jsonb) = 'array' THEN 'array'
    ELSE 'non_array'
  END AS images_shape
FROM properties
WHERE client_id = ':client_id'
  AND is_active = true
ORDER BY updated_at DESC NULLS LAST
LIMIT 20;
```

## 8) Soft Deactivation Pattern (Missing from New Feed)

Use only after staging import IDs into temp table `tmp_feed_external_ids(external_id text)`.

```sql
BEGIN;

UPDATE properties p
SET is_active = false,
    updated_at = NOW()
WHERE p.client_id = ':client_id'
  AND NOT EXISTS (
    SELECT 1
    FROM tmp_feed_external_ids t
    WHERE BTRIM(t.external_id) = BTRIM(p.external_id)
  );

COMMIT;
```

## 9) Leads/Telemetry/Session Sanity

```sql
-- recent leads
SELECT id, client_id, session_id, source, created_at
FROM lead_requests
ORDER BY created_at DESC
LIMIT 20;

-- recent support tickets
SELECT id, client_id, session_id, problem_type, created_at
FROM support_requests
ORDER BY created_at DESC
LIMIT 20;

-- telemetry tail
SELECT id, session_id, event_type, created_at
FROM event_logs
ORDER BY id DESC
LIMIT 50;

-- session logs tail
SELECT session_id, created_at
FROM session_logs
ORDER BY created_at DESC
LIMIT 20;
```

## 10) Useful One-Line Smoke SQL

```sql
-- expected listing count check for client
SELECT COUNT(*) AS cnt
FROM properties
WHERE client_id = ':client_id' AND is_active = true;
```

If this returns unexpected value (e.g., 0 after import), stop and verify:
1. `DATABASE_URL` target
2. `IMPORT_CLIENT_ID`
3. importer run logs and rejected rows
