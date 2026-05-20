# Railway Incident Runbook

Updated: 2026-05-20

This document describes the Railway/Postgres incident observed on 2026-05-20 and the operational procedure for similar cases.

## 1. Incident Summary

Several Railway services in the same workspace/project showed crash or stuck-deployment states at roughly the same time.

Observed symptoms:

- Postgres services displayed `Deployment crashed`.
- Some Postgres logs showed `catatonit: failed to exec pid1: No such file or directory`.
- Some backend services returned `Application failed to respond` / `502`.
- Some deployments stayed in `Deployment restarted` for a long time.
- After redeploy, Postgres logs showed normal crash recovery:
  - `database system was not properly shut down; automatic recovery in progress`
  - `redo done`
  - `checkpoint complete`
  - `database system is ready to accept connections`

Important conclusion:

- The working fix was a full Railway `Redeploy`.
- No SQL data repair was needed.
- No code changes were needed.
- No Postgres image downgrade was needed.
- The database volume was not wiped; data reappeared after the service came back.

The most likely class of issue was Railway runtime/deployment orchestration getting into a bad or stale state, not application-level data corruption.

## 2. What Fixed It

Use `Redeploy`, not only `Restart`, when a service is stuck or returns `502` while logs are old or inconsistent.

Working recovery path:

1. Redeploy the affected Postgres service.
2. Wait for `database system is ready to accept connections`.
3. Redeploy the affected backend service if public HTTP routes still return `502`.
4. Check `/health` and an admin access route.
5. Check the Mini App/admin panel from Telegram.

Do not assume data loss when Railway UI shows a crash. First wait for Postgres crash recovery and verify actual tables.

## 3. What Not To Do

Do not do these during this class of incident:

- Do not delete the Postgres service.
- Do not delete or detach the volume.
- Do not truncate tables.
- Do not restore from backup before confirming the current volume is unusable.
- Do not change database schema as a recovery attempt.
- Do not downgrade Postgres only because a crash happened, if the same image starts successfully after redeploy.
- Do not keep pressing `Restart` if the deployment is stuck; use `Redeploy`.

## 4. Fast Triage

### Backend

Check whether the backend is responding:

```bash
curl -sS -m 10 -w '\nHTTP %{http_code} time %{time_total}\n' https://<backend-domain>/health
```

Check admin access:

```bash
curl -sS -m 10 -w '\nHTTP %{http_code} time %{time_total}\n' 'https://<backend-domain>/api/audio/access?tgUserId=<admin_tg_id>'
```

Interpretation:

- `200`: backend route is alive; investigate auth/data if the UI still blocks access.
- `502` / timeout: backend service or Railway routing is not serving. Redeploy backend.
- Old logs only: likely Railway deployment/log state is stale. Redeploy backend.

### Postgres

Check DB connectivity from local machine:

```bash
psql '<PUBLIC_DATABASE_URL>' -c 'select now();'
```

Interpretation:

- If `select now()` works, the DB is up.
- If Railway logs say `database system is ready to accept connections`, Postgres has recovered.
- If backend still fails after this, focus on backend deploy/routing/env, not DB recovery.

## 5. Backend vs Postgres Decision Rule

If Postgres says ready but backend URL gives `Application failed to respond`, the active problem is backend/runtime/routing.

If backend logs show:

- `Voice Widget Backend запущен`
- `Connected to Postgres`
- webhook started

but the public URL still returns `502`, prefer backend redeploy. If redeploy does not help, regenerate/check public networking domain.

## 6. Backups

The workspace was upgraded to Railway Pro after the incident.

Current accepted baseline:

- Enable Railway Daily backups for production/client databases that matter commercially.
- Daily Railway backup means rolling daily volume backups kept for 6 days.
- For non-paying/test clients, backups may be disabled by business decision.

Important limitation:

- Railway volume backups protect against recent platform/runtime/volume issues.
- They are not a complete long-term backup strategy.

Required future hardening:

1. Add scheduled external `pg_dump` for production/client DBs.
2. Store dumps outside Railway, ideally Cloudflare R2.
3. Keep at least 14-30 days of external dumps for paying clients.
4. Run a restore drill periodically on a temporary DB.

Manual dump command template:

```bash
pg_dump --no-owner --no-privileges '<PUBLIC_DATABASE_URL>' > '<client>_backup_YYYY-MM-DD_HHMM.sql'
```

## 7. Minimum Protection Plan

For each production client:

- Railway Daily backups enabled.
- Public backend `/health` monitored.
- Public admin access route monitored with an owner/super-admin Telegram id.
- Postgres `select now()` smoke available from local/operator machine.
- Manual `pg_dump` after large imports, seed injections, migrations, or client onboarding.
- Incident response uses this runbook before destructive actions.

## 8. Monitoring To Add

Add a small external monitor that checks every 1-5 minutes:

- `GET /health`
- `GET /api/cards/search?operation=sale&type=apartment&limit=1`
- `GET /api/audio/access?tgUserId=<known_admin_id>`

On failure:

- Send Telegram alert to operator/admin chat.
- Include service/client id, URL, HTTP status, and timestamp.

This would have made the 2026-05-20 failure visible before manual discovery.

## 9. Operational Notes

One branch can deploy to many Railway services, but each service has its own env, public domain, backend deployment, and Postgres service.

Therefore:

- A code push affects all services that auto-deploy from the branch.
- A manual redeploy inside one Railway service affects only that service.
- One client backend can fail while another client backend remains healthy.
- One Postgres service can be recovering while other Postgres services are already healthy.

This is expected for the current multi-service Railway setup.

