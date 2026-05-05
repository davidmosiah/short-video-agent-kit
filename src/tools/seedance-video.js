#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

import { getConfig } from '../config.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadEnvFromFile(envFile = '') {
  const env = { ...process.env };
  if (!envFile || !fs.existsSync(envFile)) return env;
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const idx = s.indexOf('=');
    env[s.slice(0, idx).trim()] = s.slice(idx + 1).trim();
  }
  return env;
}

function ensureTaskDir(stateDir, taskId) {
  if (!stateDir || !taskId) return '';
  const taskDir = path.join(stateDir, taskId);
  fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

function writeJsonIfDir(taskDir, name, payload) {
  if (!taskDir) return;
  fs.writeFileSync(path.join(taskDir, name), JSON.stringify(payload, null, 2) + '\n');
}

function notifyDiscord({
  target = '',
  channel = 'discord',
  envFile = '',
  label = 'Seedance Manual',
  taskId = '',
  status = '',
  model = '',
  webhookEndpoint = '',
  taskDir = ''
}) {
  if (!target) {
    return { skipped: true, reason: 'missing_target' };
  }
  const env = loadEnvFromFile(envFile);
  const lines = [
    `🧪 ${label}`,
    `Task ID: ${taskId}`,
    `Status: ${status}`
  ];
  if (model) lines.push(`Model: ${model}`);
  if (webhookEndpoint) lines.push(`Webhook: <${webhookEndpoint}>`);
  if (taskDir) lines.push(`Task Dir: ${taskDir}`);
  const result = spawnSync('openclaw', [
    'message', 'send',
    '--channel', channel,
    '--target', target,
    '--message', lines.join('\n'),
    '--silent',
    '--json'
  ], {
    env,
    encoding: 'utf8',
    timeout: 45000
  });
  return {
    ok: result.status === 0,
    stdout: (result.stdout || '').trim().slice(0, 1000),
    stderr: (result.stderr || '').trim().slice(0, 1000)
  };
}

export function buildVideoGenerationPayload({
  prompt,
  model = 'seedance-2-fast-preview',
  durationSeconds = 8,
  aspectRatio = '9:16',
  webhookEndpoint = '',
  webhookSecret = ''
}) {
  const normalizedDuration = normalizeSeedanceDuration(durationSeconds);
  const payload = {
    model: 'seedance',
    task_type: model,
    input: {
      prompt,
      aspect_ratio: aspectRatio,
      duration: normalizedDuration
    }
  };
  if (webhookEndpoint) {
    payload.config = {
      webhook_config: {
        endpoint: webhookEndpoint,
        secret: webhookSecret || ''
      }
    };
  }
  return payload;
}

export function normalizeSeedanceDuration(durationSeconds) {
  const allowed = [5, 10, 15];
  const requested = Number(durationSeconds);
  if (!Number.isFinite(requested)) {
    return 10;
  }
  return allowed.reduce((best, candidate) => {
    const candidateDelta = Math.abs(candidate - requested);
    const bestDelta = Math.abs(best - requested);
    if (candidateDelta < bestDelta) {
      return candidate;
    }
    if (candidateDelta === bestDelta && candidate > best) {
      return candidate;
    }
    return best;
  }, allowed[0]);
}

export function buildTaskStatusUrl(baseUrl, taskId) {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1/task/${taskId}`;
}

export function extractTaskVideoUrl(data) {
  const normalized = data?.data || data || {};
  const output = normalized?.output || {};
  return (
    output?.video_url ||
    (typeof output?.video === 'string' ? output.video : '') ||
    output?.video?.url ||
    output?.video?.uri ||
    output?.url ||
    ''
  );
}

function parseTaskCreateResponse(json) {
  return {
    taskId: json?.data?.task_id || json?.task_id || '',
    status: json?.data?.status || json?.status || '',
    raw: json
  };
}

export function parseTaskStatusResponse(json) {
  const data = json?.data || json || {};
  const status = data?.status || '';
  const videoUrl = extractTaskVideoUrl(data);
  const error = data?.error || json?.error || null;
  return { status, videoUrl, error, raw: json };
}

async function requestJson(url, {
  method = 'GET',
  apiKey,
  body
}) {
  const res = await fetch(url, {
    method,
    headers: {
      'X-API-Key': apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`PiAPI response is not JSON: ${text.slice(0, 240)}`);
  }

  if (!res.ok) {
    throw new Error(`PiAPI ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return json;
}

export async function createTask({
  apiKey,
  baseUrl = 'https://api.piapi.ai',
  model = 'seedance-2-fast-preview',
  prompt,
  durationSeconds = 8,
  aspectRatio = '9:16',
  webhookEndpoint = '',
  webhookSecret = ''
}) {
  if (!apiKey) throw new Error('Missing PIAPI_KEY');
  if (!prompt) throw new Error('Missing video prompt');

  const createJson = await requestJson(`${baseUrl.replace(/\/+$/, '')}/api/v1/task`, {
    method: 'POST',
    apiKey,
    body: buildVideoGenerationPayload({
      prompt,
      model,
      durationSeconds,
      aspectRatio,
      webhookEndpoint,
      webhookSecret
    })
  });

  const created = parseTaskCreateResponse(createJson);
  if (!created.taskId) {
    throw new Error(`Seedance generation response missing task_id: ${JSON.stringify(createJson).slice(0, 500)}`);
  }

  return {
    ok: true,
    taskId: created.taskId,
    status: created.status,
    model,
    durationSeconds: normalizeSeedanceDuration(durationSeconds),
    aspectRatio,
    webhookEndpoint,
    provider: 'seedance',
    raw: createJson
  };
}

export async function getTask({
  apiKey,
  baseUrl = 'https://api.piapi.ai',
  taskId
}) {
  if (!apiKey) throw new Error('Missing PIAPI_KEY');
  if (!taskId) throw new Error('Missing task id');
  const json = await requestJson(buildTaskStatusUrl(baseUrl, taskId), { apiKey });
  const parsed = parseTaskStatusResponse(json);
  return {
    ok: true,
    taskId,
    ...parsed
  };
}

async function downloadFile(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download Seedance video ${res.status} from ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

export async function downloadTaskResult({
  apiKey,
  baseUrl = 'https://api.piapi.ai',
  taskId,
  outputPath
}) {
  if (!outputPath) throw new Error('Missing output path');
  const task = await getTask({ apiKey, baseUrl, taskId });
  if (!(task.status === 'completed' || task.status === 'success') || !task.videoUrl) {
    throw new Error(`Seedance task ${taskId} not ready: ${task.status}`);
  }
  await downloadFile(task.videoUrl, outputPath);
  return {
    ok: true,
    taskId,
    status: task.status,
    sourceUrl: task.videoUrl,
    outputPath,
    provider: 'seedance'
  };
}

export async function generateVideo({
  apiKey,
  baseUrl = 'https://api.piapi.ai',
  model = 'seedance-2-fast-preview',
  prompt,
  outputPath,
  durationSeconds = 8,
  aspectRatio = '9:16',
  pollIntervalMs = 15000,
  timeoutMs = 480000
}) {
  if (!apiKey) throw new Error('Missing PIAPI_KEY');
  if (!prompt) throw new Error('Missing video prompt');
  if (!outputPath) throw new Error('Missing output path');
  const normalizedDuration = normalizeSeedanceDuration(durationSeconds);

  const createJson = await requestJson(`${baseUrl.replace(/\/+$/, '')}/api/v1/task`, {
    method: 'POST',
    apiKey,
    body: buildVideoGenerationPayload({
      prompt,
      model,
      durationSeconds: normalizedDuration,
      aspectRatio
    })
  });

  const created = parseTaskCreateResponse(createJson);
  if (!created.taskId) {
    throw new Error(`Seedance generation response missing task_id: ${JSON.stringify(createJson).slice(0, 500)}`);
  }

  console.error(`Seedance task created: ${created.taskId}`);

  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    await sleep(pollIntervalMs);
    const statusJson = await requestJson(buildTaskStatusUrl(baseUrl, created.taskId), { apiKey });
    const status = parseTaskStatusResponse(statusJson);

    if ((status.status === 'completed' || status.status === 'success') && status.videoUrl) {
      await downloadFile(status.videoUrl, outputPath);
      return {
        ok: true,
        taskId: created.taskId,
        status: status.status,
        sourceUrl: status.videoUrl,
        outputPath,
        model,
        durationSeconds: normalizedDuration,
        aspectRatio,
        provider: 'seedance'
      };
    }

    if (status.status === 'failed' || status.status === 'error' || status.status === 'cancelled') {
      throw new Error(`Seedance generation failed: ${JSON.stringify(status.error || status.raw).slice(0, 500)}`);
    }
  }

  throw new Error(`Seedance generation timed out after ${timeoutMs}ms for task ${created.taskId}`);
}

async function main() {
  const command = process.argv[2];
  if (!['generate', 'enqueue', 'get-task', 'download-task'].includes(command)) {
    console.error('Usage: node src/tools/seedance-video.js <generate|enqueue|get-task|download-task> [args]');
    process.exit(1);
  }

  const cfg = getConfig();
  const prompt = arg('prompt') || (arg('prompt-file') ? fs.readFileSync(arg('prompt-file'), 'utf8').trim() : '');
  const outputPath = arg('output');
  const apiKey = process.env.PIAPI_KEY || process.env.SEEDANCE_API_KEY || cfg.seedance.apiKey;
  const baseUrl = process.env.PIAPI_BASE_URL || cfg.seedance.baseUrl;
  const model = arg('model', cfg.seedance.videoModel);
  const durationSeconds = Number(arg('duration', '8'));
  const aspectRatio = arg('aspect-ratio', '9:16');
  const pollIntervalMs = Number(arg('poll-interval-ms', String(cfg.seedance.videoPollIntervalMs)));
  const timeoutMs = Number(arg('timeout-ms', String(cfg.seedance.videoTimeoutMs)));
  const webhookEndpoint = arg('webhook-endpoint', '');
  const webhookSecret = arg('webhook-secret', '');
  const taskId = arg('task-id', '');
  const stateDir = arg('state-dir', '');
  const notifyTarget = arg('discord-target', '');
  const notifyChannel = arg('discord-channel', 'discord');
  const notifyEnvFile = arg('env-file', '');
  const notifyLabel = arg('label', 'Seedance Manual');

  if (command === 'enqueue') {
    const result = await createTask({
      apiKey,
      baseUrl,
      model,
      prompt,
      durationSeconds,
      aspectRatio,
      webhookEndpoint,
      webhookSecret
    });
    const taskDir = ensureTaskDir(stateDir, result.taskId);
    writeJsonIfDir(taskDir, 'task.json', {
      ...result,
      prompt,
      createdAt: new Date().toISOString()
    });
    writeJsonIfDir(taskDir, 'request.json', buildVideoGenerationPayload({
      prompt,
      model,
      durationSeconds,
      aspectRatio,
      webhookEndpoint,
      webhookSecret
    }));
    const notifyResult = notifyDiscord({
      target: notifyTarget,
      channel: notifyChannel,
      envFile: notifyEnvFile,
      label: notifyLabel,
      taskId: result.taskId,
      status: result.status || 'submitted',
      model,
      webhookEndpoint,
      taskDir
    });
    writeJsonIfDir(taskDir, 'enqueue-notify.json', notifyResult);
    console.error(`Seedance task created: ${result.taskId}`);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'get-task') {
    const result = await getTask({
      apiKey,
      baseUrl,
      taskId
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === 'download-task') {
    const result = await downloadTaskResult({
      apiKey,
      baseUrl,
      taskId,
      outputPath
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = await generateVideo({
    apiKey,
    baseUrl,
    model,
    prompt,
    outputPath,
    durationSeconds,
    aspectRatio,
    pollIntervalMs,
    timeoutMs
  });

  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
