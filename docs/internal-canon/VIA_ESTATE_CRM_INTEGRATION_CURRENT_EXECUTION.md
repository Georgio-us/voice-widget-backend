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

- VIA → CRM event delivery: `telegram.identity_seen`, `selection.opened`, `property.viewed`, `mini_app_lead.created`, `session.completed_summary`;
- mapping any event to CRM contacts, deals, threads, or related contacts;
- a visual settings screen in the VIA admin panel (backend admin endpoints exist, UI is not made);
- explicit “Publish CRM object to VIA” flow;
- applying the migration, adding variables, or turning the feature on for Delmar.

The SQL includes an outbox table reserved for reliable VIA → CRM delivery, but no dispatcher/event hooks have been enabled. This is intentional: do not send partial or duplicate customer activity before the CRM side finishes its event receiver and final object/contact policy.

## 6. Safe Resume Order

1. Confirm Estate CRM’s final pairing endpoint, response (`connectionId`, `sharedCredential`), property contract, and event receiver.
2. Apply `sql/008_estate_crm_integration.sql` only to the target VIA tenant database.
3. Add the three deployment-level variables below, keeping the feature flag `false` initially.
4. Test pairing in a non-production/test tenant with an administrator on both sides.
5. Test catalog export → create selection → open link → revoke link.
6. Only then implement and test the outbound event outbox, starting with Mini App lead creation. Do not route historical Meta Google Sheets leads into this connector.
7. Add the small VIA admin settings UI and enable Delmar only after the end-to-end test is accepted.

## 7. Required VIA Deployment Variables (Names Only)

- `ESTATE_CRM_INTEGRATION_ENABLED=false` initially; change to `true` only after migration and a successful pairing test.
- `ESTATE_CRM_API_BASE_URL` — the fixed Estate CRM server origin (no trailing `/api`).
- `ESTATE_CRM_INTEGRATION_ENCRYPTION_KEY` — a strong deployment-held secret used only to encrypt the stored pairing credential.

`CLIENT_ID=delmar` remains the tenant selector for Delmar. No customer-specific CRM credential belongs in Railway Variables.

## 8. Files That Form the VIA Connector

- `sql/008_estate_crm_integration.sql`
- `services/estateCrmIntegrationService.js`
- `routes/estateCrmIntegrationRoute.js`
- `routes/adminPropertiesRoute.js`
- `index.js`
- Frontend: `Voice-Widget-Frontend/voice-widget-v1.js`

When resuming, first read this document, then inspect the two listed commits and ask the CRM task whether its final contract changed. Do not enable the feature merely because the code is deployed.
