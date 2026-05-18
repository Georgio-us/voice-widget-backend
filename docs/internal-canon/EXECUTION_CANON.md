# Execution Canon

Status: source of truth
Updated: 2026-05-18
Scope: AI extraction, catalog context, residential complex matching, search execution, Telegram entry tracking.

This document replaces temporary audit/pre-market notes. If behavior differs from this file, the code or this document must be updated immediately.

## 1. Core Rule

AI does not decide the final cards. AI extracts structured intent and writes a canonical patch. The actual catalog result is produced by deterministic search/filtering over the active database catalog.

Current pipeline:

1. User sends text or audio to the Telegram Mini App.
2. Frontend sends the message to `POST /api/audio/upload`.
3. Backend transcribes audio when needed.
4. GPT extracts `insights` according to the backend prompt/schema.
5. Backend normalizes the model output into canonical fields.
6. Frontend merges AI fields with manual filters.
7. Manual filters override AI fields.
8. Effective query is sent to `/api/cards/search`.
9. Cards shown in the UI are treated as the final truth.

## 2. Canonical Fields

The product relies on canonical search fields, not raw user phrases.

Important examples:

- `buy` is normalized to `sale`.
- `хата`, `квартира`, `апартаменты` become `type=apartment` when applicable.
- `2к`, `двушка`, `двухкомнатная` become `rooms=["2"]` or `rooms=2` depending on layer.
- `100к`, `100 тысяч`, `100000` become numeric budget fields.
- User-facing district/location words are normalized before they influence search.

Known canonical district set:

- `primorsky`
- `kievsky`
- `malinovsky`
- `suvorovsky`

Microdistrict/location support is intentionally narrower than free text. Streets such as `Краснова`, `Ришельевская`, `Генуэзская` may appear in titles/descriptions, but they are not primary filter dimensions unless explicitly supported by the product logic.

## 3. Residential Complex Intent

Residential complex search is a strict catalog intent.

Rules:

- The model may write `residentialComplex` only when the requested name closely matches the available residential-complex catalog.
- If a user asks for an unknown complex, the system should not invent a `residentialComplex` value.
- Unknown ЖК intent may still set `rcOnly=true` so the user gets residential-complex properties instead of a fabricated exact match.
- Multiple residential complexes are supported as an array.
- Group names are supported when they map to known complexes.

Current group behavior:

- `Альтаир` can expand to `ЖК Альтаир 1`, `ЖК Альтаир 2`, `ЖК Альтаир 3`.
- A query like `ЖК Омега или Альтаир` can produce a multi-RC filter containing `ЖК Омега` and the Альтаир group.

This behavior is global, not demo-only.

## 4. Active Catalog Context

The AI can receive a compact active catalog context so it understands what objects/ЖК are actually present before responding.

Current env variables:

- `AI_CATALOG_CONTEXT_ENABLED=1`
- `AI_CATALOG_CONTEXT_CLIENT_ID=<client_id>`
- `AI_CATALOG_CONTEXT_MAX_ITEMS=200`
- `AI_CATALOG_CONTEXT_DEBUG=0`
- `AI_ASSISTANT_FLAVOR=showroom`

Legacy fallback variables are still supported for compatibility, but should not be used for new deployments:

- `DEMO_CATALOG_CONTEXT_ENABLED`
- `DEMO_CATALOG_CONTEXT_CLIENT_ID`
- `DEMO_CATALOG_CONTEXT_MAX_ITEMS`
- `DEMO_CATALOG_CONTEXT_DEBUG`
- `DEMO_PROMPT_FLAVOR`
- `DEMO_SHOWROOM_PROMPT_ENABLED`

Current limits:

- Default max items: `200`.
- Hard cap: `300`.
- Cache TTL: about 5 minutes.
- If the client has fewer active objects than the max, only existing active objects are injected.
- If the client has more active objects than the max, context is truncated. For 300+ active catalogs, a future digest/index strategy is needed.

Injected context is compact and does not include full descriptions/images/raw database rows. It focuses on fields useful for matching:

- object id
- operation/type
- rooms
- area
- price
- district/location
- residential complex
- key flags
- title

User-facing assistant language must not call this a `demo catalog`. The current prompt block is `ACTIVE CATALOG CONTEXT`, and showroom responses should speak naturally as `в базе`, `в каталоге`, or `вижу варианты`.

## 5. Showroom Response Mode

`AI_ASSISTANT_FLAVOR=showroom` makes the assistant more useful for sales/demo conversations:

- It may mention real available directions/complexes from the active catalog.
- It should avoid dry refusal when a broad query can be mapped to available catalog areas.
- It should still avoid inventing unavailable objects.
- It should guide the user toward a concrete selection when parameters are broad.

This mode improves assistant text. It does not replace deterministic search.

## 6. Strict / Relaxed Search

Search still has strict and relaxed behavior for card delivery.

High-level behavior:

- First, strict filters are applied.
- If strict results are empty or exhausted, relaxed flow may progressively loosen less critical constraints.
- Manual filters stay authoritative.
- Relaxed state is diagnostic and visible in debug insights.

Relaxation must not rewrite the user's canonical intent. It only affects candidate expansion.

## 7. Manual Filters

Manual filters remain the most deterministic control surface.

Rules:

- Manual filters override AI-derived fields in effective query.
- AI can fill empty fields.
- AI can update fields when the user explicitly changes intent in conversation.
- The frontend debug menu must show manual filters, AI understanding, canonical patch, pre-validation query and post-validation query separately.

## 8. Telegram Mini App Entry Tracking

The Mini App now tracks Telegram users as soon as there is Telegram WebApp identity available.

Current behavior:

- Frontend calls `/api/audio/miniapp-open` on Mini App open.
- Payload includes Telegram WebApp user identity and init data where available.
- Backend upserts the user into `users`.
- If the user is new for the bot/client, backend sends a notifier message.

This is important for ad traffic: a user who opens the Mini App can be registered even before leaving a lead request, assuming Telegram provides identity.

## 9. Statistics / Requests / Clients

Current admin statistics work from existing entities:

- `users`
- `lead_requests`
- `session_logs`
- active `properties`

Implemented UI direction:

- Summary numbers in stats.
- Latest requests accordion.
- Latest activity accordion.
- Details block with readable session/request summary instead of raw JSON.
- Admin panel indicator for unread stats/activity.
- Crown indicator for total unread admin attention items.

Future client card direction:

- A dedicated `Clients` section should use Telegram user id as the primary contact handle.
- Broadcast/notification features should be built later on top of stored Telegram user ids.

## 10. Current Live Smoke Reference

Recent live checks after generalizing `AI_CATALOG_CONTEXT_*`:

- `Привет, что есть в Альтаире?` produced the Альтаир complex group and returned matching catalog results.
- `Покажи ЖК Омега или Альтаир, 1-2 комнаты` produced a multi-RC query.
- `Что есть на Таирова до 100 тысяч?` mapped to Киевский/Таирова with budget max.
- `Покажи новостройки на поселке Котовского` mapped to Суворовский / Поселок Котовского.
- `Есть что-то в ЖК Хогвартс?` did not fabricate a residential complex and fell back to `rcOnly` behavior.

## 11. Known Limits

Current accepted limits:

- Large catalogs above 300 active objects need a smarter catalog digest, not a bigger prompt dump.
- Street names are not first-class filter entities unless explicitly canonized.
- Descriptions can contain noisy words; AI/search should primarily rely on canonical fields and title-level hints.
- Location ambiguity still needs careful handling for future cities/markets.
- The assistant response is guidance; card search output is the product truth.
