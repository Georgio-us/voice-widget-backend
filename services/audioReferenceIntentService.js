// 🆕 Sprint V: детекция reference в тексте пользователя (без интерпретации)
// NOTE (2026-03-22): intentionally retained by product decision.
// This block is the explicit reference resolver for "this/that" utterances.
// 🔧 Hotfix: Reference Detector Stabilization (Roadmap v2)
// ВАЖНО: JS \b НЕ работает с кириллицей, поэтому RU матчим через пробельные границы
export const detectReferenceIntent = (text) => {
  if (!text || typeof text !== 'string') return null;

  const normalized = String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Unicode-safe normalization:
    // - keep all letters/numbers across scripts (incl. ES diacritics/ñ)
    // - strip diacritics (é -> e, ñ -> n) for stable matching
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return null;

  // Пробельные границы для RU (JS \b не работает с кириллицей)
  const norm = ' ' + normalized + ' ';

  // order: multi -> single -> unknown -> null

  // === MULTI (RU через includes, EN через regex \b) ===
  const multiRuChecks = [
    { id: 'multi_ru_vot_eti', phrase: ' вот эти ' },
    { id: 'multi_ru_eti_varianty', phrase: ' эти варианты ' },
    { id: 'multi_ru_eti_kvartiry', phrase: ' эти квартиры ' },
    { id: 'multi_ru_eti', phrase: ' эти ' },
    { id: 'multi_ru_oba', phrase: ' оба ' },
    { id: 'multi_ru_neskolko', phrase: ' несколько ' }
  ];
  for (const r of multiRuChecks) {
    if (norm.includes(r.phrase)) {
      return { type: 'multi', detectedAt: Date.now(), source: 'user_message', matchRuleId: r.id };
    }
  }
  // ES multi (через includes; без \b)
  const multiEsChecks = [
    { id: 'multi_es_estas', phrase: ' estas ' },
    { id: 'multi_es_estos', phrase: ' estos ' },
    { id: 'multi_es_esas', phrase: ' esas ' },
    { id: 'multi_es_esos', phrase: ' esos ' },
    { id: 'multi_es_aquellos', phrase: ' aquellos ' },
    { id: 'multi_es_aquellas', phrase: ' aquellas ' }
  ];
  for (const r of multiEsChecks) {
    if (norm.includes(r.phrase)) {
      return { type: 'multi', detectedAt: Date.now(), source: 'user_message', matchRuleId: r.id };
    }
  }
  // EN multi (regex ok)
  if (/\bthese\b/.test(normalized)) return { type: 'multi', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'multi_en_these' };
  if (/\bboth\b/.test(normalized)) return { type: 'multi', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'multi_en_both' };

  // === SINGLE (RU через includes, EN через regex \b) ===
  const singleRuChecks = [
    { id: 'single_ru_vot_eta', phrase: ' вот эта ' },
    { id: 'single_ru_vot_eto', phrase: ' вот это ' },
    // 🆕 Patch (outside Roadmap): RU accusative pointer forms ("эту / про эту / вот эту")
    // ВАЖНО: порядок важен — более специфичные формы должны матчиться раньше, чем "эту"
    { id: 'single_ru_vot_etu', phrase: ' вот эту ' },
    { id: 'single_ru_pro_etu', phrase: ' про эту ' },
    { id: 'single_ru_i_eta', phrase: ' и эта ' },
    { id: 'single_ru_eta_tozhe', phrase: ' эта тоже ' },
    { id: 'single_ru_eta_norm', phrase: ' эта норм ' },
    { id: 'single_ru_eta_kvartira', phrase: ' эта квартира ' },
    { id: 'single_ru_etot_variant', phrase: ' этот вариант ' },
    { id: 'single_ru_eto', phrase: ' это ' },
    { id: 'single_ru_etu', phrase: ' эту ' },
    { id: 'single_ru_eta', phrase: ' эта ' }
  ];
  for (const r of singleRuChecks) {
    if (norm.includes(r.phrase)) {
      return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: r.id };
    }
  }
  // ES single (через includes; без \b)
  const singleEsChecks = [
    { id: 'single_es_esta', phrase: ' esta ' },
    { id: 'single_es_este', phrase: ' este ' },
    { id: 'single_es_esa', phrase: ' esa ' },
    { id: 'single_es_ese', phrase: ' ese ' },
    { id: 'single_es_aquel', phrase: ' aquel ' },
    { id: 'single_es_aquella', phrase: ' aquella ' }
  ];
  for (const r of singleEsChecks) {
    if (norm.includes(r.phrase)) {
      return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: r.id };
    }
  }
  // EN single (regex ok)
  if (/\bthis one\b/.test(normalized)) return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'single_en_this_one' };
  if (/\bthat one\b/.test(normalized)) return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'single_en_that_one' };
  if (/\bthis\b/.test(normalized)) return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'single_en_this' };
  if (/\bthat\b/.test(normalized)) return { type: 'single', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'single_en_that' };

  // === UNKNOWN (RU через includes, EN через regex \b) ===
  const unknownRuChecks = [
    { id: 'unknown_ru_tot_variant', phrase: ' тот вариант ' },
    { id: 'unknown_ru_tot', phrase: ' тот ' },
    { id: 'unknown_ru_takaya', phrase: ' такая ' }
  ];
  for (const r of unknownRuChecks) {
    if (norm.includes(r.phrase)) {
      return { type: 'unknown', detectedAt: Date.now(), source: 'user_message', matchRuleId: r.id };
    }
  }
  // EN unknown (regex ok)
  if (/\bthat one there\b/.test(normalized)) return { type: 'unknown', detectedAt: Date.now(), source: 'user_message', matchRuleId: 'unknown_en_that_one_there' };

  return null;
};

// ====== RMv3 / Sprint 2 / Task 1: Reference Fallback Gate (WHEN to call LLM fallback) ======
// ВАЖНО:
// - Не вызывает LLM
// - Не меняет session
// - Не пишет в referenceIntent
// - Не логирует при false
// - При true: один лог [REF_FALLBACK_GATE] reason=eligible
export const shouldUseReferenceFallback = (session, userInput) => {
  // A) Reference detector не сработал
  if (!(session?.referenceIntent == null)) return false;

  // Sprint 2 / Task 10: do NOT call fallback if server is already in clarification/boundary mode
  if (
    session?.referenceAmbiguity?.isAmbiguous === true ||
    session?.clarificationRequired?.isRequired === true ||
    session?.clarificationBoundaryActive === true
  ) {
    return false;
  }

  // B) Есть активный UI-контекст (server-truth)
  const hasActiveUiContext =
    Boolean(session?.currentFocusCard?.cardId) ||
    session?.singleReferenceBinding?.hasProposal === true ||
    (Array.isArray(session?.candidateShortlist?.items) && session.candidateShortlist.items.length > 0);
  if (!hasActiveUiContext) return false;

  // C) Сообщение короткое и указательное
  if (typeof userInput !== 'string') return false;
  const raw = userInput;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 15) return false;
  // Block any numeric characters (ASCII + Unicode digits)
  if (/\p{Number}/u.test(trimmed)) return false;
  if (/(€|\$|\beur\b|\busd\b)/i.test(trimmed)) return false;

  // D) Похоже на ссылку, а не вопрос/описание
  const normalized = trimmed
    .toLowerCase()
    .replace(/ё/g, 'е')
    // Unicode-safe normalization (ES diacritics + punctuation handling)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;

  // быстрый отсев: вопросы/описания/фильтры/глаголы
  if (/[?]/.test(trimmed)) return false;
  const banned = [
    // RU verbs / intent
    /покаж/i, /показат/i, /хочу/i, /интерес/i, /нрав/i, /отправ/i, /пришл/i, /дай/i, /возьм/i, /выбер/i,
    // RU filters
    /цен/i, /район/i, /комнат/i, /площад/i, /метр/i, /\bдо\b/i,
    // EN verbs / intent
    /\bshow\b/i, /\bwant\b/i, /\blike\b/i, /\bsend\b/i, /\bchoose\b/i, /\btake\b/i,
    // EN filters / question-ish
    /\bprice\b/i, /\bdistrict\b/i, /\barea\b/i, /\brooms?\b/i, /\bunder\b/i, /\bup\s*to\b/i,
    /\bwhat\b/i, /\bwhich\b/i, /\bhow\b/i, /\bwhy\b/i
  ];
  if (banned.some((re) => re.test(normalized))) return false;

  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > 2) return false;

  const allowedSingle = new Set([
    'эта', 'эт', 'eto', 'eta',
    'this', 'that', 'thsi', 'dis',
    // ES minimal deictics (Sprint 2 / Task 6)
    'esta', 'este', 'eso', 'esa', 'estas', 'estos', 'ese', 'aquel',
    'one', 'onee'
  ]);
  const allowedFirstForOne = new Set([
    'this', 'that', 'thsi', 'dis',
    // ES minimal deictics (Sprint 2 / Task 6)
    'esta', 'este', 'eso', 'esa', 'estas', 'estos', 'ese', 'aquel'
  ]);
  const allowedSecond = new Set(['one', 'onee']);

  let eligible = false;
  if (words.length === 1) {
    eligible = allowedSingle.has(words[0]);
  } else if (words.length === 2) {
    eligible = allowedFirstForOne.has(words[0]) && allowedSecond.has(words[1]);
  }

  if (!eligible) return false;

  // Диагностика: логируем только при true
  const sid = String(session?.sessionId || '').slice(-8) || 'unknown';
  const safeInput = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
  console.log(`[REF_FALLBACK_GATE] sid=${sid} input="${safeInput}" reason=eligible`);
  return true;
};

// ====== RMv3 / Sprint 2 / Task 2: LLM reference fallback classifier (classifier only) ======
// ВАЖНО:
// - Возвращает только классификацию referenceType + диагностические поля
// - Не выбирает карточки, не читает UI, не добавляет факты
// - При любой ошибке/мусоре возвращает безопасный дефолт
export const REF_FALLBACK_CONFIDENCE_THRESHOLD = 0.6;
export async function classifyReferenceIntentFallbackLLM({ openai, text, language, retryOpenAI = (fn) => fn() }) {
  const safeDefault = {
    referenceType: null,
    normalizedText: null,
    confidence: 0,
    reasonTag: 'other'
  };

  try {
    if (!text || typeof text !== 'string') return safeDefault;
    const langHint = typeof language === 'string' && language.trim() ? language.trim().toLowerCase() : null;

    const system = [
      'You are a strict JSON-only classifier.',
      'Return ONLY valid JSON. No extra text, no markdown, no code fences.',
      'Task: classify a short user utterance as a reference intent only.',
      'You MUST NOT pick any card or infer UI state.',
      '',
      'Output schema (exact keys only):',
      '{',
      '  "referenceType": "single" | "multi" | "unknown" | null,',
      '  "normalizedText": string | null,',
      '  "confidence": number,',
      '  "reasonTag": "typo" | "keyboard_layout" | "mixed_language" | "other" | null',
      '}',
      '',
      'Rules:',
      '- If not confident, set referenceType=null and confidence=0.',
      '- confidence must be between 0 and 1.',
      '- normalizedText: a cleaned/lowercased version of the input (or null).',
      '- Keep it minimal and deterministic.'
    ].join('\n');

    const user = JSON.stringify({
      text: String(text),
      language: langHint
    });

    const completion = await retryOpenAI(() =>
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 160,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }), 2, 'REF-Fallback-Classifier'
    );

    const raw = completion?.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== 'string') return safeDefault;

    const cleaned = raw.replace(/```json\s*|\s*```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return safeDefault;
    }

    const allowedTypes = new Set(['single', 'multi', 'unknown']);
    const allowedReasons = new Set(['typo', 'keyboard_layout', 'mixed_language', 'other']);

    const referenceType = (parsed && typeof parsed.referenceType === 'string' && allowedTypes.has(parsed.referenceType))
      ? parsed.referenceType
      : (parsed?.referenceType === null ? null : null);

    const normalizedText = (parsed && typeof parsed.normalizedText === 'string' && parsed.normalizedText.trim())
      ? parsed.normalizedText
      : null;

    const confidence = (parsed && typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) && parsed.confidence >= 0 && parsed.confidence <= 1)
      ? parsed.confidence
      : 0;

    const reasonTag = (parsed && typeof parsed.reasonTag === 'string' && allowedReasons.has(parsed.reasonTag))
      ? parsed.reasonTag
      : (parsed?.reasonTag === null ? null : 'other');

    return { referenceType, normalizedText, confidence, reasonTag };
  } catch {
    return safeDefault;
  }
}
