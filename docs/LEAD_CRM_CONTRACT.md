# Lead CRM Contract (Mediaelx)

Last updated: 2026-05-12
Branch: `Split`
Status: outbound mirror to MediaElx MySQL enabled in best-effort mode (non-blocking for widget UX).

## MediaElx Runtime Notes (current)

- Target table: `properties_enquiries`
- Insert mode: direct MySQL insert from backend lead route (`POST /api/leads`)
- Availability mode: best-effort
  - if MySQL is up -> insert
  - if MySQL is temporarily unavailable -> append record to local queue file (`jsonl`) for manual replay
- Dedupe rule:
  - same `email_cons` + same `inmueble_cons` within 5 minutes -> duplicate ignored
- `email_cons` fallback:
  - when frontend email is empty, backend uses placeholder email to satisfy CRM `NOT NULL`
- Property linking:
  - backend resolves incoming `propertyId` against `properties_properties` by
    `referencia_prop` / `ref_xml_prop` / `id_xml_prop`
  - writes resolved `id_prop` into `properties_enquiries.inmueble_cons`
  - if unresolved -> writes `0`

## Goal

Keep lead delivery deterministic for CRM:
1. contact fields are always valid for `properties_enquiries`
2. property lead is linked to CRM property PK (`id_prop`) via incoming ref/id
3. AI summary is readable for manager (no raw debug keys)
4. failures in MediaElx transport do not break widget UX

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
- `propertyId`
- `consent`

Current backend behavior:
1. validates and stores base lead fields in `lead_requests`.
2. enriches from `session_logs` (latest intent/insights/context).
3. builds readable localized summary (`ru`/`en`/`es`) for CRM text block.
4. mirrors to MediaElx (`properties_enquiries`) in best-effort mode with queue fallback.

Frontend status (important):
- `widget_in_dialog` now sends `propertyId` from a strict hidden field bound at form render.
- legacy heuristic extraction for this form submit was removed.

## Runtime Mirror Contract (implemented)

Inbound lead payload (widget -> backend):

```json
{
  "source": "widget_in_dialog",
  "sessionId": "user_abc123",
  "language": "ru",
  "name": "Ivan Petrov",
  "phoneCountryCode": "+34",
  "phoneNumber": "612345678",
  "email": "",
  "preferredContactMethod": "phone",
  "comment": null,
  "propertyId": "A069",
  "consent": true
}
```

MediaElx write mapping (backend -> `properties_enquiries`):
- `inmueble_cons` <- resolved `id_prop` by incoming `propertyId` ref/id
- `idioma_cons` <- normalized language (`ru`/`en`/`es`)
- `motivo_cons` <- `VIA AI Widget`
- `nombre_cons` <- lead name
- `telefono_cons` <- `phoneCountryCode + phoneNumber`
- `email_cons` <- lead email or `no_mail_received@mail.com`
- `comentario_consas` <- formatted report block with:
  - form type
  - contact method
  - incoming ref (`REF ОБЪЕКТА`)
  - readable AI summary from session context
  - user comment
- `read_cons` <- `0`

## Behavior Notes (current)

1. `widget_in_dialog` should be used only from object card flow (back/form side).
2. If `propertyId` is missing in incoming payload, CRM insert still succeeds but:
   - `inmueble_cons = 0`
   - UI property badge may be empty
   - report text shows `REF ОБЪЕКТА: -`
3. Dedupe applies on pair: `LOWER(email_cons)` + `inmueble_cons` in 5-minute window.
4. Queue fallback writes jsonl records to `MEDIAELX_QUEUE_PATH` when MySQL is unavailable.

## Open Decisions

1. Should backend reject `widget_in_dialog` submissions with empty `propertyId` (strict mode), or keep current permissive mode?
2. Should CRM report text show only normalized ref format (e.g., uppercase trimmed)?
3. Keep current queue replay manual, or add automated replay worker later.
