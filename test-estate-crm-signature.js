import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { canonicalSignatureInput, isFreshIntegrationTimestamp, signIntegrationRequest } from './services/estateCrmIntegrationService.js';

const timestamp = String(Date.now());
const request = {
  credential: 'test-shared-credential',
  timestamp,
  connectionId: '11111111-1111-4111-8111-111111111111',
  method: 'POST',
  pathname: '/integrations/via/events',
  search: '',
  rawBody: JSON.stringify({ eventId: 'event-1', type: 'selection.opened' })
};
const canonical = canonicalSignatureInput(request);
const expected = crypto.createHmac('sha256', request.credential).update(canonical).digest('base64url');

assert.equal(isFreshIntegrationTimestamp(timestamp, Number(timestamp)), true);
assert.equal(isFreshIntegrationTimestamp(String(Number(timestamp) - 5 * 60 * 1000 - 1), Number(timestamp)), false);
assert.equal(signIntegrationRequest(request), expected);
console.log('Estate CRM signature contract: OK');
