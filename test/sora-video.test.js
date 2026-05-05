import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVideoGenerationPayload,
  buildVideoStatusUrl,
  buildVideoContentUrl,
  parseVideoResponse
} from '../src/tools/sora-video.js';

test('buildVideoGenerationPayload builds Sora-compatible payload', () => {
  const payload = buildVideoGenerationPayload({
    prompt: 'Funny Roblox squad chaos with premium UGC hair and a comeback',
    model: 'sora-2',
    seconds: '8',
    size: '720x1280'
  });

  assert.equal(payload.get('model'), 'sora-2');
  assert.equal(payload.get('prompt'), 'Funny Roblox squad chaos with premium UGC hair and a comeback');
  assert.equal(payload.get('seconds'), '8');
  assert.equal(payload.get('size'), '720x1280');
});

test('buildVideoStatusUrl uses the OpenAI videos route', () => {
  assert.equal(
    buildVideoStatusUrl('https://api.openai.com/', 'video_123'),
    'https://api.openai.com/v1/videos/video_123'
  );
});

test('buildVideoContentUrl uses the OpenAI video content route', () => {
  assert.equal(
    buildVideoContentUrl('https://api.openai.com/', 'video_123'),
    'https://api.openai.com/v1/videos/video_123/content'
  );
});

test('parseVideoResponse reads progress from Sora video payload', () => {
  const parsed = parseVideoResponse({
    id: 'video_123',
    status: 'in_progress',
    progress: 67,
    model: 'sora-2',
    seconds: '8',
    size: '720x1280'
  });

  assert.equal(parsed.id, 'video_123');
  assert.equal(parsed.status, 'in_progress');
  assert.equal(parsed.progress, 67);
  assert.equal(parsed.model, 'sora-2');
});
