# VIA ↔ Estate CRM: Current Execution

Status: implementation paused safely; foundation is committed, pushed, and **not enabled in production**.

Updated: 2026-09-15

Scope: optional integration between one VIA tenant (for example, Delmar) and Estate CRM. This document is the restart point after a pause.

## 1. What We Are Building, in Plain Language

VIA and Estate CRM remain two independent products with independent databases.

The optional connector lets an Estate CRM manager:

1. See the active VIA objects inside CRM.
2. Choose VIA objects for a CRM contact/deal.
3. Press “send through VIA”.
4. Receive a protected VIA selection link and send it to the client through the client’s Telegram bot.

The client opens the link and sees the usual VIA Mini App selection. No CRM deal ID, contact ID, or CRM data is put into the customer-facing link.

The inverse direction will later let VIA report selected customer events to CRM. CRM alone decides whether an event becomes a contact update, deal event, activity in a thread, or a related contact.

## 2. Product Rules Already Agreed

- Estate CRM is the primary management product. VIA adapts to it; CRM core architecture must not be changed for VIA.
- The connector is optional and off by default. A VIA client without CRM must behave exactly as today.
- Only a CRM administrator can initiate a connection. VIA also requires its own admin confirmation.
- There are no per-client API keys to copy manually into Railway. Pairing uses a short-lived, one-time code; the shared credential is created/stored server-to-server and never shown in a browser.
- VIA objects stay in VIA. CRM does not import/copy them merely to make a selection.
- Future CRM-only objects may be published to VIA explicitly. There is no automatic object synchronization or automatic deletion in v1.
- A selection does not expire by time in v1. It stays available until an administrator/CRM revokes it. If a VIA object later becomes inactive, it is simply omitted from the opened selection.
- Raw customer transcripts are not sent to CRM in v1.

## 3. What Is Already Implemented and Pushed

Backend repository: `Voice-Widget-Backend`, branch `Tgdubai-split`, commit `69d2fcd`.

Frontend repository: `Voice-Widget-Frontend`, branch `Tgdubai-split`, commit `4af4e8a`.

Implemented on VIA:

- optional integration tables in `sql/008_estate_crm_integration.sql`;
- encrypted storage of the server-to-server credential (AES-256-GCM);
- signed CRM-to-VIA requests (HMAC-SHA256);
- CRM catalog export of active VIA properties;
- creation of an opaque VIA selection token from a list of VIA external IDs;
- atomic failure when requested objects are unavailable, unless CRM explicitly requests `allowPartial=true`;
- manual revocation of a selection;
- public resolver for an opaque selection token, returning only still-active VIA object IDs;
- frontend support for opening that opaque selection link in the ordinary VIA Mini App;
- VIA admin-only endpoints for status, pairing confirmation and disconnect.
- reliable VIA → CRM event outbox with signed retry delivery;
- active event hooks: opening a CRM-created selection, viewing its first object, and creating a new Mini App lead (including linked CRM selection context).

The database migration has been committed but **has not been applied to Delmar/Postgres yet**. The integration flag is not enabled.

## 4. Current Exact Connector Contract

### CRM calls VIA

All requests below are signed with the shared credential.

- `GET /api/integrations/estate/v1/properties?cursor=&updatedSince=`
- `POST /api/integrations/estate/v1/selections`
- `POST /api/integrations/estate/v1/selections/:selectionId/revoke`

The selection request carries:

```json
{
  "externalSelectionId": "CRM UUID",
  "crmContextId": "opaque CRM UUID",
  "propertyExternalIds": ["A001", "A025"],
  "allowPartial": false
}
```

It also requires an `Idempotency-Key` header. The maximum selection size is 10 objects.

VIA returns an opaque token and `shareUrl`, plus accepted/unavailable object IDs. Without `allowPartial=true`, any unavailable object causes `409` and no selection is created.

### Browser calls VIA

- `GET /api/integrations/estate/v1/public/selections/:token`

This is intentionally public because the random token is the client-facing capability. It returns no CRM data, only active VIA object IDs.

### VIA pairing call to CRM

- `POST ${ESTATE_CRM_API_BASE_URL}/integrations/via/pairing/claim`

Request:

```json
{ "pairingCode": "one-time code", "viaTenant": "CLIENT_ID" }
```

Expected CRM response contains `connectionId` and `sharedCredential`.

### Signature format

The exact string signed by HMAC-SHA256 is:

```text
${timestamp}\n${connectionId}\n${METHOD}\n${pathname}${search}\n${sha256(rawBody)}
```

Signature encoding: base64url. Headers: `X-Integration-Connection`, `X-Integration-Timestamp`, `X-Integration-Signature`. Timestamp tolerance is ±5 minutes. For `GET`, the raw body is empty.

## 5. What Is Deliberately Not Done Yet

Do not describe the following as live functionality yet:

- remaining VIA → CRM event hook: `session.completed_summary` (must be built from a trusted server-side session summary, not browser input);
- mapping session summaries to CRM contacts, deals, threads, or related contacts;
- explicit “Publish CRM object to VIA” flow;
- applying the migration, adding variables, or turning the feature on for Delmar.

The event outbox now delivers selection open, first property view, `telegram.identity_seen`, and `mini_app_lead.created`. Browser-originated events require verified Telegram WebApp init data and are converted to server-owned signed envelopes; browser input can never provide a session summary. It uses the agreed HMAC signature and retries failed delivery up to ten times. Meta Google Sheets leads are explicitly excluded. Session summary remains off until a trusted server-side source is wired and tested with CRM.

## 6. Safe Resume Order

1. Confirm Estate CRM’s final pairing endpoint, response (`connectionId`, `sharedCredential`), property contract, and event receiver.
2. Apply `sql/008_estate_crm_integration.sql` only to the target VIA tenant database.
3. Add the deployment-level variables below, keeping the feature flag `false` initially.
4. Test pairing in a non-production/test tenant with an administrator on both sides.
5. Test catalog export → create selection → open link → revoke link.
6. Test delivery and retry of a Mini App lead event. Do not route historical Meta Google Sheets leads into this connector.
7. Test the remaining trusted server-side session-summary hook when its source is wired.
8. Enable Delmar only after the end-to-end test is accepted.

## 7. Required VIA Deployment Variables (Names Only)

- `ESTATE_CRM_INTEGRATION_ENABLED=false` initially; change to `true` only after migration and a successful pairing test.
- `ESTATE_CRM_API_BASE_URL` — the fixed Estate CRM server origin (no trailing `/api`).
- `ESTATE_CRM_INTEGRATION_ENCRYPTION_KEY` — a strong deployment-held secret used only to encrypt the stored pairing credential.
- `FRONTEND_URL` — the public VIA Mini App origin. It is already a standard VIA variable and must be set: CRM selection creation returns `503` rather than creating a broken selection if it is absent.

`CLIENT_ID=delmar` remains the tenant selector for Delmar. No customer-specific CRM credential belongs in Railway Variables.

## 8. Joint QA Checklist

Run this in a test tenant first, with the feature flag still off until the first checks are complete:

1. In CRM, an `ADMIN` creates a pairing code; in the VIA admin panel, press “Estate CRM: подключить” and enter that one-time code. Confirm that the browser never receives the shared credential.
2. Confirm CRM catalog export returns active VIA objects with their exact IDs, including a mixed-case ID fixture.
3. From a CRM deal, select one or more VIA IDs. Confirm the same `shareUrl` is returned on a retry with the same `Idempotency-Key`.
4. Open the link in the Delmar Telegram Mini App. Confirm `selection.opened`, `telegram.identity_seen`, and the first `property.viewed` arrive in CRM once the outbox worker runs.
5. Submit a Mini App lead from that selection. Confirm `mini_app_lead.created` contains the VIA lead ID and the CRM selection context and is attached to the expected deal/contact.
6. Temporarily make CRM unavailable. Confirm the VIA lead still succeeds and the event remains pending/failed for retry; restore CRM and confirm delivery.
7. Revoke the selection in CRM. Confirm the old link returns `SELECTION_NOT_FOUND_OR_REVOKED` and no new selection events are accepted.
8. Disconnect/disable the integration. Confirm ordinary VIA catalog, leads, Telegram notifications, and Meta Sheets flow remain unchanged.

Do not mark the pilot complete until all eight checks pass and the migration has been applied only to the intended Delmar database.

## 9. Files That Form the VIA Connector

- `sql/008_estate_crm_integration.sql`
- `services/estateCrmIntegrationService.js`
- `routes/estateCrmIntegrationRoute.js`
- `routes/adminPropertiesRoute.js`
- `index.js`
- Frontend: `Voice-Widget-Frontend/voice-widget-v1.js`

When resuming, first read this document, then inspect the two listed commits and ask the CRM task whether its final contract changed. Do not enable the feature merely because the code is deployed.
