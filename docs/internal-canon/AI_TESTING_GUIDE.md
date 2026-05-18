# AI Testing Guide

Status: current live/backend testing guide
Updated: 2026-05-18

## 1. Purpose

Use this guide to test AI extraction, catalog context, residential-complex matching and search behavior directly against a backend endpoint.

This isolates whether a problem is caused by:

- transcription/model extraction,
- backend normalization,
- catalog context,
- frontend/manual filter merge,
- card search.

## 2. Main Endpoint

Primary endpoint:

```text
POST /api/audio/upload
```

Despite the name, the endpoint can accept plain text for testing.

Requirements:

- request type: `multipart/form-data`,
- `sessionId` format: `user_<digits>_<lowercase-or-digits>`,
- text field: `text=<message>`.

Example:

```bash
curl -sS -X POST https://voice-widget-backend-tgdubai-split.up.railway.app/api/audio/upload \
  -F 'sessionId=user_1779000000000_ai01' \
  -F 'text=Покажи ЖК Омега или Альтаир, 1-2 комнаты' | jq .
```

## 3. What To Inspect

In the response, inspect:

- `payload.insights` or top-level `insights` depending on endpoint shape,
- `queryTraceV1.sourceInsights`,
- `queryTraceV1.canonicalPatch`,
- `queryTraceV1.preValidationQuery`,
- `queryTraceV1.postValidationQuery`,
- `queryTraceV1.droppedFields`,
- `totalMatches`, `strictMatches`, `relaxedMatches`,
- returned cards/counts if present.

Expected principle:

- model text can be imperfect,
- canonical patch must be sane,
- final card search must match canonical/effective query.

## 4. Current Critical Smoke Cases

Run these when changing prompt/catalog/search logic.

### Residential complex group

Message:

```text
Привет, что есть в Альтаире?
```

Expected:

- `residentialComplex` resolves to Альтаир group (`ЖК Альтаир 1/2/3`) or equivalent group query,
- no broad `rcOnly`-only fallback if exact group is available.

### Multi-RC

Message:

```text
Покажи ЖК Омега или Альтаир, 1-2 комнаты
```

Expected:

- multiple residential complexes are preserved,
- rooms include 1 and 2,
- returned candidates are limited to these complexes where possible.

### Unknown RC

Message:

```text
Есть что-то в ЖК Хогвартс?
```

Expected:

- no fabricated `residentialComplex=Хогвартс`,
- optional `rcOnly=true`,
- assistant should not claim exact availability.

### District / microdistrict

Messages:

```text
Что есть на Таирова до 100 тысяч?
Покажи новостройки на поселке Котовского
Хочу квартиру в центре
```

Expected:

- `Таирова` maps to Киевский direction,
- `поселок Котовского` maps to Суворовский direction,
- `центр` maps to supported center logic,
- streets must not become unsupported primary filters.

### Refinement

Sequence with same `sessionId`:

```text
Ищу 1к квартиру на Таирова
до 80 тысяч
только ЖК
```

Expected:

- later messages enrich/update the current search,
- previous core intent is not randomly lost,
- final query includes location, budget and `rcOnly`.

## 5. Catalog Context Env For Tests

When testing active catalog context:

```text
AI_CATALOG_CONTEXT_ENABLED=1
AI_CATALOG_CONTEXT_CLIENT_ID=<client_id>
AI_CATALOG_CONTEXT_MAX_ITEMS=200
AI_CATALOG_CONTEXT_DEBUG=0
AI_ASSISTANT_FLAVOR=showroom
```

Do not rely on old `DEMO_*` env for new tests. It exists only as compatibility fallback.

## 6. Testing Script

For multi-step memory/refinement tests, use or adapt:

```bash
node scripts/live_test.js
```

The script should generate a valid `sessionId`, send messages sequentially and print insights/query trace.

## 7. Failure Interpretation

Common failure types:

- AI names the right thing in natural language but canonical patch misses it: prompt/schema extraction issue.
- Canonical patch is right but cards are wrong: search/effective query issue.
- Manual filters show different values than AI patch: frontend merge/manual override issue.
- Unknown ЖК becomes exact `residentialComplex`: strict catalog intent regression.
- Known ЖК becomes only `rcOnly=true`: catalog matcher/context regression.
