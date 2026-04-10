import crypto from 'crypto';

const normalize = (value) => String(value || '').trim();

const parseBool = (value, fallback) => {
  const raw = normalize(value).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
};

const isProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

const TELEGRAM_ENFORCE_ADMIN_INITDATA = parseBool(
  process.env.TELEGRAM_INITDATA_ENFORCE_ADMIN,
  isProd
);

const TELEGRAM_ALLOW_LEGACY_TGID = parseBool(
  process.env.TELEGRAM_INITDATA_ALLOW_LEGACY_TGID,
  !TELEGRAM_ENFORCE_ADMIN_INITDATA
);

const AuthError = class extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
};

const extractInitData = (req) => {
  const fromHeader = normalize(req.headers?.['x-telegram-init-data']);
  if (fromHeader) return fromHeader;
  const fromHeaderAlt = normalize(req.headers?.['x-telegram-initdata']);
  if (fromHeaderAlt) return fromHeaderAlt;
  const fromBody = normalize(req.body?.initData);
  if (fromBody) return fromBody;
  const fromQuery = normalize(req.query?.initData);
  if (fromQuery) return fromQuery;
  return '';
};

const extractLegacyTgUserId = (req) =>
  normalize(req.body?.tgUserId || req.query?.tgUserId);

const safeCompare = (aHex, bHex) => {
  if (!aHex || !bHex) return false;
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const verifyTelegramInitData = (initDataRaw) => {
  const initData = normalize(initDataRaw);
  if (!initData) {
    return { ok: false, code: 'TELEGRAM_INITDATA_REQUIRED' };
  }

  const botToken = normalize(process.env.TELEGRAM_BOT_TOKEN);
  if (!botToken) {
    return { ok: false, code: 'TELEGRAM_BOT_TOKEN_REQUIRED' };
  }

  const params = new URLSearchParams(initData);
  const hash = normalize(params.get('hash'));
  if (!hash) {
    return { ok: false, code: 'TELEGRAM_INITDATA_HASH_MISSING' };
  }

  const pairs = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort((a, b) => a.localeCompare(b));
  const dataCheckString = pairs.join('\n');

  const secret = crypto
    .createHmac('sha256', 'WebAppData')
    .update(botToken)
    .digest();
  const computed = crypto
    .createHmac('sha256', secret)
    .update(dataCheckString)
    .digest('hex');

  if (!safeCompare(computed, hash)) {
    return { ok: false, code: 'TELEGRAM_INITDATA_INVALID' };
  }

  let user = null;
  try {
    user = JSON.parse(params.get('user') || '{}');
  } catch {
    return { ok: false, code: 'TELEGRAM_INITDATA_USER_PARSE_FAILED' };
  }

  const tgUserId = normalize(user?.id);
  if (!tgUserId) {
    return { ok: false, code: 'TELEGRAM_INITDATA_USER_MISSING' };
  }

  return {
    ok: true,
    tgUserId,
    user
  };
};

export const readTelegramIdentityFromRequest = (req) => {
  const initData = extractInitData(req);
  const legacyTgUserId = extractLegacyTgUserId(req);
  const verified = initData ? verifyTelegramInitData(initData) : null;
  return {
    initDataPresent: Boolean(initData),
    legacyTgUserId,
    verified
  };
};

export const resolveTgUserIdForAccess = (req) => {
  const identity = readTelegramIdentityFromRequest(req);
  const verifiedUserId = identity?.verified?.ok ? normalize(identity.verified.tgUserId) : '';
  if (verifiedUserId) {
    return {
      tgUserId: verifiedUserId,
      source: 'telegram_init_data_verified',
      identity
    };
  }

  if (TELEGRAM_ENFORCE_ADMIN_INITDATA) {
    if (TELEGRAM_ALLOW_LEGACY_TGID && identity.legacyTgUserId) {
      return {
        tgUserId: identity.legacyTgUserId,
        source: 'legacy_tgUserId_fallback',
        identity
      };
    }
    const code = identity?.verified?.code || (identity.initDataPresent ? 'TELEGRAM_INITDATA_INVALID' : 'TELEGRAM_INITDATA_REQUIRED');
    throw new AuthError(code);
  }

  return {
    tgUserId: identity.legacyTgUserId || '',
    source: identity.legacyTgUserId ? 'legacy_tgUserId' : 'anonymous',
    identity
  };
};

export const toHttpAuthError = (error) => {
  const code = String(error?.code || error?.message || '').trim();
  if (
    code === 'TELEGRAM_INITDATA_REQUIRED' ||
    code === 'TELEGRAM_INITDATA_INVALID' ||
    code === 'TELEGRAM_INITDATA_HASH_MISSING' ||
    code === 'TELEGRAM_INITDATA_USER_MISSING' ||
    code === 'TELEGRAM_INITDATA_USER_PARSE_FAILED'
  ) {
    return { status: 401, body: { ok: false, error: code } };
  }
  if (code === 'TELEGRAM_BOT_TOKEN_REQUIRED') {
    return { status: 500, body: { ok: false, error: code } };
  }
  return null;
};

