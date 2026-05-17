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
  const catalogNames = uniqueByNormalized(
    (Array.isArray(catalogRows) ? catalogRows : []).map((row) => row?.name ?? row)
  );
  const normalizedCatalog = catalogNames.map((name) => ({
    name,
    norm: normalizeResidentialComplexName(name)
  })).filter((row) => row.norm);

  const requested = residentialComplexInputToArray(input);
  const matched = [];
  const unmatched = [];

  for (const raw of requested) {
    const norm = normalizeResidentialComplexName(raw);
    if (!norm) continue;

    const exact = normalizedCatalog.filter((row) => row.norm === norm);
    if (exact.length > 0) {
      matched.push(...exact.map((row) => row.name));
      continue;
    }

    // Group expansion: "Альтаир" -> "ЖК Альтаир 1", "ЖК Альтаир 2", "ЖК Альтаир 3".
    const group = normalizedCatalog.filter((row) => (
      row.norm.startsWith(`${norm} `)
      || row.norm.startsWith(`${norm}-`)
      || row.norm.startsWith(`${norm} №`)
    ));
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
