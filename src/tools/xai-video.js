#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { getConfig } from '../config.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function argList(name) {
  const values = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) {
      values.push(process.argv[i + 1]);
    }
  }
  return values;
}

function csvList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildVideoGenerationPayload({
  prompt,
  model = 'grok-imagine-video',
  durationSeconds = 10,
  aspectRatio = '9:16',
  resolution = '720p',
  imageUrl = '',
  referenceImageUrls = []
}) {
  const payload = {
    model,
    prompt,
    duration: Number(durationSeconds),
    aspect_ratio: aspectRatio,
    resolution
  };

  const normalizedReferenceImages = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.map((url) => String(url || '').trim()).filter(Boolean)
    : [];

  if (imageUrl && normalizedReferenceImages.length) {
    throw new Error("Cannot specify both 'image' and 'reference_images' for xAI video generation");
  }

  if (imageUrl) {
    payload.image = { url: imageUrl };
  }

  if (normalizedReferenceImages.length) {
    payload.reference_images = normalizedReferenceImages.map((url) => ({ url }));
  }

  return payload;
}

export function buildVideoStatusUrl(baseUrl, requestId) {
  return `${baseUrl.replace(/\/+$/, '')}/v1/videos/${requestId}`;
}

function parseGenerationResponse(json) {
  const requestId = json?.request_id || json?.data?.request_id || json?.id || '';
  const status = json?.status || json?.data?.status || '';
  return { requestId, status, raw: json };
}

export function parseStatusResponse(json) {
  const status = json?.status || json?.data?.status || '';
  const url = json?.video?.url || json?.data?.video?.url || json?.result?.url || json?.data?.result?.url || json?.data?.url || json?.url || '';
  const error = json?.error || json?.data?.error || '';
  return { status, url, error, raw: json };
}

async function requestJson(url, {
  method = 'GET',
  apiKey,
  body
}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`xAI response is not JSON: ${text.slice(0, 240)}`);
  }

  if (!res.ok) {
    throw new Error(`xAI API ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }

  return json;
}

async function downloadFile(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download generated video ${res.status} from ${url}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

function guessMimeType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    default:
      return 'image/png';
  }
}

function fileToDataUri(filePath) {
  const buffer = fs.readFileSync(filePath);
  const mimeType = guessMimeType(filePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

export async function generateVideo({
  apiKey,
  baseUrl = 'https://api.x.ai',
  model = 'grok-imagine-video',
  prompt,
  outputPath,
  durationSeconds = 10,
  aspectRatio = '9:16',
  resolution = '720p',
  imageUrl = '',
  referenceImageUrls = [],
  pollIntervalMs = 15000,
  timeoutMs = 480000
}) {
  if (!apiKey) throw new Error('Missing XAI_API_KEY');
  if (!prompt) throw new Error('Missing video prompt');
  if (!outputPath) throw new Error('Missing output path');

  const payload = buildVideoGenerationPayload({
    prompt,
    model,
    durationSeconds,
    aspectRatio,
    resolution,
    imageUrl,
    referenceImageUrls
  });

  const start = Date.now();
  const createJson = await requestJson(`${baseUrl.replace(/\/+$/, '')}/v1/videos/generations`, {
    method: 'POST',
    apiKey,
    body: payload
  });
  const { requestId } = parseGenerationResponse(createJson);
  if (!requestId) {
    throw new Error(`xAI generation response missing request_id: ${JSON.stringify(createJson).slice(0, 400)}`);
  }

  while ((Date.now() - start) < timeoutMs) {
    await sleep(pollIntervalMs);
    const statusJson = await requestJson(buildVideoStatusUrl(baseUrl, requestId), {
      apiKey
    });
    const { status, url, error } = parseStatusResponse(statusJson);

    if ((status === 'completed' || status === 'done') && url) {
      await downloadFile(url, outputPath);
      return {
        ok: true,
        requestId,
        status,
        sourceUrl: url,
        outputPath,
        model,
        durationSeconds,
        aspectRatio,
        resolution
      };
    }

    if (status === 'failed' || status === 'error' || status === 'expired') {
      throw new Error(`xAI video generation failed: ${JSON.stringify(error || statusJson).slice(0, 400)}`);
    }
  }

  throw new Error(`xAI video generation timed out after ${timeoutMs}ms for request ${requestId}`);
}

async function main() {
  const command = process.argv[2];
  if (command !== 'generate') {
    console.error('Usage: node src/tools/xai-video.js generate --output <FILE> [--prompt <TEXT> | --prompt-file <FILE>] [--image-file <FILE> | --image-url <URL>] [--reference-image-url <URL>] [--duration 10] [--aspect-ratio 9:16] [--resolution 720p]');
    process.exit(1);
  }

  const cfg = getConfig();
  const prompt = arg('prompt') || (arg('prompt-file') ? fs.readFileSync(arg('prompt-file'), 'utf8').trim() : '');
  const outputPath = arg('output');
  const imageUrl = arg('image-url') || (arg('image-file') ? fileToDataUri(arg('image-file')) : '');
  const referenceImageUrls = [
    ...argList('reference-image-url'),
    ...csvList(arg('reference-image-urls')),
    ...argList('reference-image-file').map((filePath) => fileToDataUri(filePath)),
    ...csvList(arg('reference-image-files')).map((filePath) => fileToDataUri(filePath))
  ];

  const result = await generateVideo({
    apiKey: process.env.XAI_API_KEY || cfg.xai.apiKey,
    baseUrl: process.env.XAI_BASE_URL || cfg.xai.baseUrl,
    model: arg('model', cfg.xai.videoModel),
    prompt,
    outputPath,
    durationSeconds: Number(arg('duration', '10')),
    aspectRatio: arg('aspect-ratio', '9:16'),
    resolution: arg('resolution', '720p'),
    imageUrl,
    referenceImageUrls,
    pollIntervalMs: Number(arg('poll-interval-ms', String(cfg.xai.videoPollIntervalMs))),
    timeoutMs: Number(arg('timeout-ms', String(cfg.xai.videoTimeoutMs)))
  });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
