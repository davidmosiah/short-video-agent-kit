import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildVideoGenerationPayload,
  buildOperationStatusUrl,
  parseOperationResponse
} from '../src/tools/gemini-video.js';

test('buildVideoGenerationPayload builds Gemini Veo-compatible payload', () => {
  const payload = buildVideoGenerationPayload({
    prompt: 'Funny Roblox duo fail becomes a clutch comeback',
    model: 'veo-3.1-fast-generate-preview',
    durationSeconds: 8,
    aspectRatio: '9:16',
    personGeneration: 'allow_adult',
    negativePrompt: 'bald default avatar heads'
  });

  assert.deepEqual(payload, {
    instances: [
      {
        prompt: 'Funny Roblox duo fail becomes a clutch comeback'
      }
    ],
    parameters: {
      aspectRatio: '9:16',
      durationSeconds: 8,
      negativePrompt: 'bald default avatar heads'
    }
  });
});

test('buildVideoGenerationPayload omits unsupported allow_adult personGeneration', () => {
  const payload = buildVideoGenerationPayload({
    prompt: 'Funny Roblox duo fail becomes a clutch comeback',
    durationSeconds: 8,
    aspectRatio: '9:16',
    personGeneration: 'allow_adult',
    negativePrompt: 'bald default avatar heads'
  });

  assert.deepEqual(payload, {
    instances: [
      {
        prompt: 'Funny Roblox duo fail becomes a clutch comeback'
      }
    ],
    parameters: {
      aspectRatio: '9:16',
      durationSeconds: 8,
      negativePrompt: 'bald default avatar heads'
    }
  });
});

test('buildOperationStatusUrl uses the Gemini operations route', () => {
  assert.equal(
    buildOperationStatusUrl('https://generativelanguage.googleapis.com/v1beta/', 'operations/abc123'),
    'https://generativelanguage.googleapis.com/v1beta/operations/abc123'
  );
});

test('parseOperationResponse reads completed video uri from Gemini operation payload', () => {
  const parsed = parseOperationResponse({
    name: 'operations/abc123',
    done: true,
    response: {
      generateVideoResponse: {
        generatedSamples: [
          {
            video: {
              uri: 'https://generativelanguage.googleapis.com/download/video.mp4'
            }
          }
        ]
      }
    }
  });

  assert.equal(parsed.name, 'operations/abc123');
  assert.equal(parsed.done, true);
  assert.equal(parsed.uri, 'https://generativelanguage.googleapis.com/download/video.mp4');
});
