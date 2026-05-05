#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { getConfig } from '../config.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

export function buildImageGenerationPayload({
  prompt,
  model = 'grok-imagine-image',
  aspectRatio = '9:16'
}) {
  return {
    model,
    prompt,
    aspect_ratio: aspectRatio
  };
}

function parseImageResponse(json) {
  const item = json?.data?.[0] || json?.images?.[0] || json?.image || {};
  const url = item?.url || json?.url || '';
  const b64Json = item?.b64_json || json?.b64_json || '';
  return { url, b64Json, raw: json };
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
    throw new Error(`xAI image response is not JSON: ${text.slice(0, 240)}`);
  }

  if (!res.ok) {
    throw new Error(`xAI image API ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
  }

  return json;
}

async function persistImage({ url, b64Json, outputPath }) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (url) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download generated image ${res.status} from ${url}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return;
  }

  if (b64Json) {
    fs.writeFileSync(outputPath, Buffer.from(b64Json, 'base64'));
    return;
  }

  throw new Error('xAI image response missing image url and b64 payload');
}

export async function generateImage({
  apiKey,
  baseUrl = 'https://api.x.ai',
  model = 'grok-imagine-image',
  prompt,
  outputPath,
  aspectRatio = '9:16'
}) {
  if (!apiKey) throw new Error('Missing XAI_API_KEY');
  if (!prompt) throw new Error('Missing image prompt');
  if (!outputPath) throw new Error('Missing output path');

  const payload = buildImageGenerationPayload({
    prompt,
    model,
    aspectRatio
  });

  const json = await requestJson(`${baseUrl.replace(/\/+$/, '')}/v1/images/generations`, {
    method: 'POST',
    apiKey,
    body: payload
  });
  const { url, b64Json } = parseImageResponse(json);
  await persistImage({ url, b64Json, outputPath });

  return {
    ok: true,
    status: 'completed',
    sourceUrl: url,
    outputPath,
    model,
    aspectRatio
  };
}

async function main() {
  const command = process.argv[2];
  if (command !== 'generate') {
    console.error('Usage: node src/tools/xai-image.js generate --output <FILE> [--prompt <TEXT> | --prompt-file <FILE>] [--aspect-ratio 9:16]');
    process.exit(1);
  }

  const cfg = getConfig();
  const prompt = arg('prompt') || (arg('prompt-file') ? fs.readFileSync(arg('prompt-file'), 'utf8').trim() : '');
  const outputPath = arg('output');

  const result = await generateImage({
    apiKey: process.env.XAI_API_KEY || cfg.xai.apiKey,
    baseUrl: process.env.XAI_BASE_URL || cfg.xai.baseUrl,
    model: arg('model', process.env.XAI_IMAGE_MODEL || cfg.xai.imageModel || 'grok-imagine-image'),
    prompt,
    outputPath,
    aspectRatio: arg('aspect-ratio', '9:16')
  });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
