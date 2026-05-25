import { parseAndImportXml } from './services/xmlImportService.js';

const url = 'https://nera.nera.ua/UNION_BASE/AnUkraine/est/helping_rem.xml';
const clientId = 'test';

async function run() {
  try {
    await parseAndImportXml(url, clientId);
    process.exit(0);
  } catch (error) {
    console.error('Failed to run xml import:', error);
    process.exit(1);
  }
}

run();
