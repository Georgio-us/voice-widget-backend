import {
  findBestProperties,
  getAllNormalizedProperties,
  getRankedProperties
} from './audioPropertySearchService.js';
import { annotatePropertyWithScores, hasHardFilters } from './audioPropertySearchUtils.js';
import { formatCardForClient } from './audioCardFormatter.js';

export const ensureInteractionCandidates = async (session) => {
  if (!Array.isArray(session.lastCandidates) || !session.lastCandidates.length) {
    const { ranked } = await getRankedProperties(session.insights);
    const hasHard = hasHardFilters(session.insights);
    const pool = ranked.length ? ranked : (hasHard ? [] : await getAllNormalizedProperties());
    session.lastCandidates = pool.map(p => p.id);
    session.candidateIndex = 0;
  } else if (session.lastCandidates.length < 2 && !hasHardFilters(session.insights)) {
    const set = new Set(session.lastCandidates);
    const all = await getAllNormalizedProperties();
    for (const p of all) {
      if (!set.has(p.id)) set.add(p.id);
    }
    session.lastCandidates = Array.from(set);
    if (!Number.isInteger(session.candidateIndex)) session.candidateIndex = 0;
  }
};

export const getInteractionMatchCounts = async (session) => {
  const { totalMatches, strictMatches, relaxedMatches } = await getRankedProperties(session.insights);
  return { totalMatches, strictMatches, relaxedMatches };
};

export const buildShowInteractionPayload = async ({ req, session, variantId, counts }) => {
  const list = session.lastCandidates || [];
  const hardFilteredMode = hasHardFilters(session.insights);
  let id = variantId;
  if (!id) {
    if (hardFilteredMode && list.length === 0) {
      return { status: 200, payload: { ok: true, cardId: null, card: null, ...counts, role: session.role } };
    }
    const all = await getAllNormalizedProperties();
    id = list[Number.isInteger(session.candidateIndex) ? session.candidateIndex : 0] || (all[0] && all[0].id);
  }
  const all = await getAllNormalizedProperties();
  const p = all.find(x => x.id === id) || all[0];
  if (!p) return { status: 404, payload: { error: 'Карточка не найдена' } };
  session.candidateIndex = list.indexOf(id);
  if (!session.shownSet) session.shownSet = new Set();
  session.shownSet.add(p.id);
  const scored = annotatePropertyWithScores(p, session.insights || {});
  const card = formatCardForClient(req, scored);
  return { status: 200, payload: { ok: true, cardId: p.id, card, ...counts, role: session.role } };
};

export const buildNextInteractionPayload = async ({ req, session, variantId, counts }) => {
  const list = session.lastCandidates || [];
  const len = list.length;
  if (!len) {
    if (hasHardFilters(session.insights)) {
      return { status: 200, payload: { ok: true, cardId: null, card: null, ...counts, role: session.role } };
    }
    const all = await getAllNormalizedProperties();
    const p = all[0];
    if (!p) return { status: 404, payload: { error: 'Карточка не найдена' } };
    const scored = annotatePropertyWithScores(p, session.insights || {});
    const card = formatCardForClient(req, scored);
    return { status: 200, payload: { ok: true, cardId: p.id, card, ...counts, role: session.role } };
  }

  let idx = list.indexOf(variantId);
  if (idx === -1) {
    idx = Number.isInteger(session.candidateIndex) ? session.candidateIndex : 0;
  }
  if (!session.shownSet) session.shownSet = new Set();

  let steps = 0;
  let nextIndex = (idx + 1) % len;
  let id = list[nextIndex];
  while (steps < len && session.shownSet.has(id)) {
    nextIndex = (nextIndex + 1) % len;
    id = list[nextIndex];
    steps++;
  }

  if (steps >= len) {
    const extended = (await findBestProperties(session.insights, 100)).map(p => p.id);
    const unseen = extended.find(cid => !session.shownSet.has(cid));
    if (unseen) {
      id = unseen;
      const set = new Set(list);
      set.add(id);
      session.lastCandidates = Array.from(set);
    }
  }

  session.candidateIndex = list.indexOf(id);
  const all2 = await getAllNormalizedProperties();
  const p = all2.find(x => x.id === id) || all2[0];
  session.shownSet.add(p.id);
  const scored = annotatePropertyWithScores(p, session.insights || {});
  const card = formatCardForClient(req, scored);
  return { status: 200, payload: { ok: true, cardId: p.id, card, ...counts, role: session.role } };
};

export const buildLikeInteractionPayload = ({ session, variantId, counts }) => {
  session.liked = session.liked || [];
  if (variantId) session.liked.push(variantId);
  const count = session.liked.length;
  const assistantMessage = `Супер, сохранил! Могу предложить записаться на просмотр или показать ещё варианты. Что выберем? (понравилось: ${count})`;
  return { ok: true, assistantMessage, ...counts, role: session.role };
};
