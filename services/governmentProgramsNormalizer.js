const CYR_E_PREFIX = '[єе]';
const SEP = '\\s*-?\\s*';

const EOS_ELIA_RE = new RegExp(`${CYR_E_PREFIX}${SEP}осел[яі]`, 'iu');
const EVIDNOVLENNIA_RE = new RegExp(`${CYR_E_PREFIX}${SEP}(?:від|вид)новлен{1,2}(?:я|е|ие)?`, 'iu');

const toBool = (value) => {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  const raw = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on', 'так', 'да', 'є', 'есть'].includes(raw);
};

export function detectGovernmentProgramsFromTitle(title = '') {
  const text = String(title || '').trim();
  const eoselia = EOS_ELIA_RE.test(text);
  const evidnovlennia = EVIDNOVLENNIA_RE.test(text);
  return {
    eoselia,
    evidnovlennia,
    governmentProgram: eoselia || evidnovlennia
  };
}

export function detectGovernmentProgramsFromOlxAttributes({ eoselia } = {}) {
  const eoseliaFlag = toBool(eoselia);
  return {
    eoselia: eoseliaFlag,
    evidnovlennia: false,
    governmentProgram: eoseliaFlag
  };
}

export function mergeGovernmentProgramFlags(...sources) {
  const eoselia = sources.some((source) => toBool(source?.eoselia));
  const evidnovlennia = sources.some((source) => toBool(source?.evidnovlennia));
  return {
    eoselia,
    evidnovlennia,
    governmentProgram: eoselia || evidnovlennia,
    governmentPrograms: [
      eoselia ? 'eoselia' : null,
      evidnovlennia ? 'evidnovlennia' : null
    ].filter(Boolean)
  };
}
