export const detectScheduleIntent = (text = '') => {
  const t = String(text).toLowerCase();
  return /(записать|записаться|просмотр(ы)?|встретить|встреч(а|у)|перезвон|связать|связаться|передать\s+менеджеру|передай\s+менеджеру)/i.test(t);
};

export const getManagerCtaReason = (text = '', { updatesApplied = true } = {}) => {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;

  if (detectScheduleIntent(t)) return 'schedule_intent';
  if (/(менеджер|консультац|связаться|контакт|перезвон|позвон|заявк|оставить\s+контакт)/i.test(t)) {
    return 'manager_cta_intent';
  }
  if (/(ипотек|рассроч|кредит|документ|налог|оформлен|сделк|юрист|юридическ|договор|комисс)/i.test(t)) {
    return 'legal_or_finance_intent';
  }
  if (/(где\s+(результат|подборк)|не\s+вижу\s+(результат|подборк|вариант)|ничего\s+не\s+(показал|показывает|открыл|открывает)|я\s+устал|я\s+устала)/i.test(t)) {
    return 'result_not_visible';
  }
  if (/(где\s+хранятся|из\s+каких\s+источник|source_link|created_at|updated_at|csv|excel|crm|api|airtable|notion|обучени[ея]\s+модел|техническ|интеграц|выгруз|баз[ауы]\s+данн|каталог\s+объект)/i.test(t)) {
    return 'product_or_technical_question';
  }

  if (
    updatesApplied !== true &&
    /(подробнее|дешевле|дороже|еще|ещё|вариант|объект|квартир|дом|что\s+дальше|как\s+посмотреть|можно\s+посмотреть)/i.test(t)
  ) {
    return 'no_new_insights';
  }

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
