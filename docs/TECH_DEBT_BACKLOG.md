# Tech Debt Backlog (Estyle)

Last updated: 2026-04-30
Branch: `Split`
Purpose: deferred tasks that are important but intentionally postponed.

## Scope Note (2026-04-28)

Active work is now extraction/canonical quality for live XML search.
Items not related to this track (including CRM outbound integration details) stay deferred until search stability is accepted.

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

## P1 — Selection Runtime Stability Flags (active)

1. Room extraction ambiguity in single-pass utterances:
- some phrasings still collapse multi-room intent into scalar despite array support in canonical.

2. Location recognition robustness for noisy ASR:
- unknown tokens are now dropped safely, but false negatives can reduce recall until user уточняет город.

3. Prompt/legacy residue in monolithic controller:
- runtime path is locked, but `stage/role/meta` code still exists in controller and logs, increasing maintenance risk.

4. Query trace consistency for mixed request types:
- `interaction_show/next` can reflect previously built candidate pools; when debugging, always compare with latest `/upload` turn trace.
