export const detectCardIntent = (text = '') => {
  const t = String(text).toLowerCase();
  // NOTE (2026-03-22): text-triggered slider opening is intentionally disabled.
  // Slider opens only from explicit UI control (objects counter pill).
  const isShow = false;
  const isVariants = /(какие|что)\s+(есть|можно)\s+(вариант|квартир)/i.test(t)
    || /подбери(те)?|подобрать|вариант(ы)?|есть\s+вариант/i.test(t)
    || /квартир(а|ы|у)\s+(есть|бывают)/i.test(t);
  return { show: isShow, variants: isVariants };
};

// RMv3 / Sprint 4 / Task 4.4: demo-only "словесный выбор объекта"
// ВАЖНО:
// - максимально простой regex/keyword match (без NLP)
// - НЕ "покажи" (это отдельный show-intent)
// - триггер работает только если есть lastShown/currentFocusCard (никаких догадок)
export const detectVerbalSelectIntent = (text = '') => {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return false;
  // Предохранитель: "покажи"/"show" — это show-intent, не выбор
  if (/(покажи(те)?|показать|посмотреть)/i.test(t)) return false;
  if (/\b(show|show\s+me|can\s+you\s+show)\b/i.test(t)) return false;
  // Сигнал "выбор/подходит/нравится" + указание на "этот/эта/последний вариант"
  const hasChoiceCue = /(понрав|нравит|подход|устраива|бер(у|ем|ём)|давай|выбираю|остановимс|ок\b)/i.test(t);
  const hasTargetCue = /(эт(от|а|у)\s+(вариант|квартир)|эт(от|а|у)\b|последн(ий|яя|ю)\b|последн(ий|яя|ю)\s+(вариант|квартир))/i.test(t);
  // "мне нравится этот вариант" -> true; "подходит" без указания -> false
  return hasChoiceCue && hasTargetCue;
};

export const getUiHighlightTarget = (text = '') => {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  if (/(ручн(ые|і|і)?\s+фильтр|ручн(і|ые)?\s+фільтр|фильтр|фільтр|отфильтр|відфільтр|параметр|настроить\s+поиск|налаштувати\s+пошук|точн(ее|іше)|сузить\s+поиск|звузити\s+пошук)/i.test(t)) {
    return 'filters';
  }
  return null;
};

// Sprint VI / Task #2: явная фиксация explicit choice по строгому whitelist (без LLM)
// Разрешённые маркеры:
// - "беру эту"
// - "выбираю эту"
// - "остановимся на этом варианте"
// - "да, эту квартиру"
export const detectExplicitChoiceMarker = (text = '') => {
  const t = String(text).toLowerCase().trim();
  const patterns = [
    /(?:^|[.!?]\s*|,\s*)беру\s+эту\b/i,
    /(?:^|[.!?]\s*|,\s*)выбираю\s+эту\b/i,
    /(?:^|[.!?]\s*|,\s*)остановимся\s+на\s+этом\s+варианте\b/i,
    /(?:^|[.!?]\s*|,\s*)да,?\s+эту\s+квартиру\b/i
  ];
  return patterns.some((re) => re.test(t));
};
