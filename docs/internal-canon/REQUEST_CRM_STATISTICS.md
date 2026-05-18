# Request / Stats / Clients CRM

Status: current scope and roadmap
Updated: 2026-05-18

## 1. Purpose

This document describes the lightweight CRM/statistics layer inside the admin panel.

The goal is not to build a full CRM. The goal is to help the bot owner see:

- who entered the bot,
- who left a request,
- what the user searched for,
- whether the owner can contact the user through Telegram.

## 2. Current Data Sources

The current implementation uses existing tables and does not require a dedicated `clients` table yet.

Main sources:

- `users` - Telegram bot users and Mini App users when identity is available.
- `lead_requests` - contact/request actions.
- `session_logs` - last dialog/session context and extracted insights.
- `properties` - active catalog object counts and property references.

Important filtering:

- Legacy `widget_*` lead sources are excluded from the Telegram CRM/request slice.
- Empty or generated contact values should not be shown as real user-provided data.

## 3. Current Admin UI

Implemented direction:

- Summary cards for bot/users/requests/sessions/properties.
- `Последние заявки` accordion.
- `Последняя активность` accordion.
- Per-row `детали` button.
- Details are shown under the corresponding accordion section.
- Closing an accordion closes its details.
- Latest request/activity preview is compact: name, Telegram handle/id, details button.
- Long names are lower priority than Telegram handle and details button.
- Raw insight JSON is converted into readable labels where possible.

Unread indicators:

- Stats/request section can show an unread count in the admin panel.
- Crown/admin entry can show a green unread count for stats/activity attention.

## 4. Request Details

Current details can include:

- session id,
- request source,
- property id if the request came from a property card,
- message count,
- last user request,
- last assistant response,
- readable extracted search intent,
- whether the user left a request,
- number of objects shown when available.

Display rules:

- Do not render `null` as text.
- Do not show fake/generated email as a real contact.
- Show phone/email only if actually provided.
- Prefer Telegram username link when available.
- Fallback to Telegram user id when username is absent.

## 5. Client Concept

Planned `Клиенты` section:

- list unique Telegram users,
- show client card/details,
- show contact handles,
- show latest activity/request summary,
- later support targeted notifications/broadcasts.

Primary technical key for client contact is Telegram user id. A name without Telegram id/username is informational only and is not enough for outreach.

## 6. Notifications / Broadcasts Roadmap

Future broadcast mechanism should use the same Telegram bot that launches the Mini App.

Concept:

- admin selects audience or individual client(s),
- backend sends message through Telegram Bot API using stored Telegram user ids,
- send result is logged,
- users who blocked the bot or cannot be contacted are marked accordingly.

This is not part of the current stats implementation. Current priority is reliable user collection and readable admin visibility.

## 7. Future DB Hardening

Potential future migration candidates:

- explicit `telegram_username` on `lead_requests`,
- explicit `telegram_user_id` on `lead_requests`,
- `is_email_user_provided`,
- `is_phone_user_provided`,
- normalized `client_contacts` or `bot_clients` table,
- indexes for stats and client cards:
  - `lead_requests(client_id, created_at desc)`,
  - `lead_requests(session_id)`,
  - `session_logs(session_id)`,
  - `users(client_id, last_seen_at desc)`.

These are not required for the current lightweight implementation, but they are the right direction if this becomes a core CRM feature.

## 8. Quality Checks

Before considering stats/client UI stable, verify:

- totals are not all zero when data exists,
- today's counters use the correct date/timezone logic,
- latest requests are sorted by `created_at DESC`,
- legacy `widget_*` sources are excluded,
- Telegram links open when username/id exists,
- accordions open and close reliably,
- details are attached to the correct section,
- raw JSON does not overflow the modal,
- no `null` values are rendered directly.
