# XML Contract Audit (Feed -> DB -> Slider)

Last updated: 2026-04-22
Branch: `Split`
Mode: research only (no functional code changes in this step)

## Goal

Establish factual contract between:
1. XML feed payload (`xml-mediaelx`)
2. backend storage (`properties`)
3. frontend slider card rendering

So we can decide exactly which fields to keep and how to normalize them.

## Source Snapshot

- Feed file analyzed: `/private/tmp/mediaelx.xml`
- Objects: `547`
- Top-level tags per property: `66`

## Feed Field Inventory (Full top-level list)

Feed returns these `66` top-level tags per property:

`id, date, ref, price, price_old, price_from, comision, suma, community, catrastal_reference, price_m_1, price_m_2, price_m_3, price_m_4, price_m_5, price_m_6, price_m_7, price_m_8, price_m_9, price_m_10, price_m_11, price_m_12, prices_days, availabity, currency, price_freq, type, town, province, costa, location_detail, beds, baths, wc, energy, year_build, pool, parking, parking_places, wardrobes, kitchens, condition, floor, v360, orientation, distance_beach, distance_beach_med, distance_airport, distance_airport_med, distance_golf, distance_golf_med, distance_amenities, distance_amenities_med, solarium, surface_area, url, title, desc, images, plans, videos, views360, tags, features, location, new_build`.

Main nested groups detected:
- `type`: localized values (`en/es/ru/...`)
- `title`: localized values (`en/es/ru`)
- `desc`: localized values (`en/es/ru`)
- `floor`: localized values (`en/es/ru/...`)
- `surface_area`: `built`, `plot`, `terrace`, `usable`, `garden`, `solarium`
- `images`: multiple `image` nodes with `url`
- `features`: repeated `feature`
- `location`: `latitude`, `longitude`, `zoom`, `address`
- `url`: `en`
- `videos`: `video_url`
- `tags`: `tag`
- `pool` / `parking` / `kitchens` / `condition`: localized flags/labels

## Feed Field Inventory (Key coverage)

Coverage across 547 objects:

| Feed field | Non-empty |
|---|---:|
| `id` | 547 |
| `ref` | 547 |
| `price` | 547 |
| `currency` | 547 |
| `price_freq` | 547 |
| `town` | 547 |
| `province` | 547 |
| `location_detail` | 547 |
| `beds` | 547 |
| `baths` | 547 |
| `surface_area/built` | 532 |
| `year_build` | 396 |
| `floor` (localized node) | 13 |
| `title` (any lang) | 541 |
| `desc` (any lang) | 541 |
| `images` blocks | 543 |
| `images/image` total | 12616 |
| `price_m_1` | 6 |

Operational split:
- `price_freq=sale`: `539`
- `price_freq=week`: `8` (mapped to `operation=rent`)

## What We Store in DB (`properties`)

Importer (`scripts/importFromXml.js`) currently fills:

- identity: `client_id`, `external_id`
- deal/type: `operation`, `property_type`
- price: `price_amount`, `price_currency`
- location: `location_city`, `location_district`, `location_neighborhood`, `location_address`
- specs: `specs_rooms`, `specs_bathrooms`, `specs_area_m2`, `specs_floor`
- content: `title`, `description`, `images`
- traceability: `raw`, `is_active`

Current intentional omissions:
- `price_per_m2` always `NULL`
- `building_floors` / many secondary fields not mapped yet

## What Slider Receives Today

Current card payload from backend (`controllers/audioController.js`, `formatCardForClient`) returns:
- `id`, `city`, `district`, `neighborhood`
- `price`, `priceEUR`, `rooms`, `floor`
- `description`, `area_m2`, `price_per_m2`, `bathrooms`
- `image`, `imageUrl` (first image only)

Not returned in payload:
- `images[]` full gallery array

## Observed Gaps (Manual QA + Code Trace)

1. Description shown with HTML tags (`<p>`, `<strong>`)
- Cause: slider escapes HTML before render in `voice-widget-v1.js`.
- Result: user sees raw markup.

2. Only one image shown in card context
- Cause: backend payload provides only first image (`image/imageUrl`), no `images[]`.
- Result: frontend cannot reliably build full gallery from interaction response.

3. Floor mostly empty
- Cause: feed stores floor as localized nested node; importer reads only direct `<floor>` value.
- Result: `specs_floor` often null (real fill is only 13/547 in source anyway).

4. Price per m2 empty
- Cause: no direct universal feed field mapped into `price_per_m2`; importer sets null.
- Result: UI field remains `null`.

5. Location duplication/noise in subtitle
- Cause: mapping `town -> city`, `province -> district`, `location_detail -> neighborhood` can create repeated geo labels.

## Proposed Contract Decision (Before Code Changes)

For v1 stable slider, keep and require:
- `id`
- `price_amount` (+currency)
- `location_city`
- `location_neighborhood` (if non-duplicate)
- `specs_rooms`
- `specs_bathrooms` (optional display)
- `specs_area_m2` (optional display)
- `images[]` (multi-image mandatory for gallery behavior)
- `description` (render as safe rich text or plain cleaned text)

Treat as optional/nullable:
- `specs_floor`
- `price_per_m2`
- `building_year`

## Icon Contract (Current Slice)

Fields added to current scope for front-card icons:

1. `area_m2` (`specs_area_m2`) -> `house-blue.svg` + value
2. `plot_m2` (`specs_plot_m2`) -> `plano-blue.svg` + value (only if exists)
3. `rooms` (`specs_rooms`) -> `bed-blue.svg` + value
4. `bathrooms` (`specs_bathrooms`) -> `bath-blue.svg` + value
5. `has_parking` -> `garaje-blue.svg` + check mark (show only when true)
6. `has_pool` -> `pool-blue.svg` + check mark (show only when true)

Feed sources used:
- `surface_area/built` -> `specs_area_m2`
- `surface_area/plot` -> `specs_plot_m2`
- `beds` -> `specs_rooms`
- `baths` -> `specs_bathrooms`
- `parking/*` (localized) -> `has_parking=true` when non-empty
- `pool/*` (localized) -> `has_pool=true` when non-empty

Status fields for front second line:
- `new_build` -> `is_new_build` (boolean)
- `price_freq` -> `operation` (`sale`/`rent`)
- UI status rule: `operation=rent -> RENT`, else `is_new_build=true -> NEW BUILD`, else `RESALE`

## Next Implementation Slice (planned, not executed here)

1. Payload contract fix:
- include `images` array in backend card payload.

2. Description normalization strategy:
- choose one: sanitize HTML and render, or strip tags to plain text.

3. Importer floor parsing:
- read localized `floor/en|es|ru` value (with numeric extraction).

4. `price_per_m2` policy:
- compute from `price_amount/specs_area_m2` when area exists, or keep hidden in UI.

5. Location clean-up:
- add de-duplication rule in mapping (avoid `city, province, city-like neighborhood` repetition).

## Notes

- This document is a contract baseline for the next coding iteration.
- Security hardening remains intentionally deferred until after XML and mapping stabilization.
