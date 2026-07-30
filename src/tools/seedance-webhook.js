#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

function sendJsonText(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function sendBasicJson(res, status, ok, error = '') {
  const payload = error ? { ok, error } : { ok };
  return sendJsonText(res, status, JSON.stringify(payload));
}

function sendTaskAcceptedJson(res, { taskId, status, videoUrl, downloadedTo, downloadError }) {
  const payload = {
    ok: true,
    taskId: String(taskId),
    status: String(status),
    videoUrl: videoUrl ? String(videoUrl) : '',
    downloadedTo: downloadedTo ? String(downloadedTo) : null,
    downloadError: downloadError ? 'download_failed' : null
  };
  return sendJsonText(res, 200, JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return {
    raw,
    json: raw.trim() ? JSON.parse(raw) : {}
  };
}

function verifySecret(req, expectedSecret, { allowInsecure = false, host = '127.0.0.1' } = {}) {
  // Fail-closed: non-loopback listeners MUST have a secret unless explicitly overridden.
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  if (!expectedSecret) {
    if (allowInsecure && loopback) return true;
    return false;
  }
  const candidates = [
    req.headers['x-webhook-secret'],
    req.headers['x-piapi-secret'],
    req.headers['x-piapi-webhook-secret'],
    new URL(req.url || '/', 'http://localhost').searchParams.get('secret')
  ].filter(Boolean);
  return candidates.includes(expectedSecret);
}

function loadEnvFromFile(envFile = '') {
  const env = { ...process.env };
  if (!envFile || !fs.existsSync(envFile)) return env;
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const s = raw.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const idx = s.indexOf('=');
    const key = s.slice(0, idx).trim();
    const value = s.slice(idx + 1).trim();
    env[key] = value;
  }
  return env;
}

export function extractSeedanceVideoUrl(payload) {
  const data = payload?.data || payload || {};
  const output = data?.output || {};
  return (
    output?.video_url ||
    (typeof output?.video === 'string' ? output.video : '') ||
    output?.video?.url ||
    output?.video?.uri ||
    output?.url ||
    ''
  );
}

function extractTaskInfo(payload) {
  const data = payload?.data || payload || {};
  return {
    taskId: data?.task_id || payload?.task_id || `unknown-${Date.now()}`,
    status: String(data?.status || payload?.status || 'unknown').trim() || 'unknown',
    model: String(data?.model || payload?.model || payload?.task_type || '').trim(),
    taskType: String(data?.task_type || payload?.task_type || '').trim(),
    error: data?.error || payload?.error || null
  };
}

async function downloadFile(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download webhook video ${res.status} from ${url}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buffer);
}

function createDiscordNotifier({ target = '', channel = 'discord', envFile = '', label = 'Seedance Manual' }) {
  if (!target) {
    return async () => ({ skipped: true, reason: 'missing_target' });
  }
  const env = loadEnvFromFile(envFile);
  return async ({ taskId, status, videoUrl = '', downloadedTo = '', downloadError = '', taskDir = '', model = '' }) => {
    const lines = [
      `🧪 ${label}`,
      `Task ID: ${taskId}`,
      `Status: ${status}`,
    ];
    if (model) lines.push(`Model: ${model}`);
    if (videoUrl) lines.push(`Video URL: <${videoUrl}>`);
    if (downloadedTo) lines.push(`Saved MP4: ${downloadedTo}`);
    if (downloadError) lines.push(`Download Error: ${downloadError}`);
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
  };
}

function createTaskEventRunner({
  scriptPath = '',
  envFile = '',
  pythonBin = '/usr/bin/python3',
  timeoutMs = 300000
}) {
  if (!scriptPath) {
    return null;
  }
  const env = loadEnvFromFile(envFile);
  return async ({ taskId, status }) => {
    const result = spawnSync(pythonBin, [
      scriptPath,
      'finalize-task',
      '--task-id', taskId,
      '--source', 'webhook'
    ], {
      env,
      encoding: 'utf8',
      timeout: timeoutMs
    });
    return {
      ok: result.status === 0,
      stdout: (result.stdout || '').trim().slice(0, 4000),
      stderr: (result.stderr || '').trim().slice(0, 4000),
      status
    };
  };
}

function writeStatusFile(taskDir, payload) {
  fs.writeFileSync(path.join(taskDir, 'status.json'), JSON.stringify(payload, null, 2) + '\n');
}

export function createSeedanceWebhookHandler({
  outputDir,
  downloadDir = '',
  secret = '',
  routePath = '/seedance-webhook',
  host = '127.0.0.1',
  allowInsecure = false,
  download = downloadFile,
  notify = null,
  onTaskEvent = null
}) {
  return async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendBasicJson(res, 200, true);
    }
    if (req.method !== 'POST' || url.pathname !== routePath) {
      return sendBasicJson(res, 404, false, 'not_found');
    }
    if (!verifySecret(req, secret, { allowInsecure, host })) {
      return sendBasicJson(res, 401, false, 'unauthorized');
    }

    try {
      const { raw, json } = await readJsonBody(req);
      const info = extractTaskInfo(json);
      const taskDir = path.join(outputDir, info.taskId);
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(path.join(taskDir, 'headers.json'), JSON.stringify(req.headers, null, 2) + '\n');
      fs.writeFileSync(path.join(taskDir, 'payload.json'), JSON.stringify(json, null, 2) + '\n');
      fs.writeFileSync(path.join(taskDir, 'payload.raw.json'), raw);

      const videoUrl = extractSeedanceVideoUrl(json);
      let downloadedTo = '';
      let downloadError = '';
      if (downloadDir && videoUrl) {
        downloadedTo = path.join(downloadDir, `${info.taskId}.mp4`);
        try {
          await download(videoUrl, downloadedTo);
        } catch (error) {
          downloadedTo = '';
          downloadError = String(error);
          fs.writeFileSync(path.join(taskDir, 'download-error.txt'), downloadError + '\n');
        }
      }

      writeStatusFile(taskDir, {
        taskId: info.taskId,
        status: info.status,
        model: info.model,
        taskType: info.taskType,
        videoUrl,
        downloadedTo,
        downloadError,
        error: info.error,
        updatedAt: new Date().toISOString()
      });

      if (notify) {
        const notifyResult = await notify({
          taskId: info.taskId,
          status: info.status,
          videoUrl,
          downloadedTo,
          downloadError,
          taskDir,
          model: info.model || info.taskType
        });
        fs.writeFileSync(path.join(taskDir, 'notify.json'), JSON.stringify(notifyResult, null, 2) + '\n');
      }

      if (onTaskEvent && ['completed', 'success', 'failed', 'error', 'cancelled'].includes(String(info.status).toLowerCase())) {
        try {
          const taskEventResult = await onTaskEvent({
            taskId: info.taskId,
            status: info.status,
            videoUrl,
            downloadedTo,
            taskDir,
            model: info.model || info.taskType
          });
          fs.writeFileSync(path.join(taskDir, 'task-event.json'), JSON.stringify(taskEventResult, null, 2) + '\n');
        } catch (error) {
          fs.writeFileSync(path.join(taskDir, 'task-event-error.txt'), String(error) + '\n');
        }
      }

      return sendTaskAcceptedJson(res, {
        taskId: info.taskId,
        status: info.status,
        videoUrl,
        downloadedTo,
        downloadError
      });
    } catch (error) {
      return sendBasicJson(res, 500, false, 'internal_error');
    }
  };
}

async function main() {
  const command = process.argv[2];
  if (command !== 'serve') {
    console.error('Usage: node src/tools/seedance-webhook.js serve --listen http://127.0.0.1:8791 --output-dir <DIR> [--download-dir <DIR>] --secret <SECRET> [--path /seedance-webhook] [--allow-insecure-loopback] [--discord-target <id>] [--env-file <path>] [--task-event-script <path>]');
    process.exit(1);
  }

  const listen = new URL(arg('listen', 'http://127.0.0.1:8791'));
  const outputDir = arg('output-dir', path.join(process.cwd(), 'data', 'seedance-webhooks'));
  const downloadDir = arg('download-dir', '');
  const secret = arg('secret', process.env.SEEDANCE_WEBHOOK_SECRET || '');
  const routePath = arg('path', '/seedance-webhook');
  const discordTarget = arg('discord-target', '');
  const discordChannel = arg('discord-channel', 'discord');
  const envFile = arg('env-file', '');
  const label = arg('label', 'Seedance Manual');
  const taskEventScript = arg('task-event-script', '');
  const pythonBin = arg('python-bin', '/usr/bin/python3');
  const taskEventTimeoutMs = Number(arg('task-event-timeout-ms', '300000'));
  const allowInsecure = process.argv.includes('--allow-insecure-loopback');
  const host = listen.hostname || '127.0.0.1';
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  if (!secret && !loopback) {
    console.error('Refusing to listen on non-loopback without --secret (or SEEDANCE_WEBHOOK_SECRET).');
    process.exit(1);
  }
  if (!secret && loopback && !allowInsecure) {
    console.error('Refusing insecure webhook: pass --secret or --allow-insecure-loopback for local-only testing.');
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  if (downloadDir) {
    fs.mkdirSync(downloadDir, { recursive: true });
  }

  const notify = createDiscordNotifier({
    target: discordTarget,
    channel: discordChannel,
    envFile,
    label
  });
  const onTaskEvent = createTaskEventRunner({
    scriptPath: taskEventScript,
    envFile,
    pythonBin,
    timeoutMs: taskEventTimeoutMs
  });

  const server = http.createServer(createSeedanceWebhookHandler({
    outputDir,
    downloadDir,
    secret,
    routePath,
    host,
    allowInsecure,
    notify,
    onTaskEvent
  }));

  server.listen(Number(listen.port || 8791), listen.hostname, () => {
    const webhookUrl = `${listen.origin}${routePath}`;
    const fingerprint = secret ? crypto.createHash('sha256').update(secret).digest('hex').slice(0, 12) : '';
    console.log(JSON.stringify({
      ok: true,
      listen: listen.origin,
      routePath,
      webhookUrl,
      outputDir,
      downloadDir,
      discordTarget,
      envFile,
      taskEventScript,
      secretFingerprint: fingerprint
    }, null, 2));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
