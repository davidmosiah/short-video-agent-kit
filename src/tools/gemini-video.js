#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { getConfig } from '../config.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildVideoGenerationPayload({
  prompt,
  durationSeconds = 8,
  aspectRatio = '9:16',
  personGeneration = '',
  negativePrompt = ''
}) {
  const normalizedPersonGeneration = String(personGeneration || '').trim();
  return {
    instances: [
      {
        prompt
      }
    ],
    parameters: {
      aspectRatio,
      durationSeconds: Number(durationSeconds),
      ...((normalizedPersonGeneration && normalizedPersonGeneration !== 'allow_adult')
        ? { personGeneration: normalizedPersonGeneration }
        : {}),
      ...(negativePrompt ? { negativePrompt } : {})
    }
  };
}

export function buildOperationStatusUrl(baseUrl, operationName) {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, '');
  const cleanOperation = String(operationName || '').replace(/^\/+/, '');
  return `${cleanBaseUrl}/${cleanOperation}`;
}

export function parseOperationResponse(json) {
  const name = json?.name || json?.operation?.name || '';
  const done = Boolean(json?.done ?? json?.operation?.done);
  const response = json?.response || json?.operation?.response || {};
  const error = json?.error || json?.operation?.error || null;
  const uri = response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri
    || response?.generatedVideos?.[0]?.video?.uri
    || response?.videos?.[0]?.uri
    || response?.video?.uri
    || '';

  return {
    name,
    done,
    uri,
    error,
    raw: json
  };
}

async function requestJson(url, {
  method = 'GET',
  apiKey,
  body
}) {
  const res = await fetch(url, {
    method,
    headers: {
      'x-goog-api-key': apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Gemini response is not JSON: ${text.slice(0, 240)}`);
  }

  if (!res.ok) {
    throw new Error(`Gemini API ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }

  return json;
}

async function downloadFile(url, outputPath, apiKey) {
  const res = await fetch(url, {
    headers: {
      'x-goog-api-key': apiKey
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to download generated video ${res.status} from ${url}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

export async function generateVideo({
  apiKey,
  baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
  model = 'veo-3.1-fast-generate-preview',
  prompt,
  outputPath,
  durationSeconds = 8,
  aspectRatio = '9:16',
  personGeneration = '',
  negativePrompt = '',
  pollIntervalMs = 15000,
  timeoutMs = 480000
}) {
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  if (!prompt) throw new Error('Missing video prompt');
  if (!outputPath) throw new Error('Missing output path');

  const payload = buildVideoGenerationPayload({
    prompt,
    durationSeconds,
    aspectRatio,
    personGeneration,
    negativePrompt
  });

  const start = Date.now();
  const createJson = await requestJson(
    `${baseUrl.replace(/\/+$/, '')}/models/${model}:predictLongRunning`,
    {
      method: 'POST',
      apiKey,
      body: payload
    }
  );

  const operation = parseOperationResponse(createJson);
  if (!operation.name) {
    throw new Error(`Gemini generation response missing operation name: ${JSON.stringify(createJson).slice(0, 400)}`);
  }

  while ((Date.now() - start) < timeoutMs) {
    await sleep(pollIntervalMs);
    const statusJson = await requestJson(buildOperationStatusUrl(baseUrl, operation.name), {
      apiKey
    });
    const status = parseOperationResponse(statusJson);

    if (status.done && status.uri) {
      await downloadFile(status.uri, outputPath, apiKey);
      return {
        ok: true,
        operationName: status.name,
        done: true,
        sourceUrl: status.uri,
        outputPath,
        model,
        durationSeconds,
        aspectRatio,
        personGeneration
      };
    }

    if (status.done && status.error) {
      throw new Error(`Gemini video generation failed: ${JSON.stringify(status.error).slice(0, 400)}`);
    }
  }

  throw new Error(`Gemini video generation timed out after ${timeoutMs}ms for operation ${operation.name}`);
}

async function main() {
  const command = process.argv[2];
  if (command !== 'generate') {
    console.error('Usage: node src/tools/gemini-video.js generate --output <FILE> [--prompt <TEXT> | --prompt-file <FILE>] [--duration 8] [--aspect-ratio 9:16]');
    process.exit(1);
  }

  const cfg = getConfig();
  const prompt = arg('prompt') || (arg('prompt-file') ? fs.readFileSync(arg('prompt-file'), 'utf8').trim() : '');
  const outputPath = arg('output');

  const result = await generateVideo({
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || cfg.gemini.apiKey,
    baseUrl: process.env.GEMINI_BASE_URL || cfg.gemini.baseUrl,
    model: arg('model', cfg.gemini.videoModel),
    prompt,
    outputPath,
    durationSeconds: Number(arg('duration', '8')),
    aspectRatio: arg('aspect-ratio', '9:16'),
    personGeneration: arg('person-generation', cfg.gemini.personGeneration),
    negativePrompt: arg('negative-prompt', 'bald default Roblox avatar heads, hairless mannequin avatars, blank face, missing accessories'),
    pollIntervalMs: Number(arg('poll-interval-ms', String(cfg.gemini.videoPollIntervalMs))),
    timeoutMs: Number(arg('timeout-ms', String(cfg.gemini.videoTimeoutMs)))
  });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
