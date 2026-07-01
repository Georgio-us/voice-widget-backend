import { parseAndImportDomstarXml } from '../services/domstarXmlImportService.js';

const url = process.env.DOMSTAR_XML_FEED_URL || undefined;
const clientId = process.env.IMPORT_CLIENT_ID || process.env.CLIENT_ID || 'domstar';

try {
  const stats = await parseAndImportDomstarXml({ url, clientId });
  console.log('[import-domstar-xml] Done:', JSON.stringify(stats, null, 2));
  process.exit(0);
} catch (error) {
  console.error('[import-domstar-xml] Failed:', error);
  process.exit(1);
}
