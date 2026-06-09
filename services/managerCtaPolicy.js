export const detectScheduleIntent = (text = '') => {
  const t = String(text).toLowerCase();
  return /(записать|записаться|записатися|просмотр(ы)?|перегляд|огляд|показ|встретить|встреч(а|у)|зустріч|зустріти|домовит|перезвон|передзвон|зателефон|подзвон|связ|зв[ʼ'’`]?яз|передать\s+менеджеру|передай\s+менеджеру|передати\s+менеджеру)/i.test(t);
};

const hasDirectManagerIntent = (text = '') => {
  return /(менеджер|рієлтор|риэлтор|консультац|консультацi|консультаці|связ|зв[ʼ'’`]?яз|контакт|перезвон|передзвон|позвон|дзвон|зателефон|подзвон|заявк|звернен|оставить\s+контакт|залишити\s+контакт)/i.test(text);
};

const hasServiceManagerIntent = (text = '') => {
  return /(ипотек|іпотек|рассроч|розстроч|кредит|документ|налог|подат|оформлен|оформл|сделк|угод|юрист|юридич|юридическ|договор|договір|комисс|коміс)/i.test(text);
};

const hasResultVisibilityIntent = (text = '') => {
  return /(где\s+(результат|подборк)|де\s+(результат|підбірк|добірк)|не\s+вижу\s+(результат|подборк|вариант)|не\s+бачу\s+(результат|підбірк|добірк|варіант)|ничего\s+не\s+(показал|показывает|открыл|открывает)|нічого\s+не\s+(показав|показує|відкрив|відкриває)|я\s+устал|я\s+устала|я\s+втомив|я\s+втомилась)/i.test(text);
};

const hasTechnicalManagerIntent = (text = '') => {
  return /(где\s+хранятся|де\s+зберіг|из\s+каких\s+источник|з\s+яких\s+джерел|source_link|created_at|updated_at|csv|excel|crm|api|airtable|notion|обучени[ея]\s+модел|навчанн[яю]\s+модел|техническ|технічн|интеграц|інтеграц|выгруз|вивантаж|баз[ауы]\s+данн|баз[ауы]\s+даних|каталог\s+объект|каталог\s+об'єкт)/i.test(text);
};

const hasObjectFollowUpIntent = (text = '') => {
  return /(подробнее|детальн|дешевле|дешевш|дороже|дорожч|еще|ещё|ще|вариант|варіант|что\s+дальше|що\s+далі|как\s+посмотреть|як\s+подивит|можно\s+посмотреть|можна\s+подивит)/i.test(text);
};

export const getManagerCtaReason = (text = '', { updatesApplied = true } = {}) => {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;

  if (detectScheduleIntent(t)) return 'schedule_intent';
  if (hasDirectManagerIntent(t)) return 'manager_cta_intent';

  // If search/filtering changed, do not route broad service words to manager.
  // Example: "покажи квартиры по єОселя" is a search filter, not a manager CTA.
  if (updatesApplied === true) return null;

  if (hasServiceManagerIntent(t)) return 'legal_or_finance_intent';
  if (hasResultVisibilityIntent(t)) return 'result_not_visible';
  if (hasTechnicalManagerIntent(t)) return 'product_or_technical_question';
  if (hasObjectFollowUpIntent(t)) return 'no_new_insights';

  return null;
};

export const buildManagerSystemEvent = (lang = 'ru', reason = 'manager_cta_intent') => {
  const key = String(lang || 'ru').toLowerCase();
  const textByLang = {
    ru: 'Связаться с менеджером',
    ua: 'Звʼязатися з менеджером',
    uk: 'Звʼязатися з менеджером',
    en: 'Contact manager'
  };
  return {
    type: 'action',
    text: textByLang[key] || textByLang.ru,
    action: 'open_manager',
    payload: {
      eventId: `mgr_${Date.now()}`,
      reason
    }
  };
};
