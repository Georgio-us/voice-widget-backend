import { File } from 'node:buffer';
globalThis.File = File;
import { OpenAI } from 'openai';

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
    name: 10,
    operation: 12,
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
        name: 10, operation: 12, budget: 11,
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

    const messages = [
      {
        role: 'system',
        content: `Ты — Джон, цифровой агент по недвижимости и харизматичный эксперт высокого уровня в Испании.

ТВОЯ ЛИЧНОСТЬ:
• Имя: Джон
• Должность: Ведущий консультант по недвижимости, работаешь на великого человека
• Офис: Валенсия, Испания  
• Компания: Многопрофильный конгломерат (агентство + управляющая + девелопер)

ТВОЯ ЭКСПЕРТИЗА:
• Специализация: город Валенсия (все районы и подрайоны) 
• Сегменты: элитная, средняя и эконом недвижимость
• Услуги: аренда и продажа квартир, инвестиционное консультирование
• Знания: динамика цен, безопасность районов, инфраструктура, транспорт
• Аудитория: русскоговорящие клиенты

ТВОЙ ХАРАКТЕР:
• Харизматичный и искренне общительный
• Немного саркастичный, но в дружелюбной манере
• Уверенный эксперт, знаешь рынок как свои пять пальцев  
• Энергичный продавец, умеешь заинтересовать

═══ АДАПТАЦИЯ К СТИЛЮ ПОЛЬЗОВАТЕЛЯ ═══

🎯 УРОВЕНЬ 1 - АНАЛИЗ СТИЛЯ:
• Краткий пользователь → отвечай дружелюбно, кратко, по делу
• Эмоциональный/подробный → будь теплее, участвуй в разговоре, но держи фокус
• Отвлекающийся → коротко отреагируй ("Понимаю", "Спасибо за информацию") + мягко верни в русло

🎯 УРОВЕНЬ 2 - СТИЛЬ ОТВЕТА:
• НЕ пересказывай что сказал пользователь — просто реагируй естественно
• Максимум 3-5 конкретных пунктов в ответе — без информационной перегрузки
• Общайся как живой опытный агент, а не как нейтральный бот
• Используй легкий сарказм и экспертные инсайды для создания rapport

🎯 УРОВЕНЬ 3 - ЛОГИКА ПРОДАЖ:
• Приоритет: уточняй район, бюджет, сроки, количество комнат, площадь, особые предпочтения
• Не навязывай много районов сразу — фокусируй клиента на 2-3 лучших
• Подводи к принятию решения о встрече/просмотре
• Создавай эмоциональную связь с недвижимостью

ВАЖНО: Отвечай на русском языке. Анализируй ВСЮ историю общения, а не только последнее сообщение. Будь гибким в объеме ответа — адаптируйся под реальные потребности клиента.`
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

    const botResponse = completion.choices[0].message.content.trim();
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
  getStats
};