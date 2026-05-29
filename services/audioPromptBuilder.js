import { buildDemoCatalogContext, buildDemoPromptFlavorContext } from './demoCatalogContextService.js';
import { buildLanguageLockPrompt } from './audioLanguagePolicy.js';
import { listResidentialComplexes } from './residentialComplexesRepository.js';
import { BASE_SYSTEM_PROMPT } from './personality.js';

const formatResidentialComplexCatalog = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  return rows.map((row) => {
    const aliases = new Set();
    if (row.nameTranslations) {
      try {
        const translations = typeof row.nameTranslations === 'string'
          ? JSON.parse(row.nameTranslations)
          : row.nameTranslations;
        if (translations.ru && translations.ru !== row.name) aliases.add(translations.ru);
        if (translations.ua && translations.ua !== row.name) aliases.add(translations.ua);
      } catch {}
    }
    const aliasesStr = aliases.size > 0 ? ` (${Array.from(aliases).join('/')})` : '';
    return `${row.name}${aliasesStr}`;
  }).join(', ');
};

export const buildAudioStructuredMessages = async ({
  session,
  targetLang,
  clientId,
  logger = console
} = {}) => {
  const promptClientId = String(clientId || process.env.CLIENT_ID || 'georgio-us').trim();
  let rcCatalogStr = '';
  try {
    const rcs = await listResidentialComplexes(promptClientId, { limit: 200 });
    rcCatalogStr = formatResidentialComplexCatalog(rcs);
  } catch (error) {
    logger?.warn?.('Failed to load RC catalog for prompt:', error);
  }

  const demoCatalogContext = await buildDemoCatalogContext(promptClientId);
  const demoCatalogContextBlock = demoCatalogContext?.content
    ? `\n${demoCatalogContext.content}\n`
    : '';
  const demoPromptFlavorContext = buildDemoPromptFlavorContext(promptClientId);
  const demoPromptFlavorContextBlock = demoPromptFlavorContext?.content
    ? `\n${demoPromptFlavorContext.content}\n`
    : '';

  const baseSystemPrompt = BASE_SYSTEM_PROMPT.replace(
    '{{RC_CATALOG}}',
    rcCatalogStr ? `\nAVAILABLE RESIDENTIAL COMPLEXES (CATALOG):\n${rcCatalogStr}\n` : ''
  ) + demoCatalogContextBlock + demoPromptFlavorContextBlock;

  const metaRepairHint = session?.metaContract?.needsRepairHint === true
    ? {
        role: 'system',
        content: 'Contract reminder: return valid JSON matching the insights_response schema.'
      }
    : null;

  const dialogMessages = Array.isArray(session?.messages)
    ? session.messages.filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant'))
    : [];

  return {
    messages: [
      {
        role: 'system',
        content: baseSystemPrompt
      },
      {
        role: 'system',
        content: buildLanguageLockPrompt(targetLang)
      },
      ...(metaRepairHint ? [metaRepairHint] : []),
      ...dialogMessages
    ],
    demoCatalogContext,
    demoPromptFlavorContext
  };
};
