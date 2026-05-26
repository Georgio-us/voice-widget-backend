const toText = (value) => String(value ?? '').trim();

export const normalizeResidentialComplexName = (value) => (
  toText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'`]/g, '')
    .replace(/^(?:жк|зк|жил(?:ой|ого|ому|ом|ые|ых|ыми|ая|ую)?\s+комплекс(?:ы|а|у|е|ом|ах|ами|ов)?|жилкомплекс(?:ы|а|у|е|ом|ах|ами|ов)?)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
);

export const residentialComplexInputToArray = (value) => {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((item) => String(item ?? '').split(','))
    .map((item) => toText(item))
    .filter(Boolean);
};

const uniqueByNormalized = (items) => {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const name = toText(item);
    const norm = normalizeResidentialComplexName(name);
    if (!name || !norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(name);
  }
  return out;
};

export function expandResidentialComplexInput(input, catalogRows = []) {
  const normalizedCatalog = [];
  const seenNorm = new Set();
  
  for (const row of (Array.isArray(catalogRows) ? catalogRows : [])) {
    const name = toText(row?.name ?? row);
    const translations = typeof row === 'object' && row?.nameTranslations ? row.nameTranslations : null;
    const norm = normalizeResidentialComplexName(name);
    
    if (!name || !norm || seenNorm.has(norm)) continue;
    seenNorm.add(norm);
    
    let normRu = null;
    let normUa = null;
    if (translations) {
      try {
        const t = typeof translations === 'string' ? JSON.parse(translations) : translations;
        if (t.ru) normRu = normalizeResidentialComplexName(t.ru);
        if (t.ua) normUa = normalizeResidentialComplexName(t.ua);
      } catch (e) {
        // ignore parse error
      }
    }
    
    normalizedCatalog.push({ name, norm, normRu, normUa });
  }

  const requested = residentialComplexInputToArray(input);
  const matched = [];
  const unmatched = [];

  for (const raw of requested) {
    const norm = normalizeResidentialComplexName(raw);
    if (!norm) continue;

    const exact = normalizedCatalog.filter((row) => 
      row.norm === norm || row.normRu === norm || row.normUa === norm
    );
    if (exact.length > 0) {
      matched.push(...exact.map((row) => row.name));
      continue;
    }

    // Group expansion: "Альтаир" -> "ЖК Альтаир 1", "ЖК Альтаир 2", "ЖК Альтаир 3".
    const matchPrefix = (field) => field && (field.startsWith(`${norm} `) || field.startsWith(`${norm}-`) || field.startsWith(`${norm} №`));
    
    const group = normalizedCatalog.filter((row) => 
      matchPrefix(row.norm) || matchPrefix(row.normRu) || matchPrefix(row.normUa)
    );
    if (group.length > 0) {
      matched.push(...group.map((row) => row.name));
      continue;
    }

    unmatched.push(raw);
  }

  return {
    requested,
    matched: uniqueByNormalized(matched),
    unmatched
  };
}
