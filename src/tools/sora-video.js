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
  model = 'sora-2',
  seconds = '8',
  size = '720x1280'
}) {
  const form = new FormData();
  form.set('model', model);
  form.set('prompt', prompt);
  form.set('seconds', String(seconds));
  form.set('size', size);
  return form;
}

export function buildVideoStatusUrl(baseUrl, videoId) {
  return `${baseUrl.replace(/\/+$/, '')}/v1/videos/${videoId}`;
}

export function buildVideoContentUrl(baseUrl, videoId) {
  return `${baseUrl.replace(/\/+$/, '')}/v1/videos/${videoId}/content`;
}

export function parseVideoResponse(json) {
  return {
    id: json?.id || '',
    status: json?.status || '',
    progress: Number(json?.progress || 0),
    model: json?.model || '',
    seconds: String(json?.seconds || ''),
    size: json?.size || '',
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
      Authorization: `Bearer ${apiKey}`
    },
    body
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`OpenAI video response is not JSON: ${text.slice(0, 240)}`);
  }

  if (!res.ok) {
    throw new Error(`OpenAI video API ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return json;
}

async function downloadFile(url, outputPath, apiKey) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'video/mp4'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to download Sora video ${res.status}: ${text.slice(0, 240)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

export async function generateVideo({
  apiKey,
  baseUrl = 'https://api.openai.com',
  model = 'sora-2',
  prompt,
  outputPath,
  seconds = '8',
  size = '720x1280',
  pollIntervalMs = 15000,
  timeoutMs = 480000
}) {
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  if (!prompt) throw new Error('Missing video prompt');
  if (!outputPath) throw new Error('Missing output path');

  const createJson = await requestJson(`${baseUrl.replace(/\/+$/, '')}/v1/videos`, {
    method: 'POST',
    apiKey,
    body: buildVideoGenerationPayload({ prompt, model, seconds, size })
  });
  const created = parseVideoResponse(createJson);
  if (!created.id) {
    throw new Error(`OpenAI video generation response missing id: ${JSON.stringify(createJson).slice(0, 500)}`);
  }

  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    const current = created.status || '';
    if (current === 'completed') break;
    if (current === 'failed' || current === 'cancelled') {
      throw new Error(`Sora video generation failed immediately: ${JSON.stringify(createJson).slice(0, 500)}`);
    }

    await sleep(pollIntervalMs);
    const statusJson = await requestJson(buildVideoStatusUrl(baseUrl, created.id), { apiKey });
    const status = parseVideoResponse(statusJson);
    if (status.status === 'completed') {
      await downloadFile(buildVideoContentUrl(baseUrl, status.id), outputPath, apiKey);
      return {
        ok: true,
        id: status.id,
        status: status.status,
        outputPath,
        model,
        seconds: String(seconds),
        size
      };
    }
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new Error(`Sora video generation failed: ${JSON.stringify(status.raw).slice(0, 500)}`);
    }
  }

  throw new Error(`Sora video generation timed out after ${timeoutMs}ms`);
}

async function main() {
  const command = process.argv[2];
  if (command !== 'generate') {
    console.error('Usage: node src/tools/sora-video.js generate --output <FILE> [--prompt <TEXT> | --prompt-file <FILE>] [--seconds 8] [--size 720x1280]');
    process.exit(1);
  }

  const cfg = getConfig();
  const prompt = arg('prompt') || (arg('prompt-file') ? fs.readFileSync(arg('prompt-file'), 'utf8').trim() : '');
  const outputPath = arg('output');
  const result = await generateVideo({
    apiKey: process.env.OPENAI_API_KEY || cfg.openai.apiKey,
    baseUrl: process.env.OPENAI_BASE_URL || cfg.openai.baseUrl,
    model: arg('model', cfg.openai.videoModel),
    prompt,
    outputPath,
    seconds: arg('seconds', '8'),
    size: arg('size', '720x1280'),
    pollIntervalMs: Number(arg('poll-interval-ms', String(cfg.openai.videoPollIntervalMs))),
    timeoutMs: Number(arg('timeout-ms', String(cfg.openai.videoTimeoutMs)))
  });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
