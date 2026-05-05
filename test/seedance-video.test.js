import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVideoGenerationPayload,
  buildTaskStatusUrl,
  extractTaskVideoUrl,
  normalizeSeedanceDuration,
  parseTaskStatusResponse
} from '../src/tools/seedance-video.js';

test('buildVideoGenerationPayload builds Seedance-compatible payload', () => {
  const payload = buildVideoGenerationPayload({
    prompt: 'Funny Roblox duo fail becomes a clutch comeback',
    model: 'seedance-2-fast-preview',
    durationSeconds: 8,
    aspectRatio: '9:16'
  });

  assert.deepEqual(payload, {
    model: 'seedance',
    task_type: 'seedance-2-fast-preview',
    input: {
      prompt: 'Funny Roblox duo fail becomes a clutch comeback',
      aspect_ratio: '9:16',
      duration: 10
    }
  });
});

test('buildVideoGenerationPayload includes webhook config when provided', () => {
  const payload = buildVideoGenerationPayload({
    prompt: 'Funny Roblox duo fail becomes a clutch comeback',
    model: 'seedance-2-fast-preview',
    durationSeconds: 10,
    aspectRatio: '9:16',
    webhookEndpoint: 'https://example.com/seedance-webhook',
    webhookSecret: 'topsecret'
  });

  assert.equal(payload.config.webhook_config.endpoint, 'https://example.com/seedance-webhook');
  assert.equal(payload.config.webhook_config.secret, 'topsecret');
});

test('normalizeSeedanceDuration rounds to supported values', () => {
  assert.equal(normalizeSeedanceDuration(4), 5);
  assert.equal(normalizeSeedanceDuration(8), 10);
  assert.equal(normalizeSeedanceDuration(12), 10);
  assert.equal(normalizeSeedanceDuration(14), 15);
  assert.equal(normalizeSeedanceDuration(Number.NaN), 10);
});

test('buildTaskStatusUrl uses PiAPI task route', () => {
  assert.equal(
    buildTaskStatusUrl('https://api.piapi.ai/', 'abc123'),
    'https://api.piapi.ai/api/v1/task/abc123'
  );
});

test('parseTaskStatusResponse reads completed video url from PiAPI status payload', () => {
  const parsed = parseTaskStatusResponse({
    data: {
      status: 'completed',
      output: {
        video_url: 'https://cdn.piapi.ai/output/video.mp4'
      }
    }
  });

  assert.equal(parsed.status, 'completed');
  assert.equal(parsed.videoUrl, 'https://cdn.piapi.ai/output/video.mp4');
});

test('parseTaskStatusResponse reads completed video url when PiAPI returns output.video as string', () => {
  const parsed = parseTaskStatusResponse({
    data: {
      status: 'completed',
      output: {
        video: 'https://img.theapi.app/ephemeral/example.mp4'
      }
    }
  });

  assert.equal(parsed.status, 'completed');
  assert.equal(parsed.videoUrl, 'https://img.theapi.app/ephemeral/example.mp4');
});

test('extractTaskVideoUrl reads completed video url when PiAPI returns output.video as string', () => {
  const videoUrl = extractTaskVideoUrl({
    data: {
      output: {
        video: 'https://img.theapi.app/ephemeral/example.mp4'
      }
    }
  });

  assert.equal(videoUrl, 'https://img.theapi.app/ephemeral/example.mp4');
});
