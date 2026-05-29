import fs from 'fs';
import xml2js from 'xml2js';
import fetch from 'node-fetch';
import { pool } from './db.js';
import { ensureResidentialComplexes } from './residentialComplexesRepository.js';

export async function upsertXmlProperty(payload, clientId) {
  const safeClientId = String(clientId || 'test').trim();
  const safeExternalId = String(payload.external_id || '').trim();
  if (!safeExternalId) return null;

  const operation = String(payload.operation || 'sale').trim();
  const propertyType = String(payload.property_type || 'apartment').trim();
  const city = String(payload.location_city || '').trim();
  const district = String(payload.location_district || '').trim();
  const address = String(payload.location_address || '').trim();
  const description = String(payload.description || '').trim();
  const priceAmount = Number(payload.price_amount);
  const rooms = Number.isFinite(payload.specs_rooms) ? payload.specs_rooms : null;
  const floor = Number.isFinite(payload.specs_floor) ? payload.specs_floor : null;
  const areaM2 = Number.isFinite(payload.specs_area_m2) ? payload.specs_area_m2 : null;
  const buildingFloors = Number.isFinite(payload.building_floors) ? payload.building_floors : null;
  const images = Array.isArray(payload.images) ? payload.images : [];
  const balcony = payload.specs_balcony === true;
  const buildingYear = Number.isFinite(payload.building_year) ? payload.building_year : null;
  const raw = payload.raw || {};

  const geo = {
    city,
    district: district || null,
    address: address || null
  };
  const features = {
    rooms,
    areaM2,
    floor,
    ...(payload.extraFeatures || {})
  };
  const media = images.map((url) => ({ type: 'image', url }));

  const query = `
    INSERT INTO properties (
      client_id, external_id, operation, property_type, price_amount, price_currency,
      geo, features, media, location_city, location_district, location_address,
      building_floors, building_year, specs_rooms, specs_area_m2, specs_floor, specs_balcony, description, images, raw, is_active, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12,
      $13, $14, $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb, true, NOW()
    )
    ON CONFLICT (client_id, external_id) DO UPDATE SET
      operation = EXCLUDED.operation,
      property_type = EXCLUDED.property_type,
      price_amount = EXCLUDED.price_amount,
      price_currency = EXCLUDED.price_currency,
      geo = EXCLUDED.geo,
      features = EXCLUDED.features,
      media = EXCLUDED.media,
      location_city = EXCLUDED.location_city,
      location_district = EXCLUDED.location_district,
      location_address = EXCLUDED.location_address,
      building_floors = EXCLUDED.building_floors,
      building_year = EXCLUDED.building_year,
      specs_rooms = EXCLUDED.specs_rooms,
      specs_area_m2 = EXCLUDED.specs_area_m2,
      specs_floor = EXCLUDED.specs_floor,
      specs_balcony = EXCLUDED.specs_balcony,
      description = EXCLUDED.description,
      images = EXCLUDED.images,
      raw = EXCLUDED.raw,
      is_active = EXCLUDED.is_active,
      updated_at = NOW()
    RETURNING *
  `;

  const values = [
    safeClientId, safeExternalId, operation, propertyType,
    Number.isFinite(priceAmount) ? Math.round(priceAmount) : null,
    payload.price_currency || 'USD',
    JSON.stringify(geo), JSON.stringify(features), JSON.stringify(media),
    city, district || null, address || null,
    buildingFloors, buildingYear, rooms, areaM2, floor, balcony,
    description || null, JSON.stringify(images), JSON.stringify(raw)
  ];

  try {
    const { rows } = await pool.query(query, values);
    return rows[0];
  } catch (error) {
    console.error('Error upserting XML property:', error);
    throw error;
  }
}

export async function parseAndImportXml(url, clientId = 'test') {
  console.log(`Fetching XML from ${url}...`);
  
  let xmlData;
  if (url.startsWith('http')) {
    const response = await fetch(url);
    xmlData = await response.text();
  } else {
    xmlData = fs.readFileSync(url, 'utf-8');
  }

  console.log('Parsing XML...');
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
  const result = await parser.parseStringPromise(xmlData);
  
  const offers = result['realty-feed']?.offer || [];
  const offersArray = Array.isArray(offers) ? offers : [offers];
  
  console.log(`Found ${offersArray.length} offers. Starting import...`);
  
  // --- PRE-IMPORT RC NAMES ---
  try {
    const rcNames = [...new Set(offersArray.flatMap(o => {
      const arr = Array.isArray(o.novostroi_name) ? o.novostroi_name : [o.novostroi_name];
      return arr.map(n => String(n || '').trim()).filter(Boolean);
    }))];
    if (rcNames.length > 0) {
      console.log(`Ensuring ${rcNames.length} unique Residential Complexes...`);
      await ensureResidentialComplexes(clientId, rcNames);
    }
  } catch (err) {
    console.error('Failed to ensure RC names for XML feed', err.message);
  }
  
  let imported = 0;
  for (const offer of offersArray) {
    try {
      const external_id = offer.$?.['internal-id'] || offer.nomer;
      if (!external_id) continue;

      const type = offer.type === 'аренда' ? 'rent' : 'sale';
      
      let property_type = 'apartment';
      const cat = (offer.category || '').toLowerCase().trim();
      if (['дом', 'дача', 'таунхаусы', 'таунхаус'].includes(cat)) property_type = 'house';
      else if (['участок', 'uchastok'].includes(cat)) property_type = 'land';
      else if (['коммерческая', 'коммерция', 'офисы', 'торговые помещения', 'промышленность', 'склады'].includes(cat)) property_type = 'commercial';

      const price_amount = offer.price?.value ? Number(offer.price.value) : null;
      const price_currency = offer.price?.currency || 'USD';
      
      const loc = offer.location || {};
      const location_city = loc['locality-name'] || '';
      const location_district = loc['sub-locality-name'] || '';
      const location_address = loc.address || '';
      
      const specs_rooms = offer.rooms ? Number(offer.rooms) : null;
      const specs_floor = offer.floor ? Number(offer.floor) : null;
      const building_floors = offer['floors-total'] ? Number(offer['floors-total']) : null;
      const specs_area_m2 = offer.area?.value ? Number(offer.area.value) : null;
      
      let images = [];
      if (offer.image) {
        const rawImages = Array.isArray(offer.image) ? offer.image : [offer.image];
        images = rawImages.filter(url => typeof url === 'string' && url.startsWith('http'));
      }
      
      const description = offer.description || '';
      
      let specs_balcony = false;
      let building_year = null;
      let extraFeatures = {};
      
      const rawRcNames = Array.isArray(offer.novostroi_name) ? offer.novostroi_name : [offer.novostroi_name];
      const rcName = [...new Set(rawRcNames.map(n => String(n || '').trim()).filter(Boolean))].join(', ');
      if (rcName) {
        extraFeatures.complex = rcName;
        extraFeatures.zkh = rcName;
      }
      
      const chars = offer.characteristics?.option || [];
      const charArray = Array.isArray(chars) ? chars : [chars];
      for (const char of charArray) {
        if (!char || !char.key || !char.value) continue;
        const key = String(char.key).trim();
        const value = String(char.value).trim();
        if (!value) continue;
        
        if (key === 'Балкон') {
          if (value.toLowerCase() !== 'нет') specs_balcony = true;
        } else if (key === 'Год постройки') {
          const yr = parseInt(value, 10);
          if (Number.isFinite(yr)) building_year = yr;
        } else {
          if (key === 'Тип дома' && value.toLowerCase().includes('новострой')) {
            extraFeatures.residentialComplex = true;
          }
          const enKeyMap = {
            'Состояние': 'condition',
            'Санузел': 'bathroom_type',
            'Потолок': 'ceiling',
            'Материал': 'wall_material',
            'Коммуникации': 'communications',
            'Газ': 'gas',
            'Вода': 'water',
            'Фасад': 'facade',
            'Фасокон': 'windows_facing',
            'Тип дома': 'building_type'
          };
          const mappedKey = enKeyMap[key] || key;
          extraFeatures[mappedKey] = value;
        }
      }
      
      if (offer.planirovka) {
        const p = typeof offer.planirovka === 'string' ? offer.planirovka : offer.planirovka?._ || JSON.stringify(offer.planirovka);
        extraFeatures.layout = p;
      }
      
      const raw = {
        source: 'xml_import',
        original_url: url,
        raw_xml: offer
      };

      const payload = {
        external_id,
        operation: type,
        property_type,
        price_amount,
        price_currency,
        location_city,
        location_district,
        location_address,
        specs_rooms,
        specs_floor,
        specs_area_m2,
        building_floors,
        building_year,
        specs_balcony,
        description,
        images,
        extraFeatures,
        raw
      };

      await upsertXmlProperty(payload, clientId);
      imported++;
      if (imported % 100 === 0) {
        console.log(`Imported ${imported} offers...`);
      }
    } catch (err) {
      console.error('Error importing offer:', err.message);
    }
  }
  
  console.log(`Import complete! Successfully imported ${imported} offers for client_id: ${clientId}.`);
}
