import { upsertSessionLog } from './sessionLogger.js';
import {
  sendSessionActivityStartToTelegram
} from './telegramNotifier.js';
import {
  sendSessionActivityStartToProjectTelegram
} from './projectTelegramNotifier.js';

export const getAudioRequestNetworkMeta = (req) => ({
  userIp: req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.connection?.remoteAddress || null,
  userAgent: req.headers['user-agent'] || null
});

const readHeader = (req, key) => {
  try {
    return req?.headers?.[key] || req?.headers?.[String(key || '').toLowerCase()] || null;
  } catch {
    return null;
  }
};

const getRequestGeo = (req) => {
  const country =
    (readHeader(req, 'cf-ipcountry') || readHeader(req, 'x-vercel-ip-country') || readHeader(req, 'x-country') || readHeader(req, 'x-geo-country') || null);
  const city =
    (readHeader(req, 'x-vercel-ip-city') || readHeader(req, 'x-city') || readHeader(req, 'x-geo-city') || readHeader(req, 'cf-ipcity') || null);
  return {
    ...(country ? { country: String(country).trim() } : {}),
    ...(city ? { city: String(city).trim() } : {})
  };
};

const getTelegramUserFromBody = (body = {}) => {
  const tgUser = {
    userId: body?.tgUserId ? String(body.tgUserId).trim() : null,
    username: body?.tgUsername ? String(body.tgUsername).trim() : null,
    firstName: body?.tgFirstName ? String(body.tgFirstName).trim() : null,
    lastName: body?.tgLastName ? String(body.tgLastName).trim() : null
  };
  const hasTgUser = Object.values(tgUser).some((v) => String(v || '').trim().length > 0);
  return { tgUser, hasTgUser };
};

export const initializeNewAudioSessionSideEffects = ({ req, session, sessionId, userIp, userAgent }) => {
  try {
    const { tgUser, hasTgUser } = getTelegramUserFromBody(req.body || {});
    const geo = getRequestGeo(req);

    if (hasTgUser) {
      session.telegramUser = {
        ...(tgUser.userId ? { userId: tgUser.userId } : {}),
        ...(tgUser.username ? { username: tgUser.username } : {}),
        ...(tgUser.firstName ? { firstName: tgUser.firstName } : {}),
        ...(tgUser.lastName ? { lastName: tgUser.lastName } : {})
      };
    }

    upsertSessionLog({
      sessionId,
      userAgent,
      userIp,
      payloadPatch: {
        sessionMeta: {
          ...(hasTgUser ? { telegramUser: session.telegramUser } : {})
        }
      }
    }).catch(() => {});

    session.geo = geo && (geo.country || geo.city) ? geo : null;
    session.telegram = session.telegram || {};
    sendSessionActivityStartToTelegram({
      sessionId: session.sessionId || sessionId,
      startedAt: session.createdAt,
      geo: session.geo,
      telegramUser: session.telegramUser || null,
      messageCount: Array.isArray(session.messages) ? session.messages.length : 0
    })
      .then((r) => {
        if (r?.ok === true && r?.messageId) {
          session.telegram.activityMessageId = r.messageId;
          session.telegram.activityMessageAt = Date.now();
        }
      })
      .catch(() => {});

    session.telegramProject = session.telegramProject || {};
    sendSessionActivityStartToProjectTelegram({
      sessionId: session.sessionId || sessionId,
      startedAt: session.createdAt,
      geo: session.geo,
      telegramUser: session.telegramUser || null,
      messageCount: Array.isArray(session.messages) ? session.messages.length : 0
    })
      .then((r) => {
        if (r?.ok === true && r?.messageIds && typeof r.messageIds === 'object') {
          session.telegramProject.activityMessageIds = { ...r.messageIds };
          session.telegramProject.activityMessageAt = Date.now();
        }
      })
      .catch(() => {});
  } catch {}
};
