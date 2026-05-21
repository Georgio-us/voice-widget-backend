export const buildLlmContextPack = (session, sessionId, call) => {
  const sid = String(sessionId || session?.sessionId || '');
  const meta = {
    sessionId: sid,
    role: session?.role ?? null,
    stage: session?.stage ?? null,
    call: call ?? null
  };

  const cp = session?.clientProfile || {};
  const clientProfile = {
    language: cp.language ?? null,
    location: cp.location ?? null,
    purpose: cp.purpose ?? null,
    budget: (cp.budget ?? cp.budgetMax ?? cp.budgetMin ?? session?.insights?.budget ?? null),
    rooms: (cp.rooms ?? session?.insights?.rooms ?? null)
  };

  const uiContext = {
    currentFocusCard: { cardId: session?.currentFocusCard?.cardId ?? null },
    lastShown: { cardId: session?.lastShown?.cardId ?? null },
    lastFocusSnapshot: { cardId: session?.lastFocusSnapshot?.cardId ?? null },
    sliderActive: session?.sliderContext?.active === true
  };

  const referencePipeline = {
    referenceIntent: { type: session?.referenceIntent?.type ?? null },
    referenceAmbiguity: { isAmbiguous: session?.referenceAmbiguity?.isAmbiguous === true },
    clarificationRequired: { isRequired: session?.clarificationRequired?.isRequired === true },
    clarificationBoundaryActive: session?.clarificationBoundaryActive === true,
    singleReferenceBinding: {
      hasProposal: session?.singleReferenceBinding?.hasProposal === true,
      proposedCardId: session?.singleReferenceBinding?.proposedCardId ?? null
    }
  };

  const shortlistItems = Array.isArray(session?.candidateShortlist?.items)
    ? session.candidateShortlist.items
        .filter((it) => it && it.cardId)
        .map((it) => ({ cardId: it.cardId }))
    : [];

  const choice = {
    candidateShortlist: { items: shortlistItems },
    explicitChoiceEvent: { isConfirmed: session?.explicitChoiceEvent?.isConfirmed === true },
    choiceConfirmationBoundary: { active: session?.choiceConfirmationBoundary?.active === true }
  };

  const invariants = {
    noGuessingInvariant: { active: session?.noGuessingInvariant?.active === true }
  };

  const factsCardIdsCandidates = [
    session?.singleReferenceBinding?.proposedCardId ?? null,
    session?.currentFocusCard?.cardId ?? null,
    session?.lastShown?.cardId ?? null,
    session?.lastFocusSnapshot?.cardId ?? null,
    ...(Array.isArray(session?.candidateShortlist?.items)
      ? session.candidateShortlist.items.slice(0, 3).map((it) => it?.cardId ?? null)
      : [])
  ];

  const factsCardIds = [];
  for (const id of factsCardIdsCandidates) {
    if (!id) continue;
    if (factsCardIds.includes(id)) continue;
    factsCardIds.push(id);
    if (factsCardIds.length >= 5) break;
  }

  const cardFactsById = {};
  for (const cardId of factsCardIds) {
    cardFactsById[String(cardId)] = session?.cardFacts?.[cardId] ?? null;
  }

  const facts = {
    allowedFactsSnapshot: session?.allowedFactsSnapshot ?? null,
    cardFactsById,
    factsCardIds
  };

  return { meta, clientProfile, uiContext, referencePipeline, choice, invariants, facts };
};

export const formatCtxLogLine = (pack, { deployTagShort = 'unknown' } = {}) => {
  const deploy = deployTagShort;
  const sid = String(pack?.meta?.sessionId || '');
  const shortSid = sid ? sid.slice(-8) : 'unknown';
  const role = pack?.meta?.role ?? null;
  const stage = pack?.meta?.stage ?? null;
  const call = pack?.meta?.call ?? null;
  const budget = pack?.clientProfile?.budget ?? null;

  const focus = pack?.uiContext?.currentFocusCard?.cardId ?? null;
  const lastShown = pack?.uiContext?.lastShown?.cardId ?? null;
  const lastFocus = pack?.uiContext?.lastFocusSnapshot?.cardId ?? null;
  const slider = pack?.uiContext?.sliderActive === true;

  const refType = pack?.referencePipeline?.referenceIntent?.type ?? null;
  const amb = pack?.referencePipeline?.referenceAmbiguity?.isAmbiguous === true;
  const clarReq = pack?.referencePipeline?.clarificationRequired?.isRequired === true;
  const clarBoundary = pack?.referencePipeline?.clarificationBoundaryActive === true;
  const bind = pack?.referencePipeline?.singleReferenceBinding?.hasProposal === true;
  const bindCard = pack?.referencePipeline?.singleReferenceBinding?.proposedCardId ?? null;

  const shortlistIds = Array.isArray(pack?.choice?.candidateShortlist?.items)
    ? Array.from(new Set(pack.choice.candidateShortlist.items.map((it) => it?.cardId).filter(Boolean)))
    : [];
  const choice = pack?.choice?.explicitChoiceEvent?.isConfirmed === true;
  const choiceBoundary = pack?.choice?.choiceConfirmationBoundary?.active === true;

  const noGuess = pack?.invariants?.noGuessingInvariant?.active === true;
  const factsIds = Array.isArray(pack?.facts?.factsCardIds) ? pack.facts.factsCardIds.filter(Boolean) : [];
  const factsCount = factsIds.length;
  const allowedFacts = (() => {
    const snap = pack?.facts?.allowedFactsSnapshot ?? null;
    if (!snap || typeof snap !== 'object') return false;
    return Object.keys(snap).length > 0;
  })();

  const fmt = (v) => (v === null || v === undefined || v === '' ? 'null' : String(v));
  const fmtBool = (b) => (b ? '1' : '0');

  return `[CTX] deploy=${deploy} sid=${shortSid} role=${fmt(role)} stage=${fmt(stage)} call=${fmt(call)} budget=${fmt(budget)} focus=${fmt(focus)} lastShown=${fmt(lastShown)} lastFocus=${fmt(lastFocus)} slider=${fmtBool(slider)} ref=${fmt(refType)} amb=${fmtBool(amb)} clarReq=${fmtBool(clarReq)} clarBoundary=${fmtBool(clarBoundary)} bind=${fmtBool(bind)} bindCard=${fmt(bindCard)} shortlist=[${shortlistIds.join(',')}] choice=${fmtBool(choice)} choiceBoundary=${fmtBool(choiceBoundary)} noGuess=${fmtBool(noGuess)} factsIds=[${factsIds.join(',')}] allowedFacts=${fmtBool(allowedFacts)} factsCount=${fmt(factsCount)}`;
};

export const logCtx = (pack, { deployTagShort = 'unknown', logBuildOnce = null } = {}) => {
  try {
    if (typeof logBuildOnce === 'function') logBuildOnce();
    console.log(formatCtxLogLine(pack, { deployTagShort }));
  } catch {
    console.log('[CTX] (failed_to_format)');
  }
};

const buildCardSummaryLines = (shaped) => {
  const ids = Array.isArray(shaped?.facts?.factsCardIds) ? shaped.facts.factsCardIds.slice(0, 3) : [];
  const byId = (shaped?.facts?.cardFactsById && typeof shaped.facts.cardFactsById === 'object')
    ? shaped.facts.cardFactsById
    : {};

  const lines = [];
  for (const cardId of ids) {
    if (!cardId) continue;
    const raw = byId[cardId] && typeof byId[cardId] === 'object' ? byId[cardId] : null;

    const city = raw?.city ?? null;
    const district = raw?.district ?? null;
    const neighborhood = raw?.neighborhood ?? null;
    const rooms = raw?.rooms ?? null;
    const priceEUR = raw?.priceEUR ?? null;
    const price = raw?.price ?? null;

    const parts = [String(cardId)];

    const locParts = [city, district, neighborhood].filter((v) => v !== null && v !== undefined && String(v).trim() !== '');
    if (locParts.length > 0) {
      parts.push(locParts.map(String).join(', '));
    }

    if (rooms !== null && rooms !== undefined && String(rooms).trim() !== '') {
      const roomsStr = String(rooms);
      const alreadyHasRoomsWord = /\brooms?\b/i.test(roomsStr) || /\bкомн/i.test(roomsStr);
      parts.push(alreadyHasRoomsWord ? roomsStr : `${roomsStr} rooms`);
    }

    const priceVal = (priceEUR !== null && priceEUR !== undefined && String(priceEUR).trim() !== '')
      ? { key: 'priceEUR', val: priceEUR }
      : ((price !== null && price !== undefined && String(price).trim() !== '') ? { key: 'price', val: price } : null);

    if (priceVal) {
      const s = String(priceVal.val);
      const hasCurrencyHint = /€|eur/i.test(s);
      parts.push(hasCurrencyHint ? s : `${priceVal.key}=${s}`);
    }

    lines.push(parts.join(' | '));
  }

  return lines.slice(0, 3);
};

export const buildShapedFactsPackForLLM = (pack) => {
  const meta = {
    sessionId: pack?.meta?.sessionId ?? null,
    role: pack?.meta?.role ?? null,
    stage: pack?.meta?.stage ?? null,
    call: pack?.meta?.call ?? null
  };

  const ui = {
    currentFocusCardId: pack?.uiContext?.currentFocusCard?.cardId ?? null,
    lastShownCardId: pack?.uiContext?.lastShown?.cardId ?? null
  };

  const ref = {
    referenceIntentType: pack?.referencePipeline?.referenceIntent?.type ?? null,
    ambiguity: pack?.referencePipeline?.referenceAmbiguity?.isAmbiguous === true,
    clarificationRequired: pack?.referencePipeline?.clarificationRequired?.isRequired === true,
    clarificationBoundaryActive: pack?.referencePipeline?.clarificationBoundaryActive === true,
    binding: {
      hasProposal: pack?.referencePipeline?.singleReferenceBinding?.hasProposal === true,
      proposedCardId: pack?.referencePipeline?.singleReferenceBinding?.proposedCardId ?? null
    }
  };

  const rawAllowed = pack?.facts?.allowedFactsSnapshot ?? null;
  const allowedFactsKeys = (rawAllowed && typeof rawAllowed === 'object')
    ? Object.keys(rawAllowed).slice(0, 20)
    : [];
  const allowedFactsCount = (rawAllowed && typeof rawAllowed === 'object')
    ? Object.keys(rawAllowed).length
    : 0;

  const factsCardIds = [];
  const candIds = [
    ref.binding.proposedCardId ?? null,
    ui.currentFocusCardId ?? null,
    ui.lastShownCardId ?? null
  ];
  for (const id of candIds) {
    if (!id) continue;
    if (factsCardIds.includes(id)) continue;
    factsCardIds.push(id);
    if (factsCardIds.length >= 3) break;
  }

  const whitelist = new Set([
    'id',
    'cardId',
    'title',
    'city',
    'district',
    'neighborhood',
    'price',
    'priceEUR',
    'rooms',
    'area',
    'floor'
  ]);

  const cardFactsById = {};
  for (const cardId of factsCardIds) {
    const raw = pack?.facts?.cardFactsById?.[cardId] ?? null;
    if (!raw || typeof raw !== 'object') {
      cardFactsById[String(cardId)] = null;
      continue;
    }
    const shapedCard = {};
    for (const key of Object.keys(raw)) {
      if (!whitelist.has(key)) continue;
      const val = raw[key];
      if (val === undefined || val === null) continue;
      shapedCard[key] = val;
    }
    cardFactsById[String(cardId)] = shapedCard;
  }

  const shaped = {
    meta,
    ui,
    ref,
    clarificationMode:
      ref.clarificationBoundaryActive === true ||
      ref.ambiguity === true ||
      ref.clarificationRequired === true,
    facts: {
      factsCardIds,
      allowedFactsKeys,
      allowedFactsCount,
      cardFactsById
    }
  };

  shaped.facts.cardSummaryLines = buildCardSummaryLines(shaped);

  return shaped;
};
