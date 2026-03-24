import fs from 'node:fs';
import path from 'node:path';

const OUTPUT = path.resolve(process.cwd(), 'data/import/odesa_properties_50.csv');

const districts = [
  { district: 'Київський', neighborhoods: ['Таїрова', 'Фонтан', 'Чорноморка'] },
  { district: 'Суворовський', neighborhoods: ['Котовського', 'Лузанівка', 'Слобідка'] },
  { district: 'Приморський', neighborhoods: ['Центр', 'Аркадія', 'Французький бульвар'] }
];

const buildingTypes = ['новобудова', 'чешка', 'сталінка', 'спецпроект', 'хрущовка'];
const wallMaterials = ['цегла', 'моноліт', 'панель', 'газоблок'];
const balconyTypes = ['засклений', 'відкритий', 'лоджія', 'французький', 'без балкона'];
const conditions = ['від будівельників', 'житловий стан', 'після ремонту', 'євроремонт'];
const infraPool = ['дитячий майданчик', 'поруч парк', 'охорона', 'підземний паркінг', 'гостьовий паркінг', 'консьєрж'];
const titlePool = ['Квартира біля моря', 'Світла квартира', 'Квартира під інвестицію', 'Сімейна квартира', 'Квартира з терасою'];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickMany(arr, min = 1, max = 3) {
  const count = Math.min(arr.length, min + Math.floor(Math.random() * (max - min + 1)));
  const copy = [...arr];
  const out = [];
  while (out.length < count && copy.length) {
    const i = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(i, 1)[0]);
  }
  return out;
}

function int(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function toCsvValue(v) {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const header = [
  'external_id',
  'operation',
  'property_type',
  'price_amount',
  'price_currency',
  'price_per_m2',
  'location_country',
  'location_city',
  'location_district',
  'location_neighborhood',
  'location_address',
  'building_year',
  'building_floors',
  'building_type',
  'wall_material',
  'elevator',
  'balcony_type',
  'condition',
  'building_infrastructure',
  'specs_rooms',
  'specs_bathrooms',
  'specs_area_m2',
  'specs_floor',
  'specs_balcony',
  'specs_terrace',
  'furnished',
  'title',
  'description',
  'images'
];

const rows = [];
for (let i = 1; i <= 50; i++) {
  const loc = pick(districts);
  const neighborhood = pick(loc.neighborhoods);
  const rooms = pick([1, 1, 2, 2, 2, 3, 3, 4]);
  const area = int(30 + rooms * 8, 55 + rooms * 22);
  const floor = int(1, 24);
  const buildingFloors = Math.max(floor, int(5, 26));
  const condition = pick(conditions);
  const buildingType = pick(buildingTypes);
  const wallMaterial = pick(wallMaterials);
  const balconyType = pick(balconyTypes);
  const elevator = buildingFloors >= 6 ? true : pick([true, false]);
  const hasBalcony = balconyType !== 'без балкона';
  const hasTerrace = pick([false, false, false, true]);
  const furnished = pick([true, false, false, true]);

  const pricePerM2Base = {
    'Центр': [38000, 69000],
    'Аркадія': [42000, 79000],
    'Французький бульвар': [45000, 82000],
    'Фонтан': [36000, 62000],
    'Таїрова': [30000, 50000],
    'Чорноморка': [26000, 45000],
    'Котовського': [23000, 40000],
    'Лузанівка': [27000, 47000],
    'Слобідка': [22000, 39000]
  };

  const [ppmMin, ppmMax] = pricePerM2Base[neighborhood] || [26000, 52000];
  const pricePerM2 = int(ppmMin, ppmMax);
  const priceAmount = Math.round(area * pricePerM2 / 1000) * 1000;

  const title = `${pick(titlePool)} • ${neighborhood}`;
  const description = `${rooms}-кімнатна квартира, ${area} м², ${condition}. Район ${neighborhood}, ${loc.district} район. ${elevator ? 'Є ліфт' : 'Без ліфта'}, матеріал стін: ${wallMaterial}, балкон: ${balconyType}.`;

  const images = [
    `https://picsum.photos/seed/od-${i}-1/1200/900`,
    `https://picsum.photos/seed/od-${i}-2/1200/900`,
    `https://picsum.photos/seed/od-${i}-3/1200/900`
  ];

  rows.push([
    `OD${String(i).padStart(3, '0')}`,
    'sale',
    'apartment',
    priceAmount,
    'UAH',
    pricePerM2,
    'UA',
    'Одеса',
    loc.district,
    neighborhood,
    `вул. ${pick(['Генуезька', 'Люстдорфська дорога', 'Пушкінська', 'Канатна', 'Філатова'])}, ${int(1, 120)}`,
    int(1998, 2026),
    buildingFloors,
    buildingType,
    wallMaterial,
    elevator,
    balconyType,
    condition,
    JSON.stringify(pickMany(infraPool, 2, 4)),
    rooms,
    pick([1, 1, 1, 2, 2, 3]),
    area,
    floor,
    hasBalcony,
    hasTerrace,
    furnished,
    title,
    description,
    JSON.stringify(images)
  ]);
}

const lines = [header.join(','), ...rows.map((r) => r.map(toCsvValue).join(','))];
fs.writeFileSync(OUTPUT, `${lines.join('\n')}\n`, 'utf8');

console.log(`✅ Generated ${rows.length} objects:`);
console.log(OUTPUT);
