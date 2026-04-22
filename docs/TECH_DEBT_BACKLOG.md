# Tech Debt Backlog (Estyle)

Last updated: 2026-04-22
Branch: `Split`
Purpose: deferred tasks that are important but intentionally postponed.

## P1 — XML Sync Automation (deferred)

### Why

XML import is currently manual. This risks stale listings and inconsistent client data freshness.

### Target behavior

1. Import runs automatically on schedule (Railway cron/job).
2. Data in `properties` is synced to feed state, not only appended/updated.
3. Safety guard prevents mass deactivation on broken/empty feed responses.

### Required implementation

1. Scheduled execution:
- run `node scripts/importFromXml.js` on interval (recommended every 2-4 hours).

2. Soft-deactivate missing listings:
- after successful parse/import, mark rows `is_active=false` for current `client_id` where `external_id` is not present in latest feed snapshot.

3. Safety checks:
- do not run deactivation if feed parse result is below sanity threshold.
- example threshold: if imported count is unexpectedly small vs previous successful baseline, abort deactivation and log alert.

4. Operational observability:
- store import summary (count found/processed/skipped, sale/rent split, timestamp).
- log failures and last successful run timestamp.

### Acceptance criteria

1. Listings in DB match current feed within one schedule interval.
2. Removed feed listings are no longer shown (`is_active=false`).
3. No full accidental deactivation on temporary feed outage.
4. Operator can inspect last run status quickly.

## P2 — Import Monitoring (deferred)

1. Add heartbeat/notification on failed import runs.
2. Add dashboard-style SQL/metrics snippet for quick health checks.
