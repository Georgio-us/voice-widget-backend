import crypto from 'crypto';

const DEFAULT_CLIENT_ID = 'demo';
const STATE_TTL_MS = 10 * 60 * 1000;

const normalize = (value) => String(value || '').trim();

const splitCsv = (value) =>
  normalize(value)
    .split(',')
    .map((item) => normalize(item))
    .filter(Boolean);

const toOrigin = (value) => {
  const raw = normalize(value);
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).origin;
    }
  } catch {}
  return raw.replace(/\/+$/, '');
};

const fromBase64Url = (value) => {
  const input = normalize(value);
  if (!input) return '';
  const withPadding = input + '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(withPadding.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
};

const toBase64Url = (value) =>
  Buffer.from(String(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const toSecureHex = (size = 24) => crypto.randomBytes(size).toString('hex');
const parseBool = (value, fallback = false) => {
  const raw = normalize(value).toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
};

export function resolveClientId(rawClientId) {
  const fromQuery = normalize(rawClientId);
  const fromEnv = normalize(process.env.BOT_CLIENT_ID);
  return fromQuery || fromEnv || DEFAULT_CLIENT_ID;
}

export function resolveAllowedFrontendOrigins() {
  const values = [
    ...splitCsv(process.env.FRONTEND_URL),
    ...splitCsv(process.env.FRONTEND_URLS)
  ];
  const origins = values.map(toOrigin).filter(Boolean);
  return new Set(origins);
}

export function isAdminTgUser(tgUserIdRaw) {
  const tgUserId = normalize(tgUserIdRaw);
  if (!tgUserId) return false;
  const owner = normalize(process.env.OWNER_TG_ID);
  const superAdmin = normalize(process.env.SUPER_ADMIN_ID);
  return Boolean((owner && tgUserId === owner) || (superAdmin && tgUserId === superAdmin));
}

export function getOlxConfig() {
  const config = {
    authUrl: normalize(process.env.OLX_AUTH_URL),
    tokenUrl: normalize(process.env.OLX_TOKEN_URL),
    clientId: normalize(process.env.OLX_CLIENT_ID),
    clientSecret: normalize(process.env.OLX_CLIENT_SECRET),
    redirectUri: normalize(process.env.OLX_REDIRECT_URI),
    scopes: normalize(process.env.OLX_SCOPES),
    stateSecret: normalize(process.env.OLX_STATE_SECRET)
  };
  const missing = Object.entries(config)
    .filter(([key, value]) => !value && key !== 'scopes')
    .map(([key]) => key);
  return { config, missing };
}

function signStatePayload(payloadBase64, secret) {
  return crypto.createHmac('sha256', secret).update(payloadBase64).digest('hex');
}

function sanitizeReturnTo(rawReturnTo) {
  const value = normalize(rawReturnTo);
  if (!value) return '';
  try {
    const url = new URL(value);
    const allowedOrigins = resolveAllowedFrontendOrigins();
    const hubMapPresent = normalize(process.env.CLIENT_BACKEND_MAP).length > 0;
    const allowAny = parseBool(process.env.OLX_ALLOW_ANY_RETURN_TO, hubMapPresent);
    if (!allowedOrigins.size) {
      if (!allowAny) return '';
      if (!/^https?:$/i.test(url.protocol)) return '';
      return url.toString();
    }
    if (!allowedOrigins.has(url.origin)) {
      if (!allowAny) return '';
      if (!/^https?:$/i.test(url.protocol)) return '';
      return url.toString();
    }
    return url.toString();
  } catch {
    return '';
  }
}

export function createStateToken({
  clientId,
  tgUserId,
  returnTo,
  nonce = toSecureHex(12)
}) {
  const stateSecret = normalize(process.env.OLX_STATE_SECRET);
  if (!stateSecret) {
    throw new Error('OLX_STATE_SECRET_MISSING');
  }

  const now = Date.now();
  const payload = {
    clientId: resolveClientId(clientId),
    tgUserId: normalize(tgUserId),
    returnTo: sanitizeReturnTo(returnTo) || null,
    iat: now,
    exp: now + STATE_TTL_MS,
    nonce
  };

  const payloadBase64 = toBase64Url(JSON.stringify(payload));
  const signature = signStatePayload(payloadBase64, stateSecret);
  return `${payloadBase64}.${signature}`;
}

export function verifyStateToken(rawState) {
  const state = normalize(rawState);
  const stateSecret = normalize(process.env.OLX_STATE_SECRET);
  if (!stateSecret) {
    throw new Error('OLX_STATE_SECRET_MISSING');
  }
  if (!state.includes('.')) {
    throw new Error('STATE_INVALID_FORMAT');
  }
  const [payloadBase64, signature] = state.split('.');
  const expected = signStatePayload(payloadBase64, stateSecret);
  if (!signature || signature !== expected) {
    throw new Error('STATE_BAD_SIGNATURE');
  }
  let payload;
  try {
    payload = JSON.parse(fromBase64Url(payloadBase64));
  } catch {
    throw new Error('STATE_INVALID_PAYLOAD');
  }
  const now = Date.now();
  if (!payload?.exp || Number(payload.exp) < now) {
    throw new Error('STATE_EXPIRED');
  }
  return payload;
}

export function buildOlxAuthorizeUrl({
  clientId,
  tgUserId,
  returnTo
}) {
  const { config, missing } = getOlxConfig();
  if (missing.length) {
    throw new Error(`OLX_CONFIG_MISSING:${missing.join(',')}`);
  }
  const state = createStateToken({ clientId, tgUserId, returnTo });
  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', config.redirectUri);
  if (config.scopes) {
    url.searchParams.set('scope', config.scopes);
  }
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCodeForTokens(code) {
  const { config, missing } = getOlxConfig();
  if (missing.length) {
    throw new Error(`OLX_CONFIG_MISSING:${missing.join(',')}`);
  }
  const normalizedCode = normalize(code);
  if (!normalizedCode) {
    throw new Error('MISSING_AUTHORIZATION_CODE');
  }

  const body = {
    grant_type: 'authorization_code',
    code: normalizedCode,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    ...(config.scopes ? { scope: config.scopes } : {})
  };

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const details = parsed?.error_description || parsed?.error || responseText || `HTTP_${response.status}`;
    throw new Error(`OLX_TOKEN_EXCHANGE_FAILED:${details}`);
  }

  return parsed && typeof parsed === 'object' ? parsed : {};
}

export async function refreshAccessToken(refreshToken) {
  const { config, missing } = getOlxConfig();
  if (missing.length) {
    throw new Error(`OLX_CONFIG_MISSING:${missing.join(',')}`);
  }
  const normalizedRefreshToken = normalize(refreshToken);
  if (!normalizedRefreshToken) {
    throw new Error('MISSING_REFRESH_TOKEN');
  }

  const body = {
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: normalizedRefreshToken
  };

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const responseText = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const details = parsed?.error_description || parsed?.error || responseText || `HTTP_${response.status}`;
    throw new Error(`OLX_TOKEN_REFRESH_FAILED:${details}`);
  }

  return parsed && typeof parsed === 'object' ? parsed : {};
}

export function buildFrontendRedirect({
  returnTo,
  status,
  reason = ''
}) {
  const fallbackOrigin = splitCsv(process.env.FRONTEND_URL)[0] || '';
  const fallback = fallbackOrigin ? `${fallbackOrigin.replace(/\/+$/, '')}/` : '/';
  const target = sanitizeReturnTo(returnTo) || fallback;
  const url = new URL(target, 'http://localhost');
  url.searchParams.set('olx', normalize(status) || 'failed');
  if (reason) {
    url.searchParams.set('olx_reason', normalize(reason).slice(0, 160));
  }
  if (url.origin === 'http://localhost' && target === '/') {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.toString();
}
