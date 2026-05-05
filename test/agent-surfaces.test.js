import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentManifest,
  buildConnectionStatus,
  buildPrivacyAudit
} from '../src/services/agent-surfaces.js';

test('Short video agent manifest exposes provider-neutral generation tools', () => {
  const manifest = buildAgentManifest({ client: 'openclaw' });

  assert.equal(manifest.project, 'short-video-agent-kit');
  assert.equal(manifest.client, 'openclaw');
  assert.ok(manifest.supported_clients.includes('codex'));
  assert.ok(manifest.standard_tools.includes('short_video_generate'));
  assert.ok(manifest.providers.includes('openai_sora'));
  assert.ok(manifest.providers.includes('gemini_veo'));
});

test('Short video connection status reports each provider without leaking keys', () => {
  const status = buildConnectionStatus({
    env: {
      OPENAI_API_KEY: 'sk-hidden',
      GEMINI_API_KEY: '',
      XAI_API_KEY: '',
      PIAPI_KEY: ''
    }
  });

  assert.equal(status.providers.openai_sora.configured, true);
  assert.equal(status.providers.gemini_veo.configured, false);
  assert.doesNotMatch(JSON.stringify(status), /sk-hidden/);
});

test('Short video privacy audit requires explicit user-owned assets and no prompt logging', () => {
  const audit = buildPrivacyAudit();

  assert.equal(audit.secrets_returned_to_agent, false);
  assert.ok(audit.external_services.includes('OpenAI Videos API'));
  assert.ok(audit.safety_rules.some((rule) => /user-owned/i.test(rule)));
});
