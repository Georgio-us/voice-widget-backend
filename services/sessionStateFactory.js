export const buildInitialAudioSession = (
  sessionId,
  {
    role = 'search_ready',
    now = Date.now()
  } = {}
) => ({
  sessionId,
  messages: [],
  createdAt: now,
  lastActivity: now,
  // Профиль клиента для логики воронки
  clientProfile: {
    language: null,
    location: null,
    budgetMin: null,
    budgetMax: null,
    purpose: null,
    propertyType: null,
    urgency: null
  },
  // Текущая стадия диалога
  stage: 'matching_closing',
  // Server-side role: детерминированное состояние через state machine
  role,
  // Расширенная структура insights (v2)
  insights: {
    name: null,
    operation: null,
    budget: null,
    budgetMax: null,
    type: null,
    district: null,
    location: null,
    rooms: null,
    area: null,
    areaMin: null,
    areaMax: null,
    floor: null,
    features: null,
    details: null,
    preferences: null,
    residentialComplex: null,
    floorNotFirst: null,
    floorNotLast: null,
    progress: 0
  },
  extractionMetrics: {
    turnsTotal: 0,
    metaPresentTurns: 0,
    parseErrors: 0,
    validationErrors: 0,
    updatesApplied: 0,
    fieldFilledTurns: {
      name: 0,
      operation: 0,
      budget: 0,
      budgetMax: 0,
      type: 0,
      district: 0,
      location: 0,
      rooms: 0,
      area: 0,
      areaMin: 0,
      areaMax: 0,
      floor: 0,
      features: 0,
      details: 0,
      preferences: 0,
      residentialComplex: 0,
      floorNotFirst: 0,
      floorNotLast: 0
    }
  },
  metaContract: {
    needsRepairHint: false,
    lastError: null,
    lastMetaRaw: null,
    lastUpdatedAt: null
  },
  // Allowed facts are formed only after confirmed card rendering.
  allowedFactsSnapshot: {},
  handoffDone: false,
  handoffAt: null,
  handoff: {
    active: false,
    shownAt: null,
    cardId: null,
    canceled: false,
    canceledAt: null
  },
  leadSnapshot: null,
  leadSnapshotAt: null,
  postHandoffEnrichment: [],
  completionDone: false,
  completionAt: null,
  completionReason: null,
  sliderContext: {
    active: false,
    updatedAt: null
  },
  currentFocusCard: {
    cardId: null,
    updatedAt: null
  },
  lastShown: {
    cardId: null,
    updatedAt: null
  },
  selectedCard: {
    cardId: null,
    selectedAt: null
  },
  lastFocusSnapshot: null,
  referenceIntent: null,
  referenceAmbiguity: {
    isAmbiguous: false,
    reason: null,
    detectedAt: null,
    source: 'server_contract'
  },
  clarificationRequired: {
    isRequired: false,
    reason: null,
    detectedAt: null,
    source: 'server_contract'
  },
  singleReferenceBinding: {
    hasProposal: false,
    proposedCardId: null,
    source: 'server_contract',
    detectedAt: null,
    basis: null
  },
  candidateShortlist: {
    items: []
  },
  explicitChoiceEvent: {
    isConfirmed: false,
    cardId: null,
    detectedAt: null,
    source: 'user_message'
  },
  choiceConfirmationBoundary: {
    active: false,
    chosenCardId: null,
    detectedAt: null,
    source: null
  },
  noGuessingInvariant: {
    active: false,
    reason: null,
    enforcedAt: null
  },
  unknownUiActions: {
    count: 0,
    items: []
  },
  debugTrace: {
    items: []
  },
  clarificationBoundaryActive: false
});
