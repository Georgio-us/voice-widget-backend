# Feed Geo Audit 2026-06-05

Date: 2026-06-05
Updated: 2026-06-08
Client: Estyle
Source feed: `https://estylespain.com/xml/xml-mediaelx.php?f=69e7b52b6c411`
Live feed size at original audit time: 548 objects
Latest dry-run size on 2026-06-08: 549 objects

## Purpose

This note captures geo/catalog issues found after the first production feed sync.

The goal is to separate three things:

- real feed quality issues;
- runtime catalog support that can be derived safely from active feed data;
- narrow exceptions for confirmed urbanizations that are hidden in `title`, `url`, or `address`.

## Current Status

### Closed: Active Feed Geo Catalog

The previous audit listed many `town` / `location_detail` values as potential unsupported catalog gaps, including:

- `Orihuela-Costa`
- `Finestrat`
- `Algorfa`
- `La Finca Golf Resort`
- `Las Ramblas`
- `Cumbre Del Sol`
- `Guardamar del Segura`
- `Rojales`
- `Torre de la Horadada`
- `Benissa`
- `Aguas Nuevas`
- `Benijofar`
- `La Veleta`
- `San Fulgencio`
- `Sucina`

This class of issue is now closed by runtime behavior:

- canonical query builds a supported geo catalog from active database properties;
- active `city`, `district`, `neighborhood`, and approved `urbanizations` are considered supported;
- if a feed location appears in active objects, it can be matched without adding it manually to a static dictionary;
- if a location disappears from active feed objects, it stops being supported naturally;
- static/manual geo remains only as fallback and for broader known business geography.

Important production fix:

- `Orihuela-Costa` is treated as a geo value when it appears as location text;
- the `Costa` part is not allowed to create an accidental `near_sea` overfilter unless the user actually expressed coastal intent.

Verified examples after the fix:

- `Finestrat apartment` returns supported matches;
- `Benissa villa` returns supported matches;
- `Orihuela-Costa apartment` returns supported matches;
- `Barcelona apartment` remains unsupported and falls back according to unsupported-geo policy.

### Closed: Confirmed Hidden Urbanizations

Problem:

- Some user-facing complexes exist in the feed but are not always stored in `location_detail`.
- They can be stored under broader areas such as `Punta Prima`, while the complex name appears only in `title`, `url`, or `address`.
- `description` is intentionally not used because it is too noisy for geo matching.

Production-safe fix:

- Added a controlled urbanization allowlist.
- Matching sources: `location_detail`, `title`, `url`, `address`.
- The rule is explicit and narrow; it does not parse arbitrary title text into geo.

Current approved allowlist:

- `La Entrada`
- `La Recoleta`
- `Panorama Park`
- `Parque Recoleta`

Verified examples after the fix:

- `La Entrada` / `Ла Энтрада` resolves as supported geo;
- `La Recoleta` resolves as supported geo;
- `Panorama Park` resolves as supported geo;
- `Parque Recoleta` / `парк реколета` resolves as supported geo.

## Feed-Level Concern

The feed still does not expose a reliable dedicated `urbanization` / `residential_complex` field.

Observed location-related fields:

- `town`
- `province`
- `costa`
- `location_detail`
- `location/address`
- `title`
- `url`
- `desc`
- `community`

`community` is not an urbanization field. It contains fee-like values such as monthly or yearly community payments.

Because of this, real complexes can still be hidden in text fields. The current runtime solution deliberately supports only confirmed names through a narrow allowlist.

## Remaining Watchlist

These are not automatically approved runtime rules. They are examples that may require client confirmation or source-feed cleanup if they become user-facing issues:

| Name | Observed pattern | Current action |
|---|---|---|
| `Vista Azul` | Appears in title; `location_detail` varies | Do not add until confirmed |
| `Santa Rosalía` | Mixed between direct location and nearby broader location | Prefer active feed catalog when structured; allowlist only if hidden cases are confirmed |
| `Amay / Balcones de Amay` | Appears in title; location can be `Punta Prima` or `Los Balcones` | Do not add until confirmed |
| `La Fuente` | Appears in title; mixed location context | Do not add until confirmed |
| `Green Hills` | Title-only candidate | Do not add until confirmed |
| `Iria I` | Title-only candidate | Do not add until confirmed |
| `Jardines Montesolana` | Title-only candidate | Do not add until confirmed |
| `Jumilla II` | Title-only candidate | Do not add until confirmed |
| `Laguna Golf` | Title-only candidate | Do not add until confirmed |
| `Serena IV` | Title-only candidate | Do not add until confirmed |
| `VistaMar` | Address-only candidate | Do not add until confirmed |

## Runtime Policy

Safe runtime rules:

- Structured geo from active feed objects is supported automatically.
- Confirmed hidden urbanizations are supported only through explicit allowlist entries.
- `description` is not parsed for geo.
- Arbitrary title parsing is not allowed.
- Title/url/address matching is allowed only for known names from the controlled allowlist.
- Hidden urbanization matching must not overwrite stored `city`, `district`, or `neighborhood`.

Safe allowlist criteria:

- The name was explicitly observed in production or confirmed by the client.
- The name maps to actual active feed objects.
- The name appears in at least one reliable source among `location_detail`, `title`, `url`, or `address`.
- The rule is explicit and narrow.

## Recommended Direction

Current runtime approach is acceptable for production:

1. Let active structured feed geo drive supported locations automatically.
2. Keep the urbanization allowlist small and client-confirmed.
3. Keep `description` out of geo matching.
4. Use this audit as evidence if the client wants to improve the XML feed itself.

Preferred feed improvement:

- add a dedicated structured `urbanization` or `residential_complex` field;
- normalize `location_detail` so real complexes are not buried in `title`, `url`, or `address`;
- keep removed/sold objects out of active feed output so daily sync can safely deactivate them.

## Decision

No broad runtime expansion is needed from this audit.

The main catalog-gap class is closed by active feed catalog support. The remaining issue is feed quality for hidden urbanizations, and the safe production strategy is controlled allowlist only for confirmed names.
