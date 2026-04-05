# Снимок кодов OLX `attributes`

Актуализировано по SQL-аудиту (последние 50 `OLX_%` записей), 2026-04-05.

## Частоты `attributes[].code` (last 50 imports)

| code | cnt |
|---|---:|
| `total_area` | 49 |
| `total_floors` | 47 |
| `floor` | 35 |
| `heating` | 34 |
| `furnish` | 26 |
| `repair` | 26 |
| `kitchen_area` | 25 |
| `number_of_rooms_string` | 25 |
| `bathroom_5` | 13 |
| `bathroom` | 12 |
| `land_area` | 11 |
| `apartments_object_type` | 10 |
| `number_of_rooms` | 10 |
| `property_type_houses` | 10 |
| `apartments_dev_type` | 9 |
| `is_repaired` | 9 |
| `bathroom_3` | 8 |
| `zkh` | 8 |
| `layout` | 5 |
| `pets` | 5 |
| `city_distance` | 3 |
| `comm_re_location` | 3 |
| `furnishing` | 3 |
| `blackout_autonomy` | 2 |
| `comfort` | 2 |
| `commission` | 2 |
| `comm_re_object_type` | 2 |
| `cooperate` | 2 |
| `is_exchange` | 2 |
| `year_construction` | 2 |
| `appliances_3` | 1 |
| `comm_re_type` | 1 |
| `communications` | 1 |
| `eoselia` | 1 |
| `external_wall_insulation` | 1 |
| `from_developer` | 1 |
| `garage_type` | 1 |
| `infrastructure3_500_m` | 1 |
| `office_type` | 1 |
| `property_type_land` | 1 |
| `property_type_parking` | 1 |

## Примечания

- Для `operation/property_type` используется детерминированный mapping по `category_id` (`data/olx/category-map.json`), без парсинга `title/description`.
- Для района: при `district_id = null` применяется подтверждённый fallback по `city_id` (`data/olx/district-map.json`).
- Площадь (`specs_area_m2`) хранится как `NUMERIC(10,2)`, дробные значения сохраняются без округления.
