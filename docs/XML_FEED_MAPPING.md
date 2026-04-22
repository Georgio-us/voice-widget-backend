# XML Feed Mapping (Estyle)

Last updated: 2026-04-22
Branch: `Split`
Status: analysis completed, implementation pending.

## Source Feeds

Two feed variants were provided:

1. `kyero` (simpler)
2. `xml-mediaelx` (richer)

URLs:
- `https://estylespain.com/xml/kyero.php?f=69e7b52b6c411`
- `https://estylespain.com/xml/xml-mediaelx.php?f=69e7b52b6c411`

## Selected Primary Feed

Use `xml-mediaelx` as primary import source.

Reason:
- same inventory volume as kyero
- significantly richer field set (66 top-level tags vs 22)
- multilingual content (`type/title/desc/features`)
- better forward compatibility for later product features

## Observed Feed Stats (mediaelx)

- total properties: `547`
- missing `id`: `0`
- missing `ref`: `0`
- missing `price`: `0`
- missing `town`: `0`
- missing `images`: `4`
- `price_freq` distribution:
  - `sale`: `539`
  - `week`: `8`

## Target DB Context

- table: `properties`
- unique key: `(client_id, external_id)`
- runtime client scope: `estyle`

## Mapping Matrix (mediaelx -> properties)

| XML field | DB column | Rule |
|---|---|---|
| `ref` (fallback `id`) | `external_id` | trim, uppercase, required |
| `price` | `price_amount` | integer parse |
| `currency` | `price_currency` | default `EUR` if empty |
| `price_freq` | `operation` | `sale -> sale`, `week -> rent` (or keep raw and map later by business rule) |
| `type/en` (fallback `type/es`, `type/ru`) | `property_type` | normalize to lowercase canonical type |
| `town` | `location_city` | trim |
| `province` | `location_district` | temporary district mapping until finer geo strategy |
| `location_detail` | `location_neighborhood` | trim |
| `location/address` | `location_address` | nullable |
| `beds` | `specs_rooms` | integer parse |
| `baths` | `specs_bathrooms` | integer parse |
| `surface_area/built` | `specs_area_m2` | integer parse |
| `surface_area/plot` | `raw` | keep in raw json for now |
| `floor` | `specs_floor` | integer parse nullable |
| `pool/*` | `specs_terrace` / `raw` | pool kept in raw; terrace unchanged unless explicit rule added |
| `desc/ru` (fallback `desc/en`, `desc/es`) | `description` | keep text/HTML as-is initially (sanitize later if needed) |
| `title/ru` (fallback `title/en`, `title/es`) | `title` | plain text |
| `images/image/url[]` | `images` | JSON array of URLs |
| whole `<property>` node | `raw` | JSON for traceability/debug |
| constant | `client_id` | `estyle` |
| constant | `is_active` | `true` (with future soft-deactivate step) |

## Normalization Rules (v1)

1. IDs:
   - `external_id = upper(trim(ref || id))`
2. Numbers:
   - parse int from numeric-looking values; else `null`
3. Strings:
   - trim; empty -> `null`
4. Arrays:
   - `images` as JSON array
5. Language preference:
   - `ru -> en -> es` for `title`/`desc`
   - for `type`: `en -> es -> ru`

## Import Behavior (v1)

1. Upsert by `(client_id, external_id)`
2. `client_id` taken from `IMPORT_CLIENT_ID` (fallback `APP_CLIENT_ID`)
3. No full-table delete
4. Maintain `is_active=true` for imported rows
5. Soft-deactivate missing rows in dedicated follow-up step (after first stable import)

## Open Decisions Before Coding

1. `price_freq=week`:
   - confirm final business mapping:
     - option A: map to `operation='rent'`
     - option B: keep `operation='sale'` and store original in `raw` (not recommended)
2. `location_district`:
   - current temporary mapping uses `province`.
   - later can map from richer locality fields if provided.

## Next Implementation Step

Create `scripts/importFromXml.js`:
- download feed URL
- parse xml
- normalize per rules above
- upsert into `properties`
- print import report:
  - total
  - inserted/updated
  - skipped
  - `sale` vs `week`
