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
check('Syntax: services/audioAssistantMetaParser.js', () => nodeCheck('services/audioAssistantMetaParser.js'));
check('Syntax: services/audioAllowedFactsService.js', () => nodeCheck('services/audioAllowedFactsService.js'));
check('Syntax: services/audioCardFormatter.js', () => nodeCheck('services/audioCardFormatter.js'));
check('Syntax: services/audioConversationLoggingService.js', () => nodeCheck('services/audioConversationLoggingService.js'));
check('Syntax: services/audioDebugUtils.js', () => nodeCheck('services/audioDebugUtils.js'));
check('Syntax: services/audioErrorResponseService.js', () => nodeCheck('services/audioErrorResponseService.js'));
check('Syntax: services/audioExtractionMetrics.js', () => nodeCheck('services/audioExtractionMetrics.js'));
check('Syntax: services/audioHandoffStateService.js', () => nodeCheck('services/audioHandoffStateService.js'));
check('Syntax: services/audioInsightsProgressService.js', () => nodeCheck('services/audioInsightsProgressService.js'));
check('Syntax: services/audioInputService.js', () => nodeCheck('services/audioInputService.js'));
check('Syntax: services/audioInteractionDebugService.js', () => nodeCheck('services/audioInteractionDebugService.js'));
check('Syntax: services/audioInteractionNavigationService.js', () => nodeCheck('services/audioInteractionNavigationService.js'));
check('Syntax: services/audioInteractionStateService.js', () => nodeCheck('services/audioInteractionStateService.js'));
check('Syntax: services/audioLanguagePolicy.js', () => nodeCheck('services/audioLanguagePolicy.js'));
check('Syntax: services/audioMiniAppOpenService.js', () => nodeCheck('services/audioMiniAppOpenService.js'));
check('Syntax: services/audioMetaInsightsApplier.js', () => nodeCheck('services/audioMetaInsightsApplier.js'));
check('Syntax: services/audioMetaProcessingService.js', () => nodeCheck('services/audioMetaProcessingService.js'));
check('Syntax: services/audioPostHandoffEnrichment.js', () => nodeCheck('services/audioPostHandoffEnrichment.js'));
check('Syntax: services/audioPromptBuilder.js', () => nodeCheck('services/audioPromptBuilder.js'));
check('Syntax: services/audioPropertySearchService.js', () => nodeCheck('services/audioPropertySearchService.js'));
check('Syntax: services/audioPropertySearchUtils.js', () => nodeCheck('services/audioPropertySearchUtils.js'));
check('Syntax: services/audioReferenceIntentService.js', () => nodeCheck('services/audioReferenceIntentService.js'));
check('Syntax: services/audioReferencePipelineService.js', () => nodeCheck('services/audioReferencePipelineService.js'));
check('Syntax: services/audioRequestBootstrapService.js', () => nodeCheck('services/audioRequestBootstrapService.js'));
check('Syntax: services/audioResponsePayloadService.js', () => nodeCheck('services/audioResponsePayloadService.js'));
check('Syntax: services/audioSessionActivityFinalizer.js', () => nodeCheck('services/audioSessionActivityFinalizer.js'));
check('Syntax: services/audioSessionCleanupService.js', () => nodeCheck('services/audioSessionCleanupService.js'));
check('Syntax: services/audioSessionInfoService.js', () => nodeCheck('services/audioSessionInfoService.js'));
check('Syntax: services/audioSessionRoleService.js', () => nodeCheck('services/audioSessionRoleService.js'));
check('Syntax: services/audioSessionStore.js', () => nodeCheck('services/audioSessionStore.js'));
check('Syntax: services/audioStructuredLlmService.js', () => nodeCheck('services/audioStructuredLlmService.js'));
check('Syntax: services/audioUiDecisionService.js', () => nodeCheck('services/audioUiDecisionService.js'));
check('Syntax: services/audioUserStatsService.js', () => nodeCheck('services/audioUserStatsService.js'));
check('Syntax: services/audioVerbalSelectService.js', () => nodeCheck('services/audioVerbalSelectService.js'));
check('Syntax: services/audioViewerAccessDebugService.js', () => nodeCheck('services/audioViewerAccessDebugService.js'));
check('Syntax: services/openAiRetryService.js', () => nodeCheck('services/openAiRetryService.js'));
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
