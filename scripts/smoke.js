import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SOFT = String(process.env.VW_SMOKE_SOFT || '').trim() === '1';
const root = resolve(process.cwd());

const failures = [];
const warnings = [];

const check = (name, fn) => {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    const msg = `${name}: ${error?.message || error}`;
    failures.push(msg);
    console.error(`❌ ${msg}`);
  }
};

const warn = (name, condition, message) => {
  if (condition) return;
  const msg = `${name}: ${message}`;
  warnings.push(msg);
  console.warn(`⚠️ ${msg}`);
};

const nodeCheck = (file) => {
  execFileSync('node', ['--check', resolve(root, file)], { stdio: 'pipe' });
};

console.log('--- Backend smoke start ---');
console.log(`Mode: ${SOFT ? 'soft (non-blocking)' : 'strict (blocking)'}`);

check('Syntax: index.js', () => nodeCheck('index.js'));
check('Syntax: routes/audioRoute.js', () => nodeCheck('routes/audioRoute.js'));
check('Syntax: routes/adminSubscriptionsRoute.js', () => nodeCheck('routes/adminSubscriptionsRoute.js'));
check('Syntax: routes/adminPropertiesRoute.js', () => nodeCheck('routes/adminPropertiesRoute.js'));
check('Syntax: controllers/audioController.js', () => nodeCheck('controllers/audioController.js'));
check('Syntax: services/telegramInitDataService.js', () => nodeCheck('services/telegramInitDataService.js'));

check('SQL exists: 001_stage1_foundation.sql', () => {
  if (!existsSync(resolve(root, 'sql/001_stage1_foundation.sql'))) throw new Error('missing');
});
check('SQL exists: 002_olx_integrations.sql', () => {
  if (!existsSync(resolve(root, 'sql/002_olx_integrations.sql'))) throw new Error('missing');
});
check('SQL exists: 003_client_residential_complexes.sql', () => {
  if (!existsSync(resolve(root, 'sql/003_client_residential_complexes.sql'))) throw new Error('missing');
});
check('SQL exists: 004_specs_area_m2_decimal.sql', () => {
  if (!existsSync(resolve(root, 'sql/004_specs_area_m2_decimal.sql'))) throw new Error('missing');
});
check('SQL exists: 005_subscriptions.sql', () => {
  if (!existsSync(resolve(root, 'sql/005_subscriptions.sql'))) throw new Error('missing');
});

warn('ENV', Boolean(String(process.env.OPENAI_API_KEY || '').trim()), 'OPENAI_API_KEY not set in current shell (ok for CI docs checks)');
warn('ENV', Boolean(String(process.env.CLIENT_ID || '').trim()), 'CLIENT_ID not set in current shell (ok for CI docs checks)');

console.log('--- Backend smoke summary ---');
if (warnings.length) {
  console.log(`Warnings: ${warnings.length}`);
}
if (!failures.length) {
  console.log('Result: PASS');
  process.exit(0);
}

console.error(`Failures: ${failures.length}`);
if (SOFT) {
  console.warn('Soft mode enabled: returning success despite failures.');
  process.exit(0);
}
process.exit(1);
