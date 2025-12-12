// data/properties.js — прототипная база (20 объектов)
// Источник хранится в нормализованном виде (rawProperties),
// а наружу экспортируется плоский формат, ожидаемый остальным кодом.
const rawProperties = [
  {
    "id": "A001",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": false,
    "price": { "amount": 285000, "currency": "EUR" },
    "price_per_m2": 3958,
    "location": { "country": "ES", "city": "Valencia", "district": "Quatre Carreres", "neighborhood": "Malilla", "address": null },
    "building": { "year": 2022, "floors": 18, "infrastructure": ["pool", "gym"] },
    "specs": { "rooms": 2, "bathrooms": null, "area_m2": 72, "floor": 12, "balcony": false, "terrace": true },
    "title": null,
    "description": "2 спальни, 72 м², 12/18, терраса ~8 м², без мебели. Вид на русло Турии, рядом La Fe.",
    "images": ["https://<backend-host>/static/properties/A001_image.jpg"]
  },
  {
    "id": "A002",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": false,
    "price": { "amount": 340000, "currency": "EUR" },
    "price_per_m2": 3579,
    "location": { "country": "ES", "city": "Valencia", "district": "Campanar", "neighborhood": "Nou Campanar", "address": null },
    "building": { "year": 2020, "floors": 8, "infrastructure": ["rooftop_pool", "coworking", "concierge"] },
    "specs": { "rooms": 3, "bathrooms": null, "area_m2": 95, "floor": 2, "balcony": true, "terrace": false },
    "title": null,
    "description": "3 спальни, 95 м², 2/8, балкон ~12 м², без мебели. Рядом Nuevo Centro и Биопарк.",
    "images": ["https://<backend-host>/static/properties/A002_image.jpg"]
  },
  {
    "id": "A003",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": false,
    "price": { "amount": 210000, "currency": "EUR" },
    "price_per_m2": 4200,
    "location": { "country": "ES", "city": "Valencia", "district": "Algirós", "neighborhood": "Amistat", "address": null },
    "building": { "year": 2021, "floors": 14, "infrastructure": ["pool", "tennis"] },
    "specs": { "rooms": 1, "bathrooms": null, "area_m2": 50, "floor": 9, "balcony": false, "terrace": false },
    "title": null,
    "description": "1 спальня, 50 м², 9/14, без балкона, без мебели. Идеально под аренду у университетов.",
    "images": ["https://<backend-host>/static/properties/A003_image.jpg"]
  },
  {
    "id": "A004",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": false,
    "price": { "amount": 310000, "currency": "EUR" },
    "price_per_m2": 3444,
    "location": { "country": "ES", "city": "Valencia", "district": "Jesús", "neighborhood": "Patraix", "address": null },
    "building": { "year": 2028, "floors": 7, "infrastructure": ["coworking", "stroller_room", "green_yard"] },
    "specs": { "rooms": 3, "bathrooms": null, "area_m2": 90, "floor": 4, "balcony": true, "terrace": false },
    "title": null,
    "description": "3 спальни, 90 м², 4/7, балкон ~10 м², сдача 2028. Тихий жилой район с локальной коммерцией.",
    "images": ["https://<backend-host>/static/properties/A004_image.jpg"]
  },
  {
    "id": "A005",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": false,
    "price": { "amount": 460000, "currency": "EUR" },
    "price_per_m2": 3833,
    "location": { "country": "ES", "city": "Valencia", "district": "Quatre Carreres", "neighborhood": "Monteolivete", "address": null },
    "building": { "year": 2029, "floors": 35, "infrastructure": ["pool", "gym", "rooftop_lounge"] },
    "specs": { "rooms": 4, "bathrooms": null, "area_m2": 120, "floor": 24, "balcony": true, "terrace": false },
    "title": null,
    "description": "4 спальни, 120 м², 24/35, две лоджии, сдача 2029. Башня с lounge-террасами на крыше.",
    "images": ["https://<backend-host>/static/properties/A005_image.jpg"]
  },
  {
    "id": "A006",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": false,
    "price": { "amount": 260000, "currency": "EUR" },
    "price_per_m2": 3714,
    "location": { "country": "ES", "city": "Valencia", "district": "Poblats Marítims", "neighborhood": "El Grau", "address": null },
    "building": { "year": 2026, "floors": 16, "infrastructure": ["pool", "gym", "underground_parking"] },
    "specs": { "rooms": 2, "bathrooms": null, "area_m2": 70, "floor": 15, "balcony": true, "terrace": false },
    "title": null,
    "description": "2 спальни, 70 м², 15/16, лоджия ~6 м², сдача 2026. Близко порт и пляж.",
    "images": ["https://<backend-host>/static/properties/A006_image.jpg"]
  },
  {
    "id": "A007",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": false,
    "price": { "amount": 240000, "currency": "EUR" },
    "price_per_m2": 3692,
    "location": { "country": "ES", "city": "Valencia", "district": "Rascanya", "neighborhood": "Torrefiel", "address": null },
    "building": { "year": 2027, "floors": 4, "infrastructure": ["pool", "tennis"] },
    "specs": { "rooms": 2, "bathrooms": null, "area_m2": 65, "floor": 2, "balcony": true, "terrace": false },
    "title": null,
    "description": "2 спальни, 65 м², 2/4, французский балкон, сдача 2027.",
    "images": ["https://<backend-host>/static/properties/A007_image.jpg"]
  },
  {
    "id": "A008",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": false,
    "price": { "amount": 190000, "currency": "EUR" },
    "price_per_m2": 3167,
    "location": { "country": "ES", "city": "Valencia", "district": "Benicalap", "neighborhood": "Ciutat Fallera", "address": null },
    "building": { "year": 2025, "floors": 5, "infrastructure": ["kids_area", "bike_parking"] },
    "specs": { "rooms": 2, "bathrooms": null, "area_m2": 60, "floor": 1, "balcony": false, "terrace": false },
    "title": null,
    "description": "2 спальни, 60 м², 1/5, без балкона, сдача 2025. Двор с детской зоной.",
    "images": ["https://<backend-host>/static/properties/A008_image.jpg"]
  },
  {
    "id": "A009",
    "operation": "sale",
    "property_type": "townhouse",
    "furnished": true,
    "price": { "amount": 420000, "currency": "EUR" },
    "price_per_m2": 3000,
    "location": { "country": "ES", "city": "Valencia", "district": "Poblats Marítims", "neighborhood": "Cabanyal", "address": null },
    "building": { "year": 2020, "floors": 2, "infrastructure": [] },
    "specs": { "rooms": 3, "bathrooms": 2, "area_m2": 140, "floor": null, "balcony": false, "terrace": true },
    "title": null,
    "description": "Таунхаус 140 м², 2 этажа, 3 спальни, 2 с/у, частично меблирован. Терраса 25 м², близко к морю.",
    "images": ["https://<backend-host>/static/properties/A009_image.jpg"]
  },
  {
    "id": "A010",
    "operation": "sale",
    "property_type": "townhouse",
    "furnished": false,
    "price": { "amount": 520000, "currency": "EUR" },
    "price_per_m2": 2889,
    "location": { "country": "ES", "city": "Valencia", "district": "Benimaclet", "neighborhood": "Camí de Vera", "address": null },
    "building": { "year": 2019, "floors": 3, "infrastructure": ["parking"] },
    "specs": { "rooms": 4, "bathrooms": 3, "area_m2": 180, "floor": null, "balcony": false, "terrace": true },
    "title": null,
    "description": "Таунхаус 180 м², 3 этажа, 4 спальни, 3 с/у, без мебели. Дворик 40 м², парковка на 2 авто.",
    "images": ["https://<backend-host>/static/properties/A010_image.jpg"]
  },
  {
    "id": "A011",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": true,
    "price": { "amount": 280000, "currency": "EUR" },
    "price_per_m2": 3733,
    "location": { "country": "ES", "city": "Valencia", "district": "Ciutat Vella", "neighborhood": "El Carmen", "address": null },
    "building": { "year": null, "floors": 4, "infrastructure": [] },
    "specs": { "rooms": 2, "bathrooms": null, "area_m2": 75, "floor": 2, "balcony": false, "terrace": false },
    "title": null,
    "description": "Исторический квартал, 2/4 без лифта. 2 спальни, 75 м², мебель есть. Отопление электрическое.",
    "images": ["https://<backend-host>/static/properties/A011_image.jpg"]
  },
  {
    "id": "A012",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": false,
    "price": { "amount": 670000, "currency": "EUR" },
    "price_per_m2": 5360,
    "location": { "country": "ES", "city": "Valencia", "district": "Eixample", "neighborhood": "Pla del Remei", "address": null },
    "building": { "year": null, "floors": 8, "infrastructure": ["concierge"] },
    "specs": { "rooms": 3, "bathrooms": null, "area_m2": 125, "floor": 6, "balcony": false, "terrace": false },
    "title": null,
    "description": "Премиальный подъезд, 6/8, 3 спальни, 125 м². Отопление центральное, мебель опционально.",
    "images": ["https://<backend-host>/static/properties/A012_image.jpg"]
  },
  {
    "id": "A013",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": false,
    "price": { "amount": 590000, "currency": "EUR" },
    "price_per_m2": 3933,
    "location": { "country": "ES", "city": "Valencia", "district": "Eixample", "neighborhood": "Gran Vía", "address": null },
    "building": { "year": null, "floors": 7, "infrastructure": ["elevator"] },
    "specs": { "rooms": 4, "bathrooms": null, "area_m2": 150, "floor": 5, "balcony": false, "terrace": false },
    "title": null,
    "description": "Солидный дом, 5/7 с лифтом. 4 спальни, 150 м², без мебели. Отопление центральное.",
    "images": ["https://<backend-host>/static/properties/A013_image.jpg"]
  },
  {
    "id": "A014",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": true,
    "price": { "amount": 245000, "currency": "EUR" },
    "price_per_m2": 3063,
    "location": { "country": "ES", "city": "Valencia", "district": "Jesús", "neighborhood": "Patraix", "address": null },
    "building": { "year": null, "floors": 5, "infrastructure": [] },
    "specs": { "rooms": 2, "bathrooms": null, "area_m2": 80, "floor": 3, "balcony": false, "terrace": false },
    "title": null,
    "description": "Уютный квартал, 3/5. 2 спальни, 80 м², мебель частично. Отопление индивидуальное газовое.",
    "images": ["https://<backend-host>/static/properties/A014_image.jpg"]
  },
  {
    "id": "A015",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": true,
    "price": { "amount": 360000, "currency": "EUR" },
    "price_per_m2": 3273,
    "location": { "country": "ES", "city": "Valencia", "district": "Eixample", "neighborhood": "Russafa", "address": null },
    "building": { "year": null, "floors": 6, "infrastructure": [] },
    "specs": { "rooms": 3, "bathrooms": null, "area_m2": 110, "floor": 4, "balcony": true, "terrace": false },
    "title": null,
    "description": "Реконструированный модернистский дом, 4/6. 3 спальни, 110 м², французские балконы, мебель частично.",
    "images": ["https://<backend-host>/static/properties/A015_image.jpg"]
  },
  {
    "id": "A016",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": true,
    "price": { "amount": 220000, "currency": "EUR" },
    "price_per_m2": 3143,
    "location": { "country": "ES", "city": "Valencia", "district": "Poblats Marítims", "neighborhood": "Cabanyal", "address": null },
    "building": { "year": null, "floors": 3, "infrastructure": [] },
    "specs": { "rooms": 2, "bathrooms": null, "area_m2": 70, "floor": 1, "balcony": false, "terrace": false },
    "title": null,
    "description": "1/3, капитальный ремонт с сохранением аутентики. 2 спальни, 70 м², мебель есть. Близко к пляжу.",
    "images": ["https://<backend-host>/static/properties/A016_image.jpg"]
  },
  {
    "id": "A017",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": true,
    "price": { "amount": 470000, "currency": "EUR" },
    "price_per_m2": 3917,
    "location": { "country": "ES", "city": "Valencia", "district": "Campanar", "neighborhood": "Nou Campanar", "address": null },
    "building": { "year": 2019, "floors": 20, "infrastructure": ["pool", "tennis", "rooftop_lounge"] },
    "specs": { "rooms": 4, "bathrooms": 2, "area_m2": 120, "floor": 14, "balcony": true, "terrace": false },
    "title": null,
    "description": "4 спальни, 120 м², 14/20, две лоджии, меблирована. Бассейн + теннис, лаунж на крыше.",
    "images": ["https://<backend-host>/static/properties/A017_image.jpg"]
  },
  {
    "id": "A018",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": true,
    "price": { "amount": 210000, "currency": "EUR" },
    "price_per_m2": 4200,
    "location": { "country": "ES", "city": "Valencia", "district": "Quatre Carreres", "neighborhood": "Malilla", "address": null },
    "building": { "year": 2022, "floors": 17, "infrastructure": ["pool", "garden", "stroller_room"] },
    "specs": { "rooms": 1, "bathrooms": null, "area_m2": 50, "floor": 11, "balcony": false, "terrace": false },
    "title": null,
    "description": "1 спальня, 50 м², 11/17, мебель частично (спальня). Бассейн и сад в комплексе.",
    "images": ["https://<backend-host>/static/properties/A018_image.jpg"]
  },
  {
    "id": "A019",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": true,
    "price": { "amount": 295000, "currency": "EUR" },
    "price_per_m2": 4538,
    "location": { "country": "ES", "city": "Valencia", "district": "Quatre Carreres", "neighborhood": "Monteolivete", "address": null },
    "building": { "year": 2021, "floors": 15, "infrastructure": ["pool", "gym"] },
    "specs": { "rooms": 2, "bathrooms": null, "area_m2": 65, "floor": 9, "balcony": true, "terrace": false },
    "title": null,
    "description": "2 спальни, 65 м², 9/15, меблирована полностью, лоджия ~7 м². Вид на Город наук.",
    "images": ["https://<backend-host>/static/properties/A019_image.jpg"]
  },
  {
    "id": "A020",
    "operation": "sale",
    "property_type": "apartment",
    "furnished": true,
    "price": { "amount": 330000, "currency": "EUR" },
    "price_per_m2": 3474,
    "location": { "country": "ES", "city": "Valencia", "district": "Benicalap", "neighborhood": "Benicalap", "address": null },
    "building": { "year": 2020, "floors": 12, "infrastructure": ["gym", "kids_room", "concierge"] },
    "specs": { "rooms": 3, "bathrooms": null, "area_m2": 95, "floor": 7, "balcony": false, "terrace": false },
    "title": null,
    "description": "3 спальни, 95 м², 7/12, мебель + встроенная техника. Спортзал, детская, консьерж.",
    "images": ["https://<backend-host>/static/properties/A020_image.jpg"]
  }
];

// Преобразование в плоскую структуру (совместимость с текущими маршрутами и контроллерами)
const properties = rawProperties.map((p) => {
  const city = p?.location?.city ?? null;
  const district = p?.location?.district ?? null;
  const neighborhood = p?.location?.neighborhood ?? null;
  const address = p?.location?.address ?? null;

  const rooms = p?.specs?.rooms ?? null;
  const bathrooms = p?.specs?.bathrooms ?? null;
  const area_m2 = p?.specs?.area_m2 ?? null;
  const floor = p?.specs?.floor ?? null;
  const balcony = p?.specs?.balcony ?? null;
  const terrace = p?.specs?.terrace ?? null;

  const year = p?.building?.year ?? null;
  const floors = p?.building?.floors ?? null;
  const infrastructure = Array.isArray(p?.building?.infrastructure) ? p.building.infrastructure : [];

  const priceEUR = p?.price?.amount ?? null;
  const currency = p?.price?.currency ?? 'EUR';

  const price_per_m2 = p?.price_per_m2 ?? (priceEUR && area_m2 ? Math.round(priceEUR / area_m2) : null);

  return {
    // Все оригинальные поля из новой базы
    ...p,

    // Идентификаторы
    id: p.id,

    // Совместимость с текущим кодом (audioController, cardRoute)
    type: p.property_type ?? null,
    operation: p.operation ?? null,
    furnished: p.furnished ?? null,

    // Плоские поля для фильтрации/рендеринга
    city,
    district,
    neighborhood,
    address,
    rooms,
    bathrooms,
    area_m2,
    floor,
    balcony,
    terrace,
    year,
    floors,
    infrastructure,
    priceEUR,
    currency,
    price_per_m2,

    // Описание/медиа
    title: p.title ?? null,
    description: p.description ?? null,
    images: Array.isArray(p.images) ? p.images : [],

    // Оставляем исходные вложенные объекты (явно, на случай отсутствия в ...p)
    location: p.location ?? null,
    building: p.building ?? null,
    specs: p.specs ?? null,
    price: p.price ?? null
  };
});

export { properties };
export default properties;

