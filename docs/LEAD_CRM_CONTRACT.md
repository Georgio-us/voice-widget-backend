# Lead CRM Contract (Mediaelx)

Last updated: 2026-04-23
Branch: `Split`
Status: target contract approved for implementation (outbound call not enabled yet).

## Goal

Prepare one stable, extended lead JSON contract for external CRM (Mediaelx), including:
1. contact fields
2. property context
3. AI-derived request summary (`ai_notes` / `summary`)
4. structured insights for machine-side filtering/routing

## Current State (as-is)

Current endpoint:
- `POST /api/leads`

Current payload sent by frontend forms:
- `sessionId`
- `source` (`widget_full_form` | `widget_short_form` | `widget_in_dialog`)
- `name`
- `phoneCountryCode`
- `phoneNumber`
- `email`
- `preferredContactMethod`
- `comment`
- `language`
- `propertyId` (currently sent as `null` in all three forms)
- `consent`

Current backend behavior:
1. validates and stores base lead fields in `lead_requests`.
2. enriches Telegram message with best-effort `insights` from `session_logs`.
3. does not currently persist/send CRM-ready `summary`/`ai_notes`.

## Target Contract (to external CRM)

Single normalized envelope:

```json
{
  "schemaVersion": "lead.v1",
  "clientId": "estyle",
  "source": "widget_in_dialog",
  "createdAt": "2026-04-23T09:42:11.000Z",
  "session": {
    "sessionId": "user_abc123",
    "language": "ru"
  },
  "contact": {
    "name": "Ivan Petrov",
    "phoneCountryCode": "+34",
    "phoneNumber": "612345678",
    "email": "ivan@example.com",
    "preferredContactMethod": "whatsapp",
    "consent": true
  },
  "propertyContext": {
    "propertyId": "DD2959",
    "lastShownCardId": "DD2959"
  },
  "request": {
    "comment": "Looking for a property near the sea.",
    "operation": "sale",
    "propertyType": "apartment",
    "location": {
      "city": "Torrevieja",
      "province": "Alicante",
      "district": "Mar Azul",
      "country": "Spain"
    },
    "budget": {
      "currency": "EUR",
      "min": 120000,
      "max": 180000
    },
    "rooms": {
      "bedroomsMin": 2,
      "bathroomsMin": 1
    },
    "area": {
      "m2Min": 60
    },
    "mustHave": {
      "pool": true,
      "parking": false
    },
    "urgency": "high",
    "timeline": "within_1_month"
  },
  "ai_notes": "Client is searching for an apartment in Torrevieja (Alicante), budget 120-180k EUR, min 2 bedrooms, pool preferred, decision timeline within 1 month.",
  "rawInsights": {
    "operation": "sale",
    "type": "apartment",
    "location": "Torrevieja, Alicante",
    "budget": "120000-180000 EUR",
    "rooms": "2+",
    "area": "60+ m2",
    "preferences": "pool",
    "details": "near sea"
  }
}
```

## Field Mapping Plan

### 1) Source and session

- `source` <- frontend source marker (`widget_full_form`, `widget_short_form`, `widget_in_dialog`)
- `session.sessionId` <- lead payload `sessionId`
- `session.language` <- lead payload `language`

### 2) Contact

- `contact.name` <- `name`
- `contact.phoneCountryCode` <- `phoneCountryCode`
- `contact.phoneNumber` <- `phoneNumber`
- `contact.email` <- `email`
- `contact.preferredContactMethod` <- `preferredContactMethod`
- `contact.consent` <- `consent`

### 3) Property context

- `propertyContext.propertyId` <- explicit property id from selected/current card context
- `propertyContext.lastShownCardId` <- fallback from `session_logs` card history

Rule:
1. if frontend passed `propertyId`, use it.
2. else if session has last shown card id, use it as fallback.
3. else keep `null`.

### 4) AI insights and summary

Inputs:
1. explicit payload fields (`comment`, optional `insights` in future)
2. latest `meta.insights` from `session_logs`
3. selected card context (if available)

Derived:
- `rawInsights`: normalized machine object
- `ai_notes`: human-readable summary string for CRM manager

## Implementation Checklist (next coding slice)

1. Extend `POST /api/leads` accepted payload with optional:
   - `summary`
   - `aiNotes`
   - `insights` (object)
   - `propertyId` from UI context (non-null when available)
2. Build server-side `ai_notes` fallback when frontend did not send one.
3. Persist enriched object into `lead_requests.extra` for traceability.
4. Add pure mapper for external CRM payload (`lead -> crmLeadPayload`).
5. Keep outbound transport disabled in this slice; only contract and logging.
6. After approval, enable outbound webhook sender and retries.

## Open Decisions

1. Canonical field name: `ai_notes` only, or dual support (`summary` + `ai_notes`).
2. Language of `ai_notes`: source dialog language vs forced CRM language.
3. Minimal required keys for CRM acceptance (`propertyId` optional vs required).
4. Retry/queue strategy for outbound webhook (later slice).

