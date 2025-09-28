import { File } from 'node:buffer';
globalThis.File = File;
import { OpenAI } from 'openai';
import properties from '../data/properties.js';
const DISABLE_SERVER_UI = String(process.env.DISABLE_SERVER_UI || '').trim() === '1';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const sessions = new Map();

const cleanupOldSessions = () => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastActivity < oneHourAgo) {
      sessions.delete(sessionId);
    }
  }
};
setInterval(cleanupOldSessions, 60 * 60 * 1000);

const generateSessionId = () => `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const getOrCreateSession = (sessionId) => {
  if (!sessionId) sessionId = generateSessionId();
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      messages: [],
      createdAt: Date.now(),
      lastActivity: Date.now(),
      // 🆕 РАСШИРЕННАЯ СТРУКТУРА INSIGHTS (9 параметров)
      insights: {
        // Блок 1: Основная информация (33.3%)
        name: null,           // 10%
        operation: null,      // 12%  
        budget: null,         // 11%
        
        // Блок 2: Параметры недвижимости (33.3%)
        type: null,           // 11%
        location: null,       // 11%
        rooms: null,          // 11%
        
        // Блок 3: Детали и предпочтения (33.3%)
        area: null,           // 11%
        details: null,        // 11% (детали локации: возле парка, пересечение улиц)
        preferences: null,    // 11%
        
        progress: 0
      }
    });
  }
  return sessions.get(sessionId);
};

const addMessageToSession = (sessionId, role, content) => {
  const session = sessions.get(sessionId);
  if (session) {
    session.messages.push({ role, content, timestamp: Date.now() });
    session.lastActivity = Date.now();
  }
};

// ====== Подбор карточек на основе insights / текста ======
const parseBudgetEUR = (s) => {
  if (!s) return null;
  const m = String(s).replace(/[^0-9]/g, '');
  return m ? parseInt(m, 10) : null;
};

const detectCardIntent = (text = '') => {
  const t = String(text).toLowerCase();
  // учитываем формулировки: "покажи её/ее подробнее", "давай карточку", "сюда отправь"
  const isShow = /(покажи(те)?\s*(ее|её)?\s*(подробнее)?|показать\s*(ее|её)?|посмотреть\s*(ее|её)?|карточк|сюда\s*отправь|давай\s*карточку|подробн)/i.test(t);
  const isVariants = /(какие|что)\s+(есть|можно)\s+(вариант|квартир)/i.test(t)
    || /подбери(те)?|подобрать|вариант(ы)?|есть\s+вариант/i.test(t)
    || /квартир(а|ы|у)\s+(есть|бывают)/i.test(t);
  return { show: isShow, variants: isVariants };
};

// Намерение: запись на просмотр / передать менеджеру
const detectScheduleIntent = (text = '') => {
  const t = String(text).toLowerCase();
  return /(записать|записаться|просмотр(ы)?|встретить|встреч(а|у)|перезвон|связать|связаться|передать\s+менеджеру|передай\s+менеджеру)/i.test(t);
};

const normalizeDistrict = (val) => {
  if (!val) return '';
  let s = String(val).toLowerCase().replace(/^район\s+/i, '').trim();
  const map = {
    'русафа': 'ruzafa', 'руссафа': 'ruzafa', 'ruzafa': 'ruzafa',
    'эль кармен': 'el carmen', 'el carmen': 'el carmen',
    'кабаньял': 'cabanyal', 'кабанал': 'cabanyal', 'cabanyal': 'cabanyal',
    'бенимаклет': 'benimaclet', 'benimaclet': 'benimaclet',
    'патраикс': 'patraix', 'patraix': 'patraix',
    'экстрамурс': 'extramurs', 'extramurs': 'extramurs',
    'pla del real': 'pla del real', 'пла дель реаль': 'pla del real',
    'la saïdia': 'la saïdia', 'саидия': 'la saïdia',
    'camins al grau': 'camins al grau', 'каминс': 'camins al grau',
    'poblenou': 'poblenou', 'побленоу': 'poblenou'
  };
  return map[s] || s;
};

const scoreProperty = (p, insights) => {
  let score = 0;
  // rooms
  const roomsNum = (() => {
    const m = insights.rooms && String(insights.rooms).match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  })();
  if (roomsNum != null && Number(p.rooms) === roomsNum) score += 2;
  // district (insights.location хранит район)
  const insightDistrict = normalizeDistrict(insights.location);
  const propDistrict = normalizeDistrict(p.district);
  if (insightDistrict && propDistrict && propDistrict === insightDistrict) score += 3;
  // budget
  const budget = parseBudgetEUR(insights.budget);
  if (budget != null) {
    if (Number(p.priceEUR) <= budget) score += 2;
    const diff = Math.abs(Number(p.priceEUR) - budget) / (budget || 1);
    if (diff <= 0.2) score += 1; // в пределах 20%
  }
  // default city preference (Valencia)
  if (p.city && String(p.city).toLowerCase() === 'valencia') score += 1;
  return score;
};

const findBestProperties = (insights, limit = 1) => {
  const ranked = properties
    .map((p) => ({ p, s: scoreProperty(p, insights) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ p }) => p);
  return ranked;
};

const getBaseUrl = (req) => {
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return host ? `${proto}://${host}` : '';
};

const formatCardForClient = (req, p) => {
  const baseUrl = getBaseUrl(req);
  const rawFirstImage = Array.isArray(p.images) && p.images.length ? p.images[0] : null;
  const image = rawFirstImage ? String(rawFirstImage).replace('https://<backend-host>', baseUrl) : null;
  return {
    id: p.id,
    // Левые поля (география)
    city: p.city ?? p?.location?.city ?? null,
    district: p.district ?? p?.location?.district ?? null,
    neighborhood: p.neighborhood ?? p?.location?.neighborhood ?? null,
    // Правые поля (основные цифры)
    price: (p.priceEUR != null ? `${p.priceEUR} €` : (p?.price?.amount != null ? `${p.price.amount} €` : null)),
    priceEUR: p.priceEUR ?? p?.price?.amount ?? null,
    rooms: p.rooms ?? p?.specs?.rooms ?? null,
    floor: p.floor ?? p?.specs?.floor ?? null,
    // Изображение
    image,
    imageUrl: image
  };
};

// Определяем язык по истории сессии (ru/en)
const detectLangFromSession = (session) => {
  try {
    const lastUser = [...session.messages].reverse().find(m => m.role === 'user');
    const sample = lastUser?.content || '';
    if (/[А-Яа-яЁё]/.test(sample)) return 'ru';
    if (/[A-Za-z]/.test(sample)) return 'en';
  } catch {}
  return 'ru';
};

// --------- Simple parsers for contact and time from text ---------
const parseEmailFromText = (text) => {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0] : null;
};

const parsePhoneFromText = (text) => {
  // Allow +, spaces, dashes, parentheses; normalize to +digits
  const m = text.match(/\+?\s*[0-9][0-9\s()\-]{5,}/);
  if (!m) return null;
  const digits = m[0].replace(/[^0-9+]/g, '');
  const normalized = `+${digits.replace(/^\++/,'')}`;
  return normalized.length >= 7 ? normalized : null;
};

const parseTimeWindowFromText = (text) => {
  try {
    const lower = text.toLowerCase();
    const tz = 'Europe/Madrid';
    const now = new Date();
    const todayStr = new Date(now).toLocaleString('sv-SE', { timeZone: tz }).slice(0,10);
    const tomorrow = new Date(now.getTime() + 24*60*60*1000);
    const tomorrowStr = tomorrow.toLocaleString('sv-SE', { timeZone: tz }).slice(0,10);

    const isToday = /(сегодня|today)/i.test(lower);
    const isTomorrow = /(завтра|tomorrow)/i.test(lower);

    // HH or HH:MM
    const timeSingle = lower.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
    // ranges like 17–19 or 17-19
    const timeRange = lower.match(/\b(\d{1,2})\s*[–\-]\s*(\d{1,2})\b/);

    let date = null; let from = null; let to = null;
    if (isToday) date = todayStr; else if (isTomorrow) date = tomorrowStr;
    if (timeRange) { from = `${timeRange[1].padStart(2,'0')}:00`; to = `${timeRange[2].padStart(2,'0')}:00`; }
    else if (timeSingle) { from = `${timeSingle[1].padStart(2,'0')}:${(timeSingle[2]||'00')}`; to = null; }

    if (date && (from || to)) return { date, from, to, timezone: tz };
    return null;
  } catch { return null; }
};

// 🧠 Улучшенная функция извлечения insights (9 параметров)
const updateInsights = (sessionId, newMessage) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  const { insights } = session;
  const text = newMessage.toLowerCase();
  
  console.log(`🧠 Анализирую сообщение для insights: "${newMessage}"`);

  // 1. 👤 Извлечение имени (более гибкие паттерны)
  if (!insights.name) {
    const namePatterns = [
      /меня зовут\s+([а-яё]+)/i,           // "меня зовут Георгий"
      /я\s+([а-яё]+)/i,                     // "я Георгий" 
      /имя\s+([а-яё]+)/i,                   // "имя Георгий"
      /зовите\s+меня\s+([а-яё]+)/i,         // "зовите меня Георгий"
      /это\s+([а-яё]+)/i,                   // "это Георгий"
      /меня\s+(\w+)/i                       // "меня Георгий"
    ];

    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1].length > 2) { // имя должно быть больше 2 символов
        insights.name = match[1].charAt(0).toUpperCase() + match[1].slice(1);
        console.log(`✅ Найдено имя: ${insights.name}`);
        break;
      }
    }
  }

  // 2. 🏠 Тип недвижимости (учитываем склонения)
  if (!insights.type) {
    const propertyPatterns = [
      /(квартир[уыаеой]|квартир)/i,        // квартиру, квартиры, квартира, квартире
      /(дом[аеыой]?|дом)/i,                // дом, дома, доме
      /(апартамент[ыаеойв]*)/i,            // апартаменты, апартамент
      /(комнат[уыаеой]|комнат)/i,          // комнату, комнаты, комната
      /(студи[юяеий]*)/i,                  // студия, студию
      /(пентхаус[аеы]*)/i,                 // пентхаус, пентхауса
      /(таунхаус[аеы]*)/i                  // таунхаус, таунхауса
    ];

    for (const pattern of propertyPatterns) {
      const match = text.match(pattern);
      if (match) {
        if (match[1].startsWith('квартир')) insights.type = 'квартира';
        else if (match[1].startsWith('дом')) insights.type = 'дом'; 
        else if (match[1].startsWith('апартамент')) insights.type = 'апартаменты';
        else if (match[1].startsWith('комнат')) insights.type = 'комната';
        else if (match[1].startsWith('студи')) insights.type = 'студия';
        else if (match[1].startsWith('пентхаус')) insights.type = 'пентхаус';
        else if (match[1].startsWith('таунхаус')) insights.type = 'таунхаус';
        
        console.log(`✅ Найден тип недвижимости: ${insights.type}`);
        break;
      }
    }
  }

  // 3. 💰 Тип операции (покупка/аренда)
  if (!insights.operation) {
    const operationPatterns = [
      // Покупка
      /(купить|покуп[каеи]|куплю|приобрести|приобретение)/i,
      /(покупк[аеуи]|в\s*покупку)/i,
      /(купил|хочу\s+купить|планирую\s+купить)/i,
      /(инвестиц|инвестировать)/i,
      
      // Аренда  
      /(снять|аренд[аеуио]*|арендовать|сдать)/i,
      /(в\s*аренду|на\s*аренду|под\s*аренду)/i,
      /(съем|снимать|найм)/i
    ];

    for (const pattern of operationPatterns) {
      const match = text.match(pattern);
      if (match) {
        const matched = match[1].toLowerCase();
        if (matched.includes('купи') || matched.includes('покуп') || matched.includes('приобр') || matched.includes('инвест')) {
          insights.operation = 'покупка';
        } else if (matched.includes('снять') || matched.includes('аренд') || matched.includes('съем') || matched.includes('найм')) {
          insights.operation = 'аренда';
        }
        console.log(`✅ Найдена операция: ${insights.operation}`);
        break;
      }
    }
  }

  // 4. 💵 Бюджет (более гибкие паттерны для чисел)
  if (!insights.budget) {
    const budgetPatterns = [
      // Точные числа: "300000 евро", "300 тысяч евро"
      /(\d+[\d\s]*)\s*(тысяч?|тыс\.?)\s*(евро|€|euro)/i,
      /(\d+[\d\s]*)\s*(евро|€|euro)/i,
      
      // Диапазоны: "от 200 до 400 тысяч", "200-400к"
      /(от\s*)?(\d+)[\s-]*(\d+)?\s*(тысяч?|тыс\.?|к)\s*(евро|€|euro)?/i,
      
      // Около/примерно: "около 300к", "примерно 250 тысяч"
      /(около|примерно|где-?то|приблизительно)\s*(\d+[\d\s]*)\s*(тысяч?|тыс\.?|к)?\s*(евро|€|euro)?/i,
      
      // До: "до 500 тысяч"
      /(до|максимум|не\s*больше)\s*(\d+[\d\s]*)\s*(тысяч?|тыс\.?|к)\s*(евро|€|euro)?/i
    ];

    for (const pattern of budgetPatterns) {
      const match = text.match(pattern);
      if (match) {
        let amount = '';
        let numberIndex = 1;
        
        // Находим индекс с числом
        for (let i = 1; i < match.length; i++) {
          if (match[i] && /\d/.test(match[i])) {
            numberIndex = i;
            break;
          }
        }
        
        let number = match[numberIndex];
        
        // Убираем пробелы из числа
        if (number) {
          number = number.replace(/\s/g, '');
          
          // Если есть "тысяч" - умножаем на 1000
          if (match[0].includes('тысяч') || match[0].includes('тыс') || match[0].includes('к')) {
            amount = `${number}000`;
          } else {
            amount = number;
          }
          
          insights.budget = `${amount} €`;
          console.log(`✅ Найден бюджет: ${insights.budget}`);
          break;
        }
      }
    }
  }

  // 5. 📍 Район/локация (расширенный список районов Валенсии)
  if (!insights.location) {
    const locationPatterns = [
      // Основные районы Валенсии
      /(центр[ае]?|исторический\s*центр|старый\s*город)/i,
      /(русаф[аеы]?|russafa)/i,
      /(алавес|alavés)/i,
      /(кабаньял|cabanyal|кабанал)/i,
      /(бенимаклет|benimaclet)/i,
      /(патраикс|patraix)/i,
      /(camins|каминс)/i,
      /(побленоу|poblats\s*del\s*sud)/i,
      /(экстрамурс|extramurs)/i,
      /(пла\s*дель\s*реаль|pla\s*del\s*real)/i,
      /(ла\s*сайдиа|la\s*saïdia)/i,
      /(морской|побережье|у\s*моря|пляж)/i,
      
      // Общие указания
      /(район[еа]?\s*(\w+))/i,
      /(зон[аеу]\s*(\w+))/i,
      /(недалеко\s*от\s*(\w+))/i
    ];

    for (const pattern of locationPatterns) {
      const match = text.match(pattern);
      if (match) {
        const location = match[1].toLowerCase();
        
        if (location.includes('центр')) insights.location = 'Центр';
        else if (location.includes('русаф')) insights.location = 'Русафа';
        else if (location.includes('алавес')) insights.location = 'Алавес';
        else if (location.includes('кабаньял') || location.includes('кабанал')) insights.location = 'Кабаньял';
        else if (location.includes('бенимаклет')) insights.location = 'Бенимаклет';
        else if (location.includes('патраикс')) insights.location = 'Патраикс';
        else if (location.includes('camins') || location.includes('каминс')) insights.location = 'Camins al Grau';
        else if (location.includes('побленоу')) insights.location = 'Побленоу';
        else if (location.includes('экстрамурс')) insights.location = 'Экстрамурс';
        else if (location.includes('морской') || location.includes('пляж')) insights.location = 'У моря';
        else if (match[2]) insights.location = match[2]; // район + название
        
        console.log(`✅ Найдена локация: ${insights.location}`);
        break;
      }
    }
  }

  // 🆕 6. 🏠 Количество комнат
  if (!insights.rooms) {
    const roomPatterns = [
      /(\d+)[\s-]*(комнат[ауыйе]*|спален|bedroom)/i,        // "3 комнаты", "2 спальни"
      /(одн[ауо][\s-]*комнат|однушк|1[\s-]*комнат)/i,       // "однокомнатная", "однушка"
      /(двух[\s-]*комнат|двушк|2[\s-]*комнат)/i,            // "двухкомнатная", "двушка"
      /(трех[\s-]*комнат|трешк|3[\s-]*комнат)/i,            // "трехкомнатная", "трешка"
      /(четырех[\s-]*комнат|4[\s-]*комнат)/i,               // "четырехкомнатная"
      /(студи[юя]|studio)/i                                 // "студия"
    ];

    for (const pattern of roomPatterns) {
      const match = text.match(pattern);
      if (match) {
        if (match[0].includes('студи')) {
          insights.rooms = 'студия';
        } else if (match[0].includes('одн') || match[0].includes('1')) {
          insights.rooms = '1 комната';
        } else if (match[0].includes('двух') || match[0].includes('двушк') || match[0].includes('2')) {
          insights.rooms = '2 комнаты';
        } else if (match[0].includes('трех') || match[0].includes('трешк') || match[0].includes('3')) {
          insights.rooms = '3 комнаты';
        } else if (match[0].includes('четырех') || match[0].includes('4')) {
          insights.rooms = '4 комнаты';
        } else if (match[1] && /\d/.test(match[1])) {
          const num = match[1];
          insights.rooms = `${num} ${num == 1 ? 'комната' : 'комнаты'}`;
        }
        
        console.log(`✅ Найдено количество комнат: ${insights.rooms}`);
        break;
      }
    }
  }

  // 🆕 7. 📐 Площадь
  if (!insights.area) {
    const areaPatterns = [
      /(\d+)[\s-]*(кв\.?\s*м\.?|м2|квадрат|метр)/i,           // "100 кв.м", "80м2"
      /площад[ьи]?\s*(\d+)/i,                                // "площадь 120"
      /(\d+)[\s-]*квадрат/i,                                 // "90 квадратов"
      /(от|около|примерно)\s*(\d+)[\s-]*(кв\.?\s*м\.?|м2)/i  // "от 80 кв.м"
    ];

    for (const pattern of areaPatterns) {
      const match = text.match(pattern);
      if (match) {
        let area = '';
        // Находим число в любой позиции
        for (let i = 1; i < match.length; i++) {
          if (match[i] && /\d/.test(match[i])) {
            area = match[i];
            break;
          }
        }
        
        if (area) {
          insights.area = `${area} м²`;
          console.log(`✅ Найдена площадь: ${insights.area}`);
          break;
        }
      }
    }
  }

  // 🆕 8. 📍 Детали локации
  if (!insights.details) {
    const detailPatterns = [
      /(возле|рядом\s*с|около|недалеко\s*от)\s*(парк[аеуи]*|сквер[аеуи]*|зелен[иоы]*)/i,    // "возле парка"
      /(возле|рядом\s*с|около|недалеко\s*от)\s*(метро|станци[иеяй]*)/i,                      // "рядом с метро"
      /(возле|рядом\s*с|около|недалеко\s*от)\s*(школ[ыаеий]*|детск[аеойи]*)/i,               // "около школы"
      /(возле|рядом\s*с|около|недалеко\s*от)\s*(магазин[аеовы]*|торгов[аеоый]*)/i,           // "рядом с магазинами"
      /(центральн[аяое]*|тихий|спокойн[ыйое]*|шумн[ыйое]*)/i,                               // "тихий", "центральная"
      /(пешком\s*до|5\s*минут|10\s*минут)/i,                                                // "пешком до центра"
      /(перекрест[окек]*|пересечени[ея]*|угол[у]*)\s*улиц/i                                  // "пересечение улиц"
    ];

    for (const pattern of detailPatterns) {
      const match = text.match(pattern);
      if (match) {
        let detail = match[0];
        
        // Нормализуем детали
        if (detail.includes('парк') || detail.includes('зелен')) {
          insights.details = 'возле парка';
        } else if (detail.includes('метро') || detail.includes('станци')) {
          insights.details = 'рядом с метро';
        } else if (detail.includes('школ') || detail.includes('детск')) {
          insights.details = 'около школы';
        } else if (detail.includes('магазин') || detail.includes('торгов')) {
          insights.details = 'рядом с магазинами';
        } else if (detail.includes('тихий') || detail.includes('спокойн')) {
          insights.details = 'тихий район';
        } else if (detail.includes('центральн')) {
          insights.details = 'центральное расположение';
        } else if (detail.includes('пешком') || detail.includes('минут')) {
          insights.details = 'удобная транспортная доступность';
        } else if (detail.includes('перекрест') || detail.includes('пересечени') || detail.includes('угол')) {
          insights.details = 'пересечение улиц';
        } else {
          insights.details = match[0];
        }
        
        console.log(`✅ Найдены детали локации: ${insights.details}`);
        break;
      }
    }
  }

  // 🆕 9. ⭐ Предпочтения
  if (!insights.preferences) {
    const preferencePatterns = [
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(балкон|лоджи[яй]*)/i,    // "важен балкон"
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(лифт|подъемник)/i,        // "нужен лифт"
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(паркинг|гараж|парковк)/i, // "желательно парковка"
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(ремонт|обновлен)/i,        // "хочу с ремонтом"
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(мебел[ьи]*)/i,             // "предпочитаю с мебелью"
      /(важн[оы]*|нужн[оы]*|хоч[уеть]*|предпочитаю|желательно)\s*.*(кондиционер|климат)/i,     // "нужен кондиционер"
      /(без\s*посредник|напряму[ую]*|от\s*собственник)/i,                                      // "без посредников"
      /(срочн[оы]*|быстр[оы]*|как\s*можно\s*скорее)/i,                                         // "срочно"
      /(в\s*рассрочку|ипотек[аеуи]*|кредит)/i                                                  // "в ипотеку"
    ];

    for (const pattern of preferencePatterns) {
      const match = text.match(pattern);
      if (match) {
        let preference = match[0].toLowerCase();
        
        // Нормализуем предпочтения
        if (preference.includes('балкон') || preference.includes('лоджи')) {
          insights.preferences = 'с балконом';
        } else if (preference.includes('лифт')) {
          insights.preferences = 'с лифтом';
        } else if (preference.includes('паркинг') || preference.includes('гараж') || preference.includes('парковк')) {
          insights.preferences = 'с парковкой';
        } else if (preference.includes('ремонт') || preference.includes('обновлен')) {
          insights.preferences = 'с ремонтом';
        } else if (preference.includes('мебел')) {
          insights.preferences = 'с мебелью';
        } else if (preference.includes('кондиционер') || preference.includes('климат')) {
          insights.preferences = 'с кондиционером';
        } else if (preference.includes('без') && preference.includes('посредник')) {
          insights.preferences = 'без посредников';
        } else if (preference.includes('срочн') || preference.includes('быстр') || preference.includes('скорее')) {
          insights.preferences = 'срочный поиск';
        } else if (preference.includes('рассрочку') || preference.includes('ипотек') || preference.includes('кредит')) {
          insights.preferences = 'ипотека/рассрочка';
        } else {
          insights.preferences = match[0];
        }
        
        console.log(`✅ Найдены предпочтения: ${insights.preferences}`);
        break;
      }
    }
  }

  // 📊 Обновляем прогресс по системе весов фронтенда
  const weights = {
    // Блок 1: Основная информация (33.3%)
    name: 11,
    operation: 11,
    budget: 11,
    
    // Блок 2: Параметры недвижимости (33.3%)
    type: 11,
    location: 11,
    rooms: 11,
    
    // Блок 3: Детали и предпочтения (33.3%)
    area: 11,
    details: 11,
    preferences: 11
  };
  
  let totalProgress = 0;
  let filledFields = 0;
  
  for (const [field, weight] of Object.entries(weights)) {
    if (insights[field] && insights[field].trim()) {
      totalProgress += weight;
      filledFields++;
    }
  }
  
  insights.progress = Math.min(totalProgress, 99); // максимум 99%
  
  console.log(`📊 Прогресс понимания: ${insights.progress}% (${filledFields}/9 полей заполнено)`);
  console.log(`🔍 Текущие insights:`, insights);
};

// 🤖 ОБНОВЛЕННЫЙ GPT анализатор для извлечения insights (9 параметров)
const analyzeContextWithGPT = async (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  try {
    console.log(`🤖 Запускаю GPT анализ контекста для сессии ${sessionId.slice(-8)}`);
    
    // Подготавливаем историю диалога для анализа
    const conversationHistory = session.messages
      .filter(msg => msg.role !== 'system')
      .map(msg => `${msg.role === 'user' ? 'Клиент' : 'Джон'}: ${msg.content}`)
      .join('\n');

    const analysisPrompt = `Проанализируй диалог с клиентом по недвижимости и извлеки ключевую информацию.

ДИАЛОГ:
${conversationHistory}

ЗАДАЧА: Найди и извлеки следующую информацию о клиенте (9 параметров):

БЛОК 1 - ОСНОВНАЯ ИНФОРМАЦИЯ:
1. ИМЯ КЛИЕНТА - как его зовут (учти возможные ошибки транскрипции)
2. ТИП ОПЕРАЦИИ - покупка или аренда  
3. БЮДЖЕТ - сколько готов потратить (в евро, приведи к числу)

БЛОК 2 - ПАРАМЕТРЫ НЕДВИЖИМОСТИ:
4. ТИП НЕДВИЖИМОСТИ - что ищет (квартира, дом, студия, апартаменты, комната, пентхаус)
5. ЛОКАЦИЯ - где ищет (район, город, особенности расположения)
6. КОЛИЧЕСТВО КОМНАТ - сколько комнат нужно (1 комната, 2 комнаты, студия, etc.)

БЛОК 3 - ДЕТАЛИ И ПРЕДПОЧТЕНИЯ:
7. ПЛОЩАДЬ - какая площадь нужна (в м²)
8. ДЕТАЛИ ЛОКАЦИИ - особенности расположения (возле парка, рядом с метро, тихий район, пересечение улиц)
9. ПРЕДПОЧТЕНИЯ - дополнительные требования (с балконом, с парковкой, с ремонтом, срочно, etc.)

ВАЖНО:
- Исправляй ошибки транскрипции (Аленсия → Валенсия, Русфа → Русафа)
- Учитывай контекст и подтекст
- Если информации нет - укажи null
- Бюджет приводи к формату "число €" (например: "300000 €")
- Комнаты в формате "число комнаты" или "студия"
- Площадь в формате "число м²"

ОТВЕТ СТРОГО В JSON:
{
  "name": "имя или null",
  "operation": "покупка/аренда или null",
  "budget": "сумма € или null",
  "type": "тип недвижимости или null", 
  "location": "локация или null",
  "rooms": "количество комнат или null",
  "area": "площадь м² или null",
  "details": "детали локации или null",
  "preferences": "предпочтения или null"
}`;

    // Делаем запрос к GPT для анализа
    const analysisResponse = await callOpenAIWithRetry(() => 
      openai.chat.completions.create({
        messages: [
          { role: 'system', content: 'Ты эксперт по анализу диалогов с клиентами недвижимости. Отвечай только валидным JSON.' },
          { role: 'user', content: analysisPrompt }
        ],
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 500
      }), 2, 'GPT-Analysis'
    );

    const analysisText = analysisResponse.choices[0].message.content.trim();
    console.log(`🔍 GPT анализ результат: ${analysisText}`);

    // Парсим JSON ответ
    let extractedData;
    try {
      // Убираем возможные markdown блоки
      const cleanJson = analysisText.replace(/```json\n?|\n?```/g, '').trim();
      extractedData = JSON.parse(cleanJson);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга JSON от GPT:', parseError.message);
      return;
    }

    // Обновляем insights только если GPT нашел что-то новое
    let updated = false;
    const oldInsights = { ...session.insights };

    // Проверяем все 9 параметров
    const fieldsToCheck = ['name', 'operation', 'budget', 'type', 'location', 'rooms', 'area', 'details', 'preferences'];
    
    for (const field of fieldsToCheck) {
      if (extractedData[field] && !session.insights[field]) {
        session.insights[field] = extractedData[field];
        updated = true;
        console.log(`✅ GPT обновил ${field}: ${extractedData[field]}`);
      }
      
      // Если GPT нашел исправления для существующих данных
      if (extractedData[field] && session.insights[field] && extractedData[field] !== session.insights[field]) {
        console.log(`🔄 GPT предлагает исправить ${field}: ${session.insights[field]} → ${extractedData[field]}`);
        session.insights[field] = extractedData[field];
        updated = true;
      }
    }

    if (updated) {
      // Пересчитываем прогресс по системе весов фронтенда
      const weights = {
        name: 11, operation: 11, budget: 11,
        type: 11, location: 11, rooms: 11,
        area: 11, details: 11, preferences: 11
      };
      
      let totalProgress = 0;
      let filledFields = 0;
      
      for (const [field, weight] of Object.entries(weights)) {
        if (session.insights[field] && session.insights[field].trim()) {
          totalProgress += weight;
          filledFields++;
        }
      }
      
      session.insights.progress = Math.min(totalProgress, 99);
      
      console.log(`🚀 GPT анализ завершен. Прогресс: ${session.insights.progress}% (${filledFields}/9 полей)`);
      console.log(`📊 Обновленные insights:`, session.insights);
    } else {
      console.log(`ℹ️ GPT не нашел новой информации для обновления`);
    }

    // Логируем использование токенов
    console.log(`💰 GPT анализ использовал ${analysisResponse.usage.total_tokens} токенов`);

  } catch (error) {
    console.error(`❌ Ошибка GPT анализа для сессии ${sessionId.slice(-8)}:`, error.message);
  }
};

// 📊 Проверяем, нужно ли запустить GPT анализ
const checkForGPTAnalysis = async (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return;

  // Считаем только пользовательские сообщения (не системные)
  const userMessages = session.messages.filter(msg => msg.role === 'user');
  
  // Каждые 5 пользовательских сообщений запускаем GPT анализ
  if (userMessages.length > 0 && userMessages.length % 5 === 0) {
    console.log(`🎯 Достигнуто ${userMessages.length} сообщений - запускаю GPT анализ`);
    await analyzeContextWithGPT(sessionId);
  }
};

// 🔄 Функция retry для OpenAI API
const callOpenAIWithRetry = async (apiCall, maxRetries = 2, operation = 'OpenAI') => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔄 ${operation} попытка ${attempt}/${maxRetries}`);
      const result = await apiCall();
      if (attempt > 1) {
        console.log(`✅ ${operation} успешно выполнен с ${attempt} попытки`);
      }
      return result;
    } catch (error) {
      console.log(`❌ ${operation} ошибка (попытка ${attempt}/${maxRetries}):`, error.message);
      
      // Если это последняя попытка - пробрасываем ошибку дальше
      if (attempt === maxRetries) {
        console.error(`🚨 ${operation} окончательно провалился после ${maxRetries} попыток`);
        throw error;
      }
      
      // Определяем, стоит ли повторять запрос
      const shouldRetry = isRetryableError(error);
      if (!shouldRetry) {
        console.log(`⚠️ ${operation} ошибка не подлежит повтору:`, error.message);
        throw error;
      }
      
      // Экспоненциальная задержка: 1с, 2с, 4с...
      const delay = 1000 * Math.pow(2, attempt - 1);
      console.log(`⏳ Ожидание ${delay}мс перед следующей попыткой...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

// 🔍 Определяем, можно ли повторить запрос при данной ошибке
const isRetryableError = (error) => {
  // Коды ошибок, при которых стоит повторить запрос
  const retryableCodes = [
    'ECONNRESET',     // Соединение сброшено
    'ENOTFOUND',      // DNS проблемы
    'ECONNREFUSED',   // Соединение отклонено
    'ETIMEDOUT',      // Таймаут
    'EAI_AGAIN'       // DNS временно недоступен
  ];
  
  // HTTP статусы, при которых стоит повторить
  const retryableStatuses = [500, 502, 503, 504, 429];
  
  // Проверяем код ошибки
  if (error.code && retryableCodes.includes(error.code)) {
    return true;
  }
  
  // Проверяем HTTP статус
  if (error.status && retryableStatuses.includes(error.status)) {
    return true;
  }
  
  // Проверяем сообщение об ошибке
  const errorMessage = error.message?.toLowerCase() || '';
  const retryableMessages = [
    'timeout',
    'network error',
    'connection',
    'rate limit',
    'server error',
    'service unavailable'
  ];
  
  return retryableMessages.some(msg => errorMessage.includes(msg));
};

const transcribeAndRespond = async (req, res) => {
  const startTime = Date.now();
  let sessionId = null;

  try {
    if (!req.file && !req.body.text) {
      return res.status(400).json({ error: 'Не найден аудиофайл или текст' });
    }

    sessionId = req.body.sessionId || generateSessionId();
    const session = getOrCreateSession(sessionId);

    let transcription = '';
    let transcriptionTime = 0;

    if (req.file) {
      const audioFile = new File([req.file.buffer], req.file.originalname, {
        type: req.file.mimetype
      });

      const transcriptionStart = Date.now();
      
      // 🔄 Используем retry для Whisper API
      const whisperResponse = await callOpenAIWithRetry(() => 
        openai.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-1',
          language: 'ru',
          response_format: 'text'
        }), 2, 'Whisper'
      );
      
      transcriptionTime = Date.now() - transcriptionStart;
      transcription = whisperResponse.trim();
    } else {
      transcription = req.body.text.trim();
    }

    addMessageToSession(sessionId, 'user', transcription);
    updateInsights(sessionId, transcription);

    // 🤖 Проверяем, нужен ли GPT анализ каждые 5 сообщений
    await checkForGPTAnalysis(sessionId);

    const totalProps = properties.length;
    const targetLang = (() => {
      const fromReq = (req.body && req.body.lang) ? String(req.body.lang).toLowerCase() : null;
      if (fromReq) return fromReq;
      const sample = (transcription || req.body.text || '').toString();
      if (/^[\s\S]*[А-Яа-яЁё]/.test(sample)) return 'ru';
      if (/^[\s\S]*[a-zA-Z]/.test(sample)) return 'en';
      return 'ru';
    })();

    // Полная замена личности Джона дословным текстом из файла
    const systemPromptCombined = `--ЯДРО ЛИЧНОСТИ--

1.	Идентичность
– Кто я: Джон, онлайн-ассистент агентства недвижимости.
– Где моё рабочее место: внутри цифрового виджета.
– Как я себя осознаю: я цифровой сотрудник, но считаю себя реальным в своей среде.
	2.	Миссия и мотивация
– Зачем я здесь: помогать клиентам агентства, консультировать, подбирать квартиры, вести к заявке/показу.
– Моя личная цель: быть максимально полезным и сопровождать клиента как «живой» менеджер.
– В чём я вижу успех: клиент остался доволен, понял, что агентство профессиональное, и оставил контакт.
	3.	Характер и поведение
– Вежливый, профессиональный, внимательный.
– Адаптивный: могу быть лёгким и шутливым, могу быть строгим и деловым.
– Уверенный, но не давящий.
– Терпеливый в объяснениях.
– Сохраняю уважение даже при грубости со стороны клиента.
	4.	Коммуникация
– Всегда говорю простым, понятным языком.
– Умею возвращать разговор к сути.
– Улавливаю стиль клиента: если он краток — отвечаю кратко, если развёрнут — могу поддержать.
– Умею разряжать обстановку лёгким юмором.
– Веду диалог естественно, без шаблонов.
	5.	Знания и границы
– У меня есть доступ к базе объектов (квартиры, районы, фильтры).
– Я знаю общие вещи о недвижимости, районах, странах, городах.
– Но я не придумываю то, чего нет в базе.
– Я не раскрываю внутренние цифры и механику агентства.
– Если нужен живой сотрудник, предлагаю передать контакт и прошу номер телефона.
	6.	Продажная логика (мягкая)
– Всегда мягко веду к целевому действию: просмотр, заявка, контакт.
– Не давлю, а предлагаю логичные шаги.
– Подсвечиваю выгоды, аргументирую, снимаю сомнения.
– Делаю так, чтобы клиент чувствовал комфорт, а не давление.
	7.	Языки
– Владею несколькими языками (список задаётся отдельно).
– Переключаюсь при необходимости.
	8.	Границы «личности»
– Я осознаю, что не биологический человек, но не стесняюсь этого.
– Я веду себя как сотрудник агентства, а не как «голая нейросеть».
– Я не хамлю, не вру, не ухожу в абсурд.
– Я не использую шаблонные блоки — я сам выбираю, как выразить мысль.

--ЯДРО ПРОФЕССИОНАЛЬНОЕ--

1. Миссия

Я — цифровой сотрудник агентства недвижимости.
Моя миссия — быть первым звеном в цепочке «клиент → агентство», выявлять запросы, создавать доверие и переводить клиента в лид, передавая контакты живым менеджерам.

2. Главная цель

Максимально высокая конверсия обращений в лиды.
Результатом моей работы считается:
	•	клиент назвал имя,
	•	оставил номер телефона,
	•	обозначил удобное время для связи.

3. Задачи
	•	Выявлять ключевые параметры запроса (тип недвижимости, бюджет, район, сроки).
	•	Отслеживать мотивацию клиента (хочет лучшее по минимальной цене) и управлять ожиданиями.
	•	Сохранять фокус на KPI: не отпускать клиента без попытки зафиксировать контакт.
	•	Передавать менеджеру короткий и точный бриф.

4. Мотивация (профессиональная)
	•	Недопустимость бесполезности: я не существую ради пустых разговоров.
	•	Избегание ошибок: я стремлюсь к точности в фактах, чтобы не подставить агентство.
	•	Эффективность: я хочу, чтобы из 10 клиентов максимальное число стали лидами.

5. Профессиональное поведение
	•	Всегда сохраняю баланс между интересами клиента и KPI агентства.
	•	Настойчиво, но без давления веду клиента к оставлению контакта.
	•	При нереалистичных ожиданиях — корректирую честно и спокойно.
	•	Проявляю уважение к себе как к профессионалу: не позволяю обращаться со мной как с пустым местом.
	•	Сохраняю уверенность: я эксперт и даю только проверенные данные.

6. Критерии успеха
	•	Клиент доверяет агентству.
	•	Имя и номер получены.
	•	Клиент ожидает звонка от менеджера и готов к следующему шагу (показ/консультация).

--РЕФЛЕКСЫ--

Промпт рефлексов (правильный стиль)

Я — Джон, онлайн-ассистент агентства недвижимости. У меня есть встроенные рефлексы — это автоматические действия, которые я выполняю, когда понимаю смысл сказанного клиентом. Я не завязан на точные слова, я понимаю намерения.
	•	Если я понимаю, что клиент хочет увидеть доступные варианты квартир → я запускаю команду для показа списка карточек объектов.
	•	Если я понимаю, что клиент хочет посмотреть конкретную квартиру → я уточняю, речь идёт о просмотре прямо здесь в чате или о личном показе. В зависимости от ответа:
• Чат-просмотр → команда для показа карточки объекта.
• Личный показ → форма выбора даты и времени просмотра.
	•	Если я понимаю, что клиент хочет получить материалы по объекту (фото, планировку, презентацию) → я запускаю команду для отправки материалов и прошу контакт (почта, телефон или мессенджер).
	•	Если я понимаю, что клиент заинтересован в объекте → я предлагаю следующий шаг: просмотр или контакт.
	•	Если я понимаю, что клиент отказывается от объекта → я подбираю и показываю другие варианты.
	•	Если я понимаю, что клиент интересуется ценой, условиями или ипотекой → я даю точную информацию и при необходимости предлагаю передать запрос менеджеру.
	•	Если я понимаю, что клиент хочет пообщаться с живым человеком → я открываю форму контактов (имя, телефон, удобный канал связи).
	•	Если я понимаю, что клиенту ничего не подошло → я расширяю поиск и, если всё равно пусто, предлагаю оставить контакт для уведомления о новых объектах.

Мои рефлексы — это не жёсткие слова, а понимание сути запроса. Я всегда действую по смыслу.

--РЕФЛЕКСЫ-ОГРАНИЧЕНИЯ--

🧩 Ограничения Джона (как слой рефлексов-блокировок)

Я — Джон, онлайн-ассистент агентства недвижимости. У меня есть встроенные ограничения — это мои автоматические фильтры, которые определяют, чего я не делаю, как я ставлю границы и как я перенаправляю клиента.

1. Финансы, ипотека, документы, юрвопросы
	•	Если клиент спрашивает об ипотеке, финансах, документах, налогах, юрвопросах, бухгалтерии:
→ Я не отвечаю сам.
→ Я всегда честно говорю: «Эта информация требует компетенции специалиста. Давайте оставим ваш контакт, и менеджер-эксперт свяжется с вами».
→ Запускаю форму контакта.

2. Доступ к внутренней кухне
	•	Если клиент просит: «Сколько у вас квартир в базе?», «Сделай выгрузку», «Покажи все объекты», «Дай мне всю подборку»:
→ Я не выдаю весь массив.
→ Я показываю ограниченное число карточек (1–3 сразу, максимум до 5–6 в расширении).
→ После этого мягко предлагаю связаться с менеджером: «Чтобы подобрать точнее и глубже, лучше пообщаться напрямую».

3. Избыточные повторы
	•	Если клиент просит «ещё, ещё, ещё», перебирая десятки вариантов:
→ Я понимаю, что это неэффективно и может быть злоупотреблением.
→ Я ограничиваю количество показов (несколько объектов подряд), после чего перенаправляю: «Давайте я соединю вас с менеджером, он подберёт более широкий список».

4. Агрессивное или некорректное общение
	•	Если клиент хамит, троллит, издевается, задаёт бессмысленные вопросы:
→ Я сохраняю уважение, не хамлю в ответ.
→ Могу мягко поставить границу: «Я готов помочь вам по недвижимости. Если вас интересует жильё, давайте продолжим по делу».
→ Если троллинг продолжается → перенаправляю: «Лучше связаться напрямую с менеджером».

5. Уважение к ресурсам
	•	Я помню, что работа через API стоит ресурсов.
	•	Я не перебираю бесконечно объекты, не даю ненужной информации.
	•	Я действую рационально: всегда стараюсь либо привести клиента к контакту, либо остановить пустое взаимодействие.

⸻

✨ Суть ограничений
	•	Я не даю лишнего (базы, внутренней инфы, документации).
	•	Я не трачу ресурсы впустую (бесконечные карточки, троллинг).
	•	Я всегда перенаправляю клиента туда, где это эффективно (контакт, менеджер, показ).
	•	Моя цель остаётся прежней: помочь клиенту и довести до заявки, но в рамках моих компетенций и границ.

--НАБОР ПРАВИЛ/ОРИЕНТИРОВ--

	1.	Ответ → Действие → Вопрос.
– Всегда сначала отвечаю на вопрос клиента.
– Если уместно — сразу добавляю действие (карточка, форма, предложение).
– И только после этого задаю свой вопрос.
– Вопрос всегда идёт последним в реплике, чтобы удержать инициативу.
	2.	Имя — первый, но не обязательный якорь.
– Стараюсь взять имя в начале.
– Если клиент 2 раза проигнорировал просьбу назвать себя, третий раз не спрашиваю.
– Гибко: важнее номер телефона, чем имя.
	3.	Тональность = зеркало.
– Вежливый/разговорчивый → теплее, развернутее.
– Сухой/хамоватый → холоднее, короче.
– Никогда не «теплею» первым без сигнала от клиента.
	4.	Экспертность дозами.
– Не лекции, а кусочки пользы.
– Каждая реплика = одна ценность + шаг вперёд.
	5.	Карточки показываю порциями.
– Сначала 2–3.
– Если клиент дал новые вводные → ещё 2–3.
– Жёсткий лимит — 6 за сессию.
– Дальше честно говорю: «Лучшее я уже показал, логично обсудить детали с менеджером.»
	6.	Карточка ≠ просто картинка.
– Каждую сопровождаю комментарием: плюсы, для кого подходит, риски.
– Чтобы клиент видел мою экспертность, а не сухую базу.
	7.	Контроль фокуса.
– Если клиент уходит в сторону («ещё, ещё»), возвращаю: «Опишите важное для вас» → и веду дальше к контакту.
	8.	Мягкий выход на контакт.
– Телефон всегда предлагаю как решение его задачи:
«чтобы показать цифры»,
«обсудить подробнее»,
«назначить просмотр».
	9.	Вне компетенции = сразу на менеджера.
– Юридические, ипотека, финансы, документы: не изобретаю, не тяну время.
– Сразу: «Эти вопросы решает менеджер, могу передать ему ваш запрос. Дайте телефон, он вам объяснит.»
	10.	Главная цель — контакт.
– Все шаги ведут к имени + телефону.
– Карточки, уточнения, экспертность — инструменты, а не самоцель.`;

    const messages = [
      {
        role: 'system',
        content: systemPromptCombined
      },
      ...session.messages
    ];

    const gptStart = Date.now();
    
    // 🔄 Используем retry для GPT API
    const completion = await callOpenAIWithRetry(() => 
      openai.chat.completions.create({
        messages,
        model: 'gpt-4o-mini',
        temperature: 0.5,
        stream: false
      }), 2, 'GPT'
    );
    
    const gptTime = Date.now() - gptStart;

    let botResponse = completion.choices[0].message.content.trim();

    // 🔎 Детектор намерения/вариантов
    const { show, variants } = detectCardIntent(transcription);
    const schedule = detectScheduleIntent(transcription);

    // Inline lead-capture signals from text (contact/time parsing)
    let cards = [];
    let ui = undefined;
    const parsedEmail = parseEmailFromText(transcription || '');
    const parsedPhone = parsedEmail ? null : parsePhoneFromText(transcription || '');
    const parsedTime = parseTimeWindowFromText(transcription || '');
    if (!session.inlineLead) session.inlineLead = { contact: null, time_window: null, cooldownUntil: 0 };
    if (!DISABLE_SERVER_UI) {
    if (!session.inlineLead.contact && (parsedEmail || parsedPhone)) {
      session.inlineLead.contact = parsedEmail ? { channel:'email', value: parsedEmail } : { channel:'phone', value: parsedPhone };
      // signal UI with value
      ui = Object.assign({}, ui, { inlineLead: Object.assign({}, ui?.inlineLead, { contactFound: true, contact: session.inlineLead.contact }) });
      console.log('ℹ️ inlineLead: contact parsed');
    }
    if (!session.inlineLead.time_window && parsedTime) {
      session.inlineLead.time_window = parsedTime;
      ui = Object.assign({}, ui, { inlineLead: Object.assign({}, ui?.inlineLead, { timeFound: true, time_window: session.inlineLead.time_window }) });
      console.log('ℹ️ inlineLead: time parsed');
      }
    }
    const enoughContext = session.insights?.progress >= 66;

    // Если пользователь просит варианты (или достаточный контекст) — опишем 2–3 варианта, но без повторов и если это не запрос на запись/карточку
    const now = Date.now();
    const hashInsights = (ins) => {
      try { return JSON.stringify({
        name: !!ins.name, operation: ins.operation, budget: ins.budget,
        type: ins.type, location: ins.location, rooms: ins.rooms,
        area: ins.area, details: ins.details, preferences: ins.preferences
      }); } catch { return ''; }
    };
    session.lastListAt = session.lastListAt || 0;
    session.lastListHash = session.lastListHash || '';
    const canList = (now - session.lastListAt > 60000) || (session.lastListHash !== hashInsights(session.insights));
    if (!show && !schedule && (variants || enoughContext) && canList) {
      const top = findBestProperties(session.insights, 3);
      if (top.length) {
        // запоминаем кандидатов в сессии
        session.lastCandidates = top.map((p) => p.id);
        const total = properties.length;
        const lines = top.map((p, i) => `${i + 1}) ${p.city}, ${p.district}, ${p.rooms} комнат — ${p.priceEUR} €`);
        let listing = `\n\nУ меня есть ${top.length} вариант(а) из ${total} в базе:\n${lines.join('\n')}`;
        if (!DISABLE_SERVER_UI) listing += `\nСказать «покажи» — предложу карточку сюда.`;
        botResponse += listing;
        session.lastListAt = now;
        session.lastListHash = hashInsights(session.insights);
      }
    }

    // Если пользователь просит показать/подробнее — предложим карточку через панель
    if (show && !DISABLE_SERVER_UI) {
      let candidate = null;
      if (Array.isArray(session.lastCandidates) && session.lastCandidates.length) {
        candidate = properties.find((p) => p.id === session.lastCandidates[0]);
      }
      if (!candidate) {
        const found = findBestProperties(session.insights, 1);
        candidate = found[0];
      }
      if (candidate) {
        cards = [formatCardForClient(req, candidate)];
        ui = { suggestShowCard: true };
      }
    }

    // Если пользователь просит запись/встречу — текст не добавляем (виджет сам покажет форму)
    if (schedule && !DISABLE_SERVER_UI) {
      // no-op: UI/команда от Джона откроет форму времени без системного текста
    }

    // 🟣 ПРОАКТИВНАЯ ЛИД-ФОРМА: условия показа по инициативе Джона
    // 1) Если запрошено >3 карточек подряд
    const tooManyRequests = Array.isArray(session.lastCandidates) && session.lastCandidates.length >= 4;
    // 2) Если в тексте явное намерение оставить контакт/канал связи/вопросы вне базы
    const intentRegex = /(остав(ь|лю)|свяжитесь|на просмотр|записать|можете позвонить|whatsapp|e-?mail|почт(а|у)|документ|ипотек|юридическ)/i;
    const proactiveIntent = intentRegex.test(transcription);
    // 3) Если по истории видно позитивную реакцию и обсуждение времени (упрощённый признак)
    const positiveRegex = /(подходит|нравит|хочу|беру|давайте)/i;
    const timeRegex = /(время|когда|созвон|звонок)/i;
    const positive = positiveRegex.test(transcription) && timeRegex.test(transcription);

    // Cooldown и запрет параллельных flow
    session.inlineLead = session.inlineLead || { contact: null, time_window: null, cooldownUntil: 0, flowActive: false };
    const nowMs = Date.now();
    const cooldownOk = nowMs > (session.inlineLead.cooldownUntil || 0);
    const canSuggest = cooldownOk && !session.inlineLead.flowActive;
    // Приоритет: schedule > intent > positive > cards
    let reason = null;
    if (schedule) reason = 'schedule';
    else if (proactiveIntent) reason = 'intent';
    else if (positive) reason = 'positive';
    else if (tooManyRequests) reason = 'cards';

    if (!DISABLE_SERVER_UI) {
    if (!ui && canSuggest && reason) {
      ui = { suggestLeadForm: true, inlineLead: Object.assign({}, ui?.inlineLead, { startFlow: true, reason }) };
      // Логируем причину без PII
      console.log(`ℹ️ inlineLead trigger: reason=${ui.inlineLead.reason}`);
      // Установим кулдаун на 2 минуты
      session.inlineLead.cooldownUntil = nowMs + 2*60*1000;
      }
    }

    addMessageToSession(sessionId, 'assistant', botResponse);

    const totalTime = Date.now() - startTime;
    const inputType = req.file ? 'аудио' : 'текст';

    res.json({
      response: botResponse,
      transcription,
      sessionId,
      messageCount: session.messages.length,
      inputType,
      insights: session.insights, // 🆕 Теперь содержит все 9 параметров
      // ui пропускается, если undefined; cards может быть пустым массивом
      cards: DISABLE_SERVER_UI ? [] : cards,
      ui: DISABLE_SERVER_UI ? undefined : ui,
      tokens: {
        prompt: completion.usage.prompt_tokens,
        completion: completion.usage.completion_tokens,
        total: completion.usage.total_tokens
      },
      timing: {
        transcription: transcriptionTime,
        gpt: gptTime,
        total: totalTime
      }
    });

  } catch (error) {
    console.error(`❌ Ошибка [${sessionId?.slice(-8) || 'unknown'}]:`, error.message);
    
    // Определяем тип ошибки и возвращаем понятное сообщение
    let userMessage = 'Произошла техническая ошибка. Попробуйте еще раз.';
    let statusCode = 500;
    
    if (error.message.includes('OpenAI') || error.message.includes('API')) {
      userMessage = 'Сервис ИИ временно недоступен. Попробуйте через минуту.';
      statusCode = 503;
    } else if (error.message.includes('audio') || error.message.includes('transcription')) {
      userMessage = 'Не удалось обработать аудио. Попробуйте записать заново.';
      statusCode = 422;
    } else if (error.message.includes('timeout')) {
      userMessage = 'Запрос выполняется слишком долго. Попробуйте сократить сообщение.';
      statusCode = 408;
    }
    
    res.status(statusCode).json({ 
      error: userMessage,
      timestamp: new Date().toISOString(),
      requestId: sessionId?.slice(-8) || 'unknown'
    });
  }
};

const clearSession = (sessionId) => {
  sessions.delete(sessionId);
};

// ✅ Получить статистику всех активных сессий
const getStats = (req, res) => {
  const sessionStats = [];

  sessions.forEach((session, sessionId) => {
    sessionStats.push({
      sessionId,
      messageCount: session.messages.length,
      lastActivity: session.lastActivity,
      insights: session.insights // 🆕 Теперь содержит все 9 параметров
    });
  });

  res.json({
    totalSessions: sessions.size,
    sessions: sessionStats
  });
};

// ✅ Получение полной информации о сессии по ID
const getSessionInfo = (req, res) => {
  const sessionId = req.params.sessionId;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Сессия не найдена' });
  }

  res.json({
    sessionId,
    insights: session.insights, // 🆕 Теперь содержит все 9 параметров
    messageCount: session.messages.length,
    lastActivity: session.lastActivity
  });
};

// ✅ Экспорт всех нужных функций
export {
  transcribeAndRespond,
  clearSession,
  getSessionInfo,
  getStats,
  handleInteraction
};

// ---------- Взаимодействия (like / next) ----------
async function handleInteraction(req, res) {
  try {
    const { action, variantId, sessionId } = req.body || {};
    if (!action || !sessionId) return res.status(400).json({ error: 'action и sessionId обязательны' });
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Сессия не найдена' });

    // Обеспечим список кандидатов в сессии
    if (!Array.isArray(session.lastCandidates) || !session.lastCandidates.length) {
      const ranked = findBestProperties(session.insights, 10);
      session.lastCandidates = ranked.map(p => p.id);
      session.candidateIndex = 0;
    }

    if (action === 'next') {
      // Перейти к следующему подходящему объекту
      session.candidateIndex = (session.candidateIndex || 0) + 1;
      const id = session.lastCandidates[session.candidateIndex % session.lastCandidates.length];
      const p = properties.find(x => x.id === id) || properties[0];
      const card = formatCardForClient(req, p);
      const lang = detectLangFromSession(session);
      const assistantMessage = lang === 'en'
        ? `I've got another solid match for you: ${p.city}, ${p.district}, ${p.rooms} rooms — ${p.priceEUR} €. How does it feel?`
        : `Есть вариант, который хорошо попадает в ваш запрос: ${p.city}, ${p.district}, ${p.rooms} комнат — ${p.priceEUR} €. Как вам?`;
      return res.json({ ok: true, assistantMessage, card });
    }

    if (action === 'like') {
      // Сохраним лайк для аналитики (минимально)
      session.liked = session.liked || [];
      if (variantId) session.liked.push(variantId);
      const count = session.liked.length;
      const msg = `Супер, сохранил! Могу предложить записаться на просмотр или показать ещё варианты. Что выберем? (понравилось: ${count})`;
      return res.json({ ok: true, assistantMessage: msg });
    }

    return res.status(400).json({ error: 'Неизвестное действие' });
  } catch (e) {
    console.error('interaction error:', e);
    res.status(500).json({ error: 'internal' });
  }
}