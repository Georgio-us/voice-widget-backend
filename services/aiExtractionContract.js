export const INSIGHTS_RESPONSE_SCHEMA = {
  name: 'insights_response',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['assistant_text', 'insights'],
    properties: {
      assistant_text: { type: 'string' },
      insights: {
        type: 'object',
        additionalProperties: false,
        required: [
          'name', 'operation', 'budget', 'budgetMax', 'type', 'district', 'location', 'rooms',
          'area', 'areaMin', 'areaMax', 'floor', 'features', 'details', 'preferences',
          'residentialComplex', 'floorNotFirst', 'floorNotLast',
          'rcOnly', 'parking', 'balconyLoggia', 'arcadia', 'center', 'smart'
        ],
        properties: {
          name: { type: ['string', 'null'] },
          operation: { type: ['string', 'null'], enum: ['buy', 'rent', null] },
          budget: { type: ['number', 'string', 'null'] },
          budgetMax: { type: ['number', 'string', 'null'] },
          type: { type: ['string', 'null'], enum: ['apartment', 'house', 'land', 'commercial', null] },
          district: {
            type: ['string', 'array', 'null'],
            items: { type: 'string' }
          },
          location: {
            type: ['string', 'array', 'null'],
            items: { type: 'string' }
          },
          rooms: {
            type: ['number', 'string', 'array', 'null'],
            items: { type: ['number', 'string'] }
          },
          area: { type: ['number', 'string', 'null'] },
          areaMin: { type: ['number', 'string', 'null'] },
          areaMax: { type: ['number', 'string', 'null'] },
          floor: { type: ['number', 'string', 'null'] },
          features: {
            type: ['array', 'null'],
            items: { type: 'string' }
          },
          details: { type: ['string', 'null'] },
          preferences: { type: ['string', 'null'] },
          residentialComplex: {
            type: ['string', 'array', 'null'],
            items: { type: 'string' }
          },
          floorNotFirst: { type: ['boolean', 'null'] },
          floorNotLast: { type: ['boolean', 'null'] },
          rcOnly: { type: ['boolean', 'null'] },
          parking: { type: ['boolean', 'null'] },
          balconyLoggia: { type: ['boolean', 'null'] },
          arcadia: { type: ['boolean', 'null'] },
          center: { type: ['boolean', 'null'] },
          smart: { type: ['boolean', 'null'] }
        }
      }
    }
  },
  strict: true
};

export const parseStructuredInsightsResponse = (content) => {
  const fail = { assistantText: null, meta: null, raw: content ?? null, parseError: true };
  if (typeof content !== 'string' || !content.trim()) return fail;
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') return fail;
    const assistantText = typeof parsed.assistant_text === 'string' ? parsed.assistant_text.trim() : '';
    const insights = parsed.insights && typeof parsed.insights === 'object' ? parsed.insights : null;
    if (!assistantText || !insights) return fail;
    return {
      assistantText,
      meta: { insights },
      raw: content,
      parseError: false
    };
  } catch {
    return fail;
  }
};
