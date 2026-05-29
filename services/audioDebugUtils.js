export const DEPLOY_TAG_FULL = process.env.DEPLOY_TAG || process.env.RAILWAY_GIT_COMMIT_SHA || 'unknown';
export const DEPLOY_TAG_SHORT = (() => {
  const t = String(DEPLOY_TAG_FULL || 'unknown');
  if (t.length <= 8) return t;
  return t.slice(-8);
})();

let BUILD_LOGGED = false;

export const getDeployShortOrNull = () => (
  DEPLOY_TAG_FULL && DEPLOY_TAG_FULL !== 'unknown' ? DEPLOY_TAG_SHORT : null
);

export const logBuildOnce = () => {
  if (BUILD_LOGGED) return;
  BUILD_LOGGED = true;
  console.log(`[BUILD] deploy=${DEPLOY_TAG_FULL}`);
};

export const isClientDebugEnabled = (req) => {
  const envOn = String(process.env.VW_DEBUG_CLIENT || '').trim() === '1';
  const headerOn = String(req?.headers?.['x-vw-debug'] || '').trim() === '1';
  return envOn && headerOn;
};

export const clip = (str, n = 80) => {
  if (str === null || str === undefined) return '';
  const s = String(str);
  if (s.length <= n) return s;
  return s.slice(0, n);
};

export const normalizeForClientDebug = (text) => {
  if (!text || typeof text !== 'string') return '';
  return String(text)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const extractSpokeCardId = (text) => {
  if (!text || typeof text !== 'string') return { cardId: null, confidence: 'none' };
  const matches = String(text).match(/\bA\d{3}\b/g) || [];
  const uniq = Array.from(new Set(matches));
  if (uniq.length === 1) return { cardId: uniq[0], confidence: 'exact' };
  return { cardId: null, confidence: 'none' };
};

export const getLatestMatchRuleId = (session) => {
  const items = session?.debugTrace?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it && it.type === 'reference_detected') {
      return it?.payload?.matchRuleId || null;
    }
  }
  return null;
};
