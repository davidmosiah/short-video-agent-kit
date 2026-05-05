import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function loadDotEnv(cwd = process.cwd(), env = process.env) {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return env;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in env)) env[key] = value;
  }
  return env;
}

export function getConfig({ cwd = process.cwd(), env = process.env } = {}) {
  loadDotEnv(cwd, env);
  return {
    dryRun: bool(env.SHORT_VIDEO_DRY_RUN, true),
    outputDir: env.SHORT_VIDEO_OUTPUT_DIR || path.join(cwd, 'output'),
    openai: {
      apiKey: env.OPENAI_API_KEY || '',
      baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com',
      videoModel: env.OPENAI_VIDEO_MODEL || 'sora-2',
      videoPollIntervalMs: Number(env.OPENAI_VIDEO_POLL_INTERVAL_MS || 15000),
      videoTimeoutMs: Number(env.OPENAI_VIDEO_TIMEOUT_MS || 480000)
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '',
      baseUrl: env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
      videoModel: env.GEMINI_VIDEO_MODEL || 'veo-3.1-fast-generate-preview',
      personGeneration: env.GEMINI_VIDEO_PERSON_GENERATION || 'allow_adult',
      videoPollIntervalMs: Number(env.GEMINI_VIDEO_POLL_INTERVAL_MS || 15000),
      videoTimeoutMs: Number(env.GEMINI_VIDEO_TIMEOUT_MS || 480000)
    },
    xai: {
      apiKey: env.XAI_API_KEY || '',
      baseUrl: env.XAI_BASE_URL || 'https://api.x.ai',
      videoModel: env.XAI_VIDEO_MODEL || 'grok-imagine-video',
      imageModel: env.XAI_IMAGE_MODEL || 'grok-imagine-image',
      videoPollIntervalMs: Number(env.XAI_VIDEO_POLL_INTERVAL_MS || 15000),
      videoTimeoutMs: Number(env.XAI_VIDEO_TIMEOUT_MS || 480000)
    },
    seedance: {
      apiKey: env.PIAPI_KEY || env.SEEDANCE_API_KEY || '',
      baseUrl: env.PIAPI_BASE_URL || 'https://api.piapi.ai',
      videoModel: env.SEEDANCE_VIDEO_MODEL || 'seedance-2-fast-preview',
      videoPollIntervalMs: Number(env.SEEDANCE_VIDEO_POLL_INTERVAL_MS || 15000),
      videoTimeoutMs: Number(env.SEEDANCE_VIDEO_TIMEOUT_MS || 480000)
    },
    mcp: {
      host: env.SHORT_VIDEO_MCP_HOST || '127.0.0.1',
      port: Number(env.SHORT_VIDEO_MCP_PORT || 3033),
      allowedOrigin: env.SHORT_VIDEO_MCP_ALLOWED_ORIGIN || ''
    }
  };
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
