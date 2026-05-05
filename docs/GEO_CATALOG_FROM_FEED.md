# GEO Catalog From Feed (Estyle)

Last updated: 2026-05-05  
Branch: `Split`  
Source: live `GET /api/cards/search?limit=5000` (active feed objects)

## Snapshot

- Total active objects: **550**
- Provinces present in feed:
  - `Alicante`: **508**
  - `Murcia`: **42**
- No active objects detected in:
  - `Valencia`
  - `Malaga`
  - `Barcelona`
  - `Madrid`

## City Inventory (from feed, top)

| City | Count | Province |
|---|---:|---|
| Torrevieja | 77 | Alicante |
| Orihuela-Costa | 54 | Alicante |
| Punta Prima | 51 | Alicante |
| Ciudad Quesada | 50 | Alicante |
| Alicante | 29 | Alicante |
| Benidorm | 27 | Alicante |
| Pilar de la Horadada | 23 | Alicante |
| Las Colinas Golf | 22 | Alicante |
| Cabo Roig | 18 | Alicante |
| Villamartin, Orihuela Costa | 18 | Alicante |
| Los Alcazares | 16 | Murcia |
| Algorfa (montemar) | 12 | Alicante |
| La Mata | 12 | Alicante |
| San Pedro del Pinatar | 12 | Murcia |
| Guardamar | 11 | Alicante |
| La Zenia | 10 | Alicante |
| Los Balcones | 10 | Alicante |
| San Miguel De Salinas | 10 | Alicante |
| Las Ramblas Golf | 9 | Alicante |
| Moraira | 9 | Alicante |
| Los Altos | 8 | Alicante |
| Campoamor | 8 | Alicante |
| Murcia | 8 | Murcia |
| Playa Flamenca | 7 | Alicante |
| Calpe | 4 | Alicante |
| Mil Palmeras | 3 | Alicante |
| Altea | 3 | Alicante |
| Los Dolses | 3 | Alicante |
| Santiago de Ribeira | 3 | Murcia |
| Mar Menor | 3 | Murcia |
| LOS MONTESINOS | 3 | Alicante |
| Lomas de Cabo Roig | 2 | Alicante |
| San Javier | 2 | Murcia |
| Denia | 2 | Alicante |
| Torre Pacheco | 2 | Murcia |
| Pinar De Campoverde | 2 | Alicante |
| Vistabella Golf | 1 | Alicante |
| Almoradi | 1 | Alicante |
| La Nucia | 1 | Alicante |
| Polop | 1 | Alicante |
| Villajoyosa | 1 | Alicante |
| Javea | 1 | Alicante |
| Daya Vieja | 1 | Alicante |

## Coast Mapping (working catalog)

### 1) COSTA BLANCA SOUTH (primary)

Includes cities/micro-locations in south Alicante cluster:

- Torrevieja
- Orihuela-Costa
- Punta Prima
- Ciudad Quesada
- Pilar de la Horadada
- Guardamar
- La Mata
- La Zenia
- Los Balcones
- San Miguel De Salinas
- Campoamor
- Playa Flamenca
- Cabo Roig
- Lomas de Cabo Roig
- Los Dolses
- Villamartin, Orihuela Costa
- Las Colinas Golf
- Las Ramblas Golf
- Los Altos
- LOS MONTESINOS
- Daya Vieja
- Pinar De Campoverde
- Vistabella Golf
- Almoradi

### 2) COSTA BLANCA NORTH (secondary)

Includes north Alicante cluster:

- Alicante (city)
- Benidorm
- Calpe
- Altea
- Denia
- Javea
- Villajoyosa
- Polop
- La Nucia
- Moraira
- Algorfa (montemar) *(geo-adjacent; keep in Alicante group)*

### 3) COSTA CÁLIDA (Murcia scope)

- Los Alcazares
- San Pedro del Pinatar
- San Javier
- Torre Pacheco
- Santiago de Ribeira
- Mar Menor
- Murcia (city)

## Support Status Rules (for runtime/prompt)

### Supported (use in assistant suggestions)

- Any city/location present in this feed catalog (counts > 0).
- Priority suggestion order:  
  1. Costa Blanca South  
  2. Costa Blanca North  
  3. Costa Cálida

### Limited (do not promote proactively, but do not deny)

- `Valencia` (currently zero/near-zero feed presence).  
  Assistant behavior: “можно проверить точечно, но основная база — Costa Blanca/Costa Cálida.”

### Unsupported (do not promise inventory)

- `Malaga`, `Barcelona`, `Madrid` (and any city absent in feed).
  Assistant behavior:
  1. do not build fake geo suggestions;
  2. explain active coverage (the three coasts);
  3. offer manager escalation (`Связаться с менеджером`) for off-catalog requests.

## Notes

1. This catalog is feed-driven and must be refreshed from active inventory regularly.
2. Coast mapping is deterministic but still semantic (city-group based), because feed does not provide an explicit `coast` field.
3. `location_city` + `location_district` remain canonical geo source in runtime.
