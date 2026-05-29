import {
  notifyNewTelegramUserToTelegram
} from './telegramNotifier.js';
import {
  notifyNewTelegramUserToProjectTelegram
} from './projectTelegramNotifier.js';
import { readTelegramIdentityFromRequest } from './telegramInitDataService.js';
import { getUsersJoinStats } from './audioUserStatsService.js';
import { upsertTelegramUser } from './usersRepository.js';

export const handleAudioMiniAppOpen = async ({ req, res, clientId }) => {
  try {
    const identity = readTelegramIdentityFromRequest(req);
    const verifiedTgUserId = identity?.verified?.ok ? String(identity.verified.tgUserId || '').trim() : '';
    const body = req.body || {};
    const tgUserId = verifiedTgUserId || String(body?.tgUserId || '').trim();
    if (!tgUserId) {
      return res.status(400).json({ ok: false, error: 'TG_USER_ID_REQUIRED' });
    }

    const upsertResult = await upsertTelegramUser({
      clientId,
      tgUserId,
      username: body?.tgUsername || null,
      firstName: body?.tgFirstName || null,
      lastName: body?.tgLastName || null,
      languageCode: body?.tgLanguageCode || null,
      meta: {
        source: 'tg_mini_app_open',
        ...(body?.startParam ? { startParam: String(body.startParam) } : {})
      }
    });

    let notified = false;
    if (upsertResult?.isNew === true) {
      const stats = await getUsersJoinStats(clientId);
      const payload = {
        tgUserId,
        username: body?.tgUsername || null,
        firstName: body?.tgFirstName || null,
        lastName: body?.tgLastName || null,
        totalUsers: Number.isFinite(stats?.totalUsers) ? stats.totalUsers : null,
        usersToday: Number.isFinite(stats?.usersToday) ? stats.usersToday : null,
        at: Date.now()
      };
      await Promise.allSettled([
        notifyNewTelegramUserToTelegram(payload),
        notifyNewTelegramUserToProjectTelegram(payload)
      ]);
      notified = true;
    }

    return res.json({
      ok: true,
      isNew: upsertResult?.isNew === true,
      notified
    });
  } catch (error) {
    console.error('❌ /api/audio/miniapp-open error:', error);
    return res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
};
