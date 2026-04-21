# ENV Audit TODO (Prioritized, Minimal-Change)

Last updated: 2026-04-21
Branch: `Split`
Goal: remove highest-risk hardcodes/fallbacks first, without large refactor.

## Priority Model

- `P0` Critical isolation/safety (client data mix risk)
- `P1` Production stability/observability
- `P2` Cleanup/consistency

## P0: Must Fix First

### 1) CORS currently effectively allows all origins

- File: `Voice-Widget-Backend/index.js`
- AS-IS:
  - has allowed origins list, but ends with `callback(null, true)`.
- Risk:
  - any origin can access API, weak client isolation and security posture.
- Minimal fix:
  1. keep localhost allow in non-production only;
  2. require `FRONTEND_URL` in production;
  3. reject unknown origins with explicit CORS error.

### 2) Implicit `demo` client defaults in runtime repositories

- Files:
  - `services/propertiesRepository.js`
  - `services/leadsRepository.js`
  - `services/supportRepository.js`
- AS-IS:
  - `DEFAULT_CLIENT_ID = 'demo'` used when client not passed.
- Risk:
  - accidental writes/reads under demo scope in client environment.
- Minimal fix:
  1. introduce `DEFAULT_CLIENT_ID` from env (e.g. `APP_CLIENT_ID`);
  2. fail fast in production if missing;
  3. keep `demo` only for local/dev fallback.

### 3) Frontend hardcoded backend split URL fallback

- File: `Voice-Widget-Frontend/voice-widget-v1.js`
- AS-IS:
  - default `api-url` points to split backend domain.
- Risk:
  - wrong backend routing if client embed misses config.
- Minimal fix:
  1. replace hardcoded URL with `window.__VW_API_URL__` required in prod embed;
  2. keep localhost fallback for local only;
  3. optionally keep explicit safe placeholder that throws/logs error in prod.

### 4) Demo HTML points to split backend

- File: `Voice-Widget-Frontend/index.html`
- AS-IS:
  - `api-url` hardcoded to split backend.
- Risk:
  - manual deploy/demo confusion and cross-env calls.
- Minimal fix:
  1. replace with neutral placeholder URL;
  2. add comment that production injects client backend URL.

## P1: Next Wave (High Value, Low-Medium Effort)

### 5) Import scripts rely on `IMPORT_CLIENT_ID || demo`

- Files:
  - `scripts/importFromCsv.js`
  - `scripts/importFromXlsx.js`
  - `scripts/importFromJs.js` (hardcoded `demo`)
- Risk:
  - accidental import into demo namespace.
- Minimal fix:
  1. require explicit `IMPORT_CLIENT_ID` for non-local environments;
  2. print target DB host + client id before import;
  3. add interactive confirmation flag (`--yes`) for destructive paths.

### 6) Startup guards for env consistency

- File: `index.js`
- Risk:
  - backend starts with miswired client env (wrong DB/front URL).
- Minimal fix:
  1. strict startup validation in production:
     - `OPENAI_API_KEY`, `DATABASE_URL`, `FRONTEND_URL`, client id var;
  2. structured startup logs showing active config fingerprint (no secrets).

### 7) Frontend runtime override chain can hide misconfig

- File: `voice-widget-v1.js`
- AS-IS:
  - query/global/localStorage/localhost/attr chain.
- Risk:
  - stale `localStorage` or query parameter routes traffic to wrong backend.
- Minimal fix:
  1. in production mode, disable or restrict query/localStorage override;
  2. allow override only when explicit debug flag is enabled.

## P2: Cleanup / Consistency

### 8) Hardcoded privacy policy URL

- File: `voice-widget-v1.js`
- Minimal fix:
  - move URL to configurable variable (frontend runtime config).

### 9) `console-demo.js` old hardcoded project URLs

- File: `console-demo.js`
- Minimal fix:
  - mark as dev-only and move URLs to top-level config constants with warnings.

### 10) Docs alignment

- Files:
  - `README.txt` (backend)
  - env docs created in this iteration
- Minimal fix:
  - keep one source of truth references to:
    - `ENV_AS_IS.md`
    - `ENV_TARGET_MATRIX.md`
    - `CLIENT_ONBOARDING.md`
    - `SQL_RUNBOOK.md`

## Suggested Execution Order (Incremental PR/Commits)

1. `P0.1` CORS hardening in `index.js`.
2. `P0.2` frontend backend URL hardcode removal (`voice-widget-v1.js`, `index.html`).
3. `P0.3` client id env defaulting in repositories.
4. `P1.5` importer safety gates.
5. `P1.6 + P1.7` startup guards and frontend override restrictions.
6. `P2` cleanup/docs.

## Acceptance Criteria for Audit Completion

1. No production hardcoded split/demo backend URLs in frontend runtime path.
2. No implicit `demo` client writes in production backend path.
3. CORS policy enforceable via explicit client frontend URL.
4. Import process cannot run against client env without explicit client id.
5. Onboarding docs map 1:1 to actual runtime behavior.
