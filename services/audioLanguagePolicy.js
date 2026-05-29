export const normalizeUiLanguage = (value) => {
  const v = String(value || '').trim().toLowerCase().slice(0, 2);
  if (v === 'ru') return 'ru';
  if (v === 'en') return 'en';
  return 'uk';
};

export const buildLanguageLockPrompt = (lang) => {
  const normalized = normalizeUiLanguage(lang);
  if (normalized === 'ru') {
    return 'Runtime language contract: answer assistant_text only in Russian. Do not switch language because of speech recognition or user text unless the UI language changes.';
  }
  if (normalized === 'en') {
    return 'Runtime language contract: answer assistant_text only in English. Do not switch language because of speech recognition or user text unless the UI language changes.';
  }
  return 'Runtime language contract: answer assistant_text only in Ukrainian. Do not switch to Russian because the user speaks Russian; Russian is allowed only when the UI sends lang=ru.';
};

// Legacy fallback only; runtime UI language is the source of truth.
export const detectLangFromSession = (session) => {
  try {
    const lastUser = [...session.messages].reverse().find(m => m.role === 'user');
    const sample = lastUser?.content || '';
    if (/[А-Яа-яЁё]/.test(sample)) return 'ru';
    if (/[A-Za-z]/.test(sample)) return 'en';
  } catch {}
  return 'uk';
};

// Language priority: client profile, then legacy message-history fallback.
export const getPrimaryLanguage = (session) => {
  const prof = session?.clientProfile?.language;
  if (prof) return String(prof).toLowerCase();
  return detectLangFromSession(session);
};

export const getUiLanguage = (session) => {
  const lang = String(getPrimaryLanguage(session) || '').toLowerCase();
  if (lang === 'uk' || lang === 'ua') return 'uk';
  if (lang === 'en') return 'en';
  if (lang === 'es') return 'es';
  return 'ru';
};
