import test from 'node:test';
import assert from 'node:assert/strict';

import { buildImageGenerationPayload } from '../src/tools/xai-image.js';

test('buildImageGenerationPayload builds xAI-compatible image payload', () => {
  const payload = buildImageGenerationPayload({
    prompt: 'Minecraft creeper crater start frame, rear follow, bright in-game lighting',
    model: 'grok-imagine-image',
    aspectRatio: '9:16'
  });

  assert.deepEqual(payload, {
    model: 'grok-imagine-image',
    prompt: 'Minecraft creeper crater start frame, rear follow, bright in-game lighting',
    aspect_ratio: '9:16'
  });
});
