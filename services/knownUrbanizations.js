const KNOWN_URBANIZATIONS = [
  {
    canonical: 'La Entrada',
    aliases: ['la entrada', 'entrada', 'ла entrada', 'ла энтрада', 'ла-энтрада', 'ла ентрада', 'ла-ентрада'],
    patterns: [
      /\bla\s*entrada\b/i,
      /\bentrada\b/i,
      /ла[\s-]*энтрад[аеиы]?/i,
      /ла[\s-]*ентрад[аеиы]?/i
    ]
  }
];

const normalizeUrbanizationKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const knownUrbanizationLabels = () => KNOWN_URBANIZATIONS.map((item) => item.canonical);

export const knownUrbanizationAliases = () =>
  KNOWN_URBANIZATIONS.flatMap((item) => [
    [normalizeUrbanizationKey(item.canonical), item.canonical],
    ...(Array.isArray(item.aliases) ? item.aliases : [])
      .map((value) => normalizeUrbanizationKey(value))
      .filter((value) => value.length >= 3)
      .map((value) => [value, item.canonical])
  ]);

export const extractKnownUrbanizations = (...values) => {
  const haystack = values
    .map((value) => String(value || ''))
    .filter(Boolean)
    .join(' ');

  if (!haystack) return [];

  const out = [];
  for (const item of KNOWN_URBANIZATIONS) {
    if (item.patterns.some((pattern) => pattern.test(haystack))) {
      out.push(item.canonical);
    }
  }
  return out;
};
