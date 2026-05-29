import { getAllProperties } from './propertiesRepository.js';
import { annotatePropertyScoresByContext } from './scoringEngine.js';
import {
  applyHardGateByInsights,
  buildScoreContextFromInsights,
  mapRowToProperty
} from './audioPropertySearchUtils.js';

export const getAllNormalizedProperties = async () => {
  const rows = await getAllProperties();
  return rows.map(mapRowToProperty);
};

const rankPropertiesByInsights = (properties, insights) => {
  const gated = applyHardGateByInsights(properties, insights);
  const scoreContext = buildScoreContextFromInsights(insights);
  const scored = gated.map((p) => {
    const annotated = annotatePropertyScoresByContext(p, scoreContext);
    return {
      p: annotated,
      relaxedScore: Number(annotated?._score ?? 0),
      strictScore: Number(annotated?._strictScore ?? 0),
      tier: String(annotated?._tier || 'low')
    };
  });
  const rankedRows = scored
    .filter(({ relaxedScore }) => relaxedScore > 0)
    .sort((a, b) => b.relaxedScore - a.relaxedScore);
  const strictMatches = scored.filter(({ strictScore }) => strictScore > 0).length;
  const relaxedMatches = rankedRows.length;
  return {
    ranked: rankedRows.map(({ p, relaxedScore, strictScore, tier }) => ({
      ...p,
      _score: relaxedScore,
      _strictScore: strictScore,
      _tier: tier
    })),
    totalMatches: relaxedMatches,
    strictMatches,
    relaxedMatches
  };
};

export const getRankedProperties = async (insights) => {
  const all = await getAllNormalizedProperties();
  return rankPropertiesByInsights(all, insights);
};

export const findBestProperties = async (insights, limit = 1) => {
  const { ranked } = await getRankedProperties(insights);
  return ranked.slice(0, limit);
};
