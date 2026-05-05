import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVideoGenerationPayload,
  buildVideoStatusUrl,
  parseStatusResponse
} from '../src/tools/xai-video.js';

test('buildVideoGenerationPayload builds xAI-compatible video payload', () => {
  const payload = buildVideoGenerationPayload({
    prompt: 'Funny Roblox fail turning into a clutch win',
    model: 'grok-imagine-video',
    durationSeconds: 10,
    aspectRatio: '9:16',
    resolution: '720p'
  });

  assert.deepEqual(payload, {
    model: 'grok-imagine-video',
    prompt: 'Funny Roblox fail turning into a clutch win',
    duration: 10,
    aspect_ratio: '9:16',
    resolution: '720p'
  });
});

test('buildVideoGenerationPayload includes reference-to-video inputs', () => {
  const payload = buildVideoGenerationPayload({
    prompt: 'Subtle dolly in as the avatar backs away from the creeper crater',
    model: 'grok-imagine-video',
    durationSeconds: 10,
    aspectRatio: '9:16',
    resolution: '720p',
    referenceImageUrls: ['https://example.com/ref-1.png', 'https://example.com/ref-2.png']
  });

  assert.deepEqual(payload, {
    model: 'grok-imagine-video',
    prompt: 'Subtle dolly in as the avatar backs away from the creeper crater',
    duration: 10,
    aspect_ratio: '9:16',
    resolution: '720p',
    reference_images: [
      { url: 'https://example.com/ref-1.png' },
      { url: 'https://example.com/ref-2.png' }
    ]
  });
});

test('buildVideoGenerationPayload rejects mixed image and reference inputs', () => {
  assert.throws(() => buildVideoGenerationPayload({
    prompt: 'Funny Roblox fail turning into a clutch win',
    model: 'grok-imagine-video',
    durationSeconds: 10,
    aspectRatio: '9:16',
    resolution: '720p',
    imageUrl: 'data:image/png;base64,AAA',
    referenceImageUrls: ['https://example.com/ref-1.png']
  }), /Cannot specify both 'image' and 'reference_images'/);
});

test('buildVideoStatusUrl uses the xAI status route', () => {
  assert.equal(
    buildVideoStatusUrl('https://api.x.ai/', 'req_123'),
    'https://api.x.ai/v1/videos/req_123'
  );
});

test('parseStatusResponse reads completed video url from xAI status payload', () => {
  const parsed = parseStatusResponse({
    status: 'done',
    video: {
      url: 'https://cdn.x.ai/video.mp4'
    }
  });

  assert.equal(parsed.status, 'done');
  assert.equal(parsed.url, 'https://cdn.x.ai/video.mp4');
});
