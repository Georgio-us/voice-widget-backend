import { addPostHandoffEnrichment } from './audioPostHandoffEnrichment.js';

const INSIGHT_PROGRESS_WEIGHTS = {
  name: 7,
  operation: 7,
  budget: 7,
  budgetMax: 7,
  type: 7,
  district: 7,
  location: 7,
  rooms: 7,
  area: 7,
  areaMin: 7,
  areaMax: 7,
  floor: 7,
  floorNotFirst: 7,
  floorNotLast: 7,
  features: 7,
  details: 7,
  preferences: 7,
  residentialComplex: 7
};

export const updateAudioSessionInsightsProgress = (session, newMessage) => {
  if (!session) return;

  if (session.handoffDone) {
    addPostHandoffEnrichment(session, 'user_message', newMessage, {
      role: session.role,
      stage: session.stage
    });
  }

  const current = session.insights || {};
  const normalized = {
    name: current.name ?? null,
    operation: current.operation ?? null,
    budget: current.budget ?? null,
    budgetMax: current.budgetMax ?? null,
    type: current.type ?? null,
    district: current.district ?? null,
    location: current.location ?? null,
    rooms: current.rooms ?? null,
    area: current.area ?? null,
    areaMin: current.areaMin ?? null,
    areaMax: current.areaMax ?? null,
    floor: current.floor ?? null,
    floorNotFirst: current.floorNotFirst ?? null,
    floorNotLast: current.floorNotLast ?? null,
    features: current.features ?? null,
    details: current.details ?? null,
    preferences: current.preferences ?? null,
    residentialComplex: current.residentialComplex ?? null,
    progress: 0
  };

  let totalProgress = 0;
  for (const [field, weight] of Object.entries(INSIGHT_PROGRESS_WEIGHTS)) {
    const value = normalized[field];
    if (value != null && String(value).trim().length > 0) {
      totalProgress += weight;
    }
  }

  normalized.progress = Math.min(totalProgress, 99);
  session.insights = normalized;
};
