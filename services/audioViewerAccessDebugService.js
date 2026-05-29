import { readTelegramIdentityFromRequest } from './telegramInitDataService.js';
import { resolveViewerAccessByTgId } from './viewerAccessService.js';

export const resolveViewerAccessForDebug = async (req) => {
  try {
    const identity = readTelegramIdentityFromRequest(req);
    const verifiedTgUserId = identity?.verified?.ok ? String(identity.verified.tgUserId || '').trim() : '';
    if (!verifiedTgUserId) {
      return { accessRole: 'user', isAdmin: false, isSuperAdmin: false, isOwner: false };
    }
    return await resolveViewerAccessByTgId(verifiedTgUserId);
  } catch {
    return { accessRole: 'user', isAdmin: false, isSuperAdmin: false, isOwner: false };
  }
};
