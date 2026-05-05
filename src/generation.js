import path from 'node:path';

import { buildVideoGenerationPayload as buildGeminiPayload, generateVideo as generateGeminiVideo } from './tools/gemini-video.js';
import { buildVideoGenerationPayload as buildSeedancePayload, generateVideo as generateSeedanceVideo } from './tools/seedance-video.js';
import { buildVideoGenerationPayload as buildSoraPayload, generateVideo as generateSoraVideo } from './tools/sora-video.js';
import { buildVideoGenerationPayload as buildXaiVideoPayload, generateVideo as generateXaiVideo } from './tools/xai-video.js';

export const PROVIDERS = ['openai_sora', 'gemini_veo', 'xai_grok', 'seedance_piapi'];

export function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (value === 'sora' || value === 'openai') return 'openai_sora';
  if (value === 'gemini' || value === 'veo' || value === 'google') return 'gemini_veo';
  if (value === 'xai' || value === 'grok') return 'xai_grok';
  if (value === 'seedance' || value === 'piapi') return 'seedance_piapi';
  if (PROVIDERS.includes(value)) return value;
  throw new Error(`Unsupported provider: ${provider}`);
}

export function defaultOutputPath({ cfg, provider, extension = 'mp4' }) {
  const normalized = normalizeProvider(provider);
  return path.join(cfg.outputDir, `${normalized}_${Date.now()}.${extension}`);
}

export function buildGenerationPayload({
  provider,
  prompt,
  model = '',
  durationSeconds = 8,
  aspectRatio = '9:16',
  size = '720x1280',
  resolution = '720p',
  negativePrompt = '',
  personGeneration = '',
  webhookEndpoint = '',
  webhookSecret = '',
  imageUrl = '',
  referenceImageUrls = []
}) {
  const normalized = normalizeProvider(provider);
  if (!prompt) throw new Error('Missing video prompt');

  if (normalized === 'openai_sora') {
    return {
      provider: normalized,
      endpoint: 'POST /v1/videos',
      payload: Object.fromEntries(buildSoraPayload({
        prompt,
        model: model || 'sora-2',
        seconds: String(durationSeconds),
        size
      }).entries())
    };
  }

  if (normalized === 'gemini_veo') {
    return {
      provider: normalized,
      endpoint: 'POST /models/{model}:predictLongRunning',
      payload: buildGeminiPayload({
        prompt,
        durationSeconds,
        aspectRatio,
        personGeneration,
        negativePrompt
      })
    };
  }

  if (normalized === 'xai_grok') {
    return {
      provider: normalized,
      endpoint: 'POST /v1/videos/generations',
      payload: buildXaiVideoPayload({
        prompt,
        model: model || 'grok-imagine-video',
        durationSeconds,
        aspectRatio,
        resolution,
        imageUrl,
        referenceImageUrls
      })
    };
  }

  return {
    provider: normalized,
    endpoint: 'POST /api/v1/task',
    payload: buildSeedancePayload({
      prompt,
      model: model || 'seedance-2-fast-preview',
      durationSeconds,
      aspectRatio,
      webhookEndpoint,
      webhookSecret
    })
  };
}

export async function generateWithProvider({
  cfg,
  provider,
  prompt,
  outputPath,
  model = '',
  durationSeconds = 8,
  aspectRatio = '9:16',
  size = '720x1280',
  resolution = '720p',
  negativePrompt = '',
  personGeneration = '',
  imageUrl = '',
  referenceImageUrls = [],
  pollIntervalMs = 0,
  timeoutMs = 0
}) {
  const normalized = normalizeProvider(provider);
  const finalOutputPath = outputPath || defaultOutputPath({ cfg, provider: normalized });

  if (normalized === 'openai_sora') {
    return generateSoraVideo({
      apiKey: cfg.openai.apiKey,
      baseUrl: cfg.openai.baseUrl,
      model: model || cfg.openai.videoModel,
      prompt,
      outputPath: finalOutputPath,
      seconds: String(durationSeconds),
      size,
      pollIntervalMs: pollIntervalMs || cfg.openai.videoPollIntervalMs,
      timeoutMs: timeoutMs || cfg.openai.videoTimeoutMs
    });
  }

  if (normalized === 'gemini_veo') {
    return generateGeminiVideo({
      apiKey: cfg.gemini.apiKey,
      baseUrl: cfg.gemini.baseUrl,
      model: model || cfg.gemini.videoModel,
      prompt,
      outputPath: finalOutputPath,
      durationSeconds,
      aspectRatio,
      personGeneration: personGeneration || cfg.gemini.personGeneration,
      negativePrompt,
      pollIntervalMs: pollIntervalMs || cfg.gemini.videoPollIntervalMs,
      timeoutMs: timeoutMs || cfg.gemini.videoTimeoutMs
    });
  }

  if (normalized === 'xai_grok') {
    return generateXaiVideo({
      apiKey: cfg.xai.apiKey,
      baseUrl: cfg.xai.baseUrl,
      model: model || cfg.xai.videoModel,
      prompt,
      outputPath: finalOutputPath,
      durationSeconds,
      aspectRatio,
      resolution,
      imageUrl,
      referenceImageUrls,
      pollIntervalMs: pollIntervalMs || cfg.xai.videoPollIntervalMs,
      timeoutMs: timeoutMs || cfg.xai.videoTimeoutMs
    });
  }

  return generateSeedanceVideo({
    apiKey: cfg.seedance.apiKey,
    baseUrl: cfg.seedance.baseUrl,
    model: model || cfg.seedance.videoModel,
    prompt,
    outputPath: finalOutputPath,
    durationSeconds,
    aspectRatio,
    pollIntervalMs: pollIntervalMs || cfg.seedance.videoPollIntervalMs,
    timeoutMs: timeoutMs || cfg.seedance.videoTimeoutMs
  });
}
