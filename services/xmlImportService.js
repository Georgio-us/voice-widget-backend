import fs from 'fs';
import xml2js from 'xml2js';
import fetch from 'node-fetch';
import { pool } from './db.js';

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
  const raw = payload.raw || {};

  const geo = {
    city,
    district: district || null,
    address: address || null
  };
  const features = {
    rooms,
    areaM2,
    floor
  };
  const media = images.map((url) => ({ type: 'image', url }));

  const query = `
    INSERT INTO properties (
      client_id, external_id, operation, property_type, price_amount, price_currency,
      geo, features, media, location_city, location_district, location_address,
      building_floors, specs_rooms, specs_area_m2, specs_floor, description, images, raw, is_active, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7::jsonb, $8::jsonb, $9::jsonb, $10, $11, $12,
      $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb, true, NOW()
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
      specs_rooms = EXCLUDED.specs_rooms,
      specs_area_m2 = EXCLUDED.specs_area_m2,
      specs_floor = EXCLUDED.specs_floor,
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
    buildingFloors, rooms, areaM2, floor,
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
  
  let imported = 0;
  for (const offer of offersArray) {
    try {
      const external_id = offer.$?.['internal-id'] || offer.nomer;
      if (!external_id) continue;

      const type = offer.type === 'аренда' ? 'rent' : 'sale';
      
      let property_type = 'apartment';
      if (offer.category === 'дом' || offer.category === 'дача') property_type = 'house';
      if (offer.category === 'участок') property_type = 'land';
      if (offer.category === 'коммерческая' || offer.category === 'коммерция') property_type = 'commercial';

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
        images = Array.isArray(offer.image) ? offer.image : [offer.image];
      }
      
      const description = offer.description || '';
      
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
        description,
        images,
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
