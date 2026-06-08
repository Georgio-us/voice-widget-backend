# XML Feed Cron Runbook

Purpose: keep Estyle active inventory synchronized with the XML feed without manual Railway console runs.

## Recommended Setup

Use a separate Railway cron service, not an in-process scheduler inside the API service.

Reason:
- the API process stays focused on serving users;
- the sync job starts only on schedule and exits after completion;
- if a run is still active, Railway skips the next run instead of overlapping writes.

## Railway Service

Create a separate service from the same backend repository and branch.

Suggested name:

```text
voice-widget-backend-xml-sync
```

Start command:

```bash
npm run xml:sync
```

Cron schedule:

```text
0 1 * * *
```

Railway cron schedules are UTC. `0 1 * * *` means 01:00 UTC, which is 03:00 in Madrid during summer time. In winter Madrid is UTC+1, so the same schedule runs at 02:00 Madrid time. If exact 03:00 Madrid winter time is required, change the schedule seasonally to `0 2 * * *`.

## Required Variables

Copy the same database/feed variables used by the backend service.

Required:

```text
DATABASE_URL=<same Postgres connection string>
IMPORT_CLIENT_ID=estyle
XML_SYNC_MIN_COUNT=500
```

Optional:

```text
XML_FEED_URL=https://estylespain.com/xml/xml-mediaelx.php?f=69e7b52b6c411
```

The npm command already sets:

```text
XML_SYNC_DEACTIVATE=1
```

## Safety Contract

The import script already has these guards:

- parses the full feed before writing;
- refuses duplicate `external_id` values;
- refuses sync if parsed count is below `XML_SYNC_MIN_COUNT`;
- refuses deactivation when `XML_IMPORT_LIMIT` is set;
- writes inside a database transaction;
- soft-deactivates missing feed objects with `is_active=false`, not delete;
- closes the database pool so the cron process can exit.

## Manual Dry Run

Before enabling or after changing feed settings, run:

```bash
npm run xml:sync:dry-run
```

Expected checks:

- `found` / `parsed` is close to current feed size;
- `skipped = 0`;
- `operationStats` looks reasonable;
- `newInFeedCount` and `wouldDeactivateCount` are plausible.

## Manual Production Run

To run the same command the cron service will run:

```bash
npm run xml:sync
```

Expected result:

- process exits successfully;
- Railway logs show `✅ XML import completed`;
- response JSON includes `processed`, `deactivated`, and `preview`.

## Notes

Do not add `node-cron` to the API service for this job. Railway cron is the better fit because this is a short-lived scheduled task, not a long-running worker.
