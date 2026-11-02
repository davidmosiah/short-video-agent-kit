import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSeedanceWebhookHandler, extractSeedanceVideoUrl } from '../src/tools/seedance-webhook.js';

test('extractSeedanceVideoUrl reads video string payload', () => {
  const url = extractSeedanceVideoUrl({
    data: {
      output: {
        video: 'https://img.theapi.app/ephemeral/example.mp4'
      }
    }
  });
  assert.equal(url, 'https://img.theapi.app/ephemeral/example.mp4');
});

test('webhook handler stores payload and returns task metadata', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seedance-webhook-'));
  let notifyPayload = null;
  const handler = createSeedanceWebhookHandler({
    outputDir,
    secret: 'topsecret',
    downloadDir: path.join(outputDir, 'downloads'),
    download: async (_url, outputPath) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'video');
    },
    notify: async (payload) => {
      notifyPayload = payload;
      return { ok: true };
    }
  });

  const payload = {
    data: {
      task_id: 'task-123',
      output: {
        video: 'https://img.theapi.app/ephemeral/example.mp4'
      }
    }
  };

  const req = Object.assign(
    ReadableFromString(JSON.stringify(payload)),
    {
      method: 'POST',
      url: '/seedance-webhook',
      headers: {
        'content-type': 'application/json',
        'x-webhook-secret': 'topsecret'
      }
    }
  );

  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.taskId, 'task-123');
  assert.equal(body.status, 'unknown');
  assert.equal(body.videoUrl, 'https://img.theapi.app/ephemeral/example.mp4');
  assert.equal(fs.existsSync(path.join(outputDir, 'task-123', 'payload.json')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'task-123', 'status.json')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'task-123', 'notify.json')), true);
  assert.equal(notifyPayload.taskId, 'task-123');
  assert.match(notifyPayload.downloadedTo, /task-123\.mp4$/);
  const savedHeaders = JSON.parse(fs.readFileSync(path.join(outputDir, 'task-123', 'headers.json'), 'utf8'));
  assert.equal(savedHeaders['content-type'], 'application/json');
  assert.equal(savedHeaders['x-webhook-secret'], undefined);
});

test('webhook rejects non-opaque task IDs before any files or downstream calls', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seedance-id-validation-'));
  try {
    for (const taskId of ['../escape', '../../escape', '/absolute', '..', '.', 'a/b', 'a\\b', '', 123, {}, 'a'.repeat(129)]) {
      const outputDir = path.join(root, 'output');
      let calls = 0;
      const handler = createSeedanceWebhookHandler({
        outputDir, downloadDir: path.join(root, 'downloads'), secret: 'synthetic-secret',
        download: async () => { calls++; }, notify: async () => { calls++; },
        onTaskEvent: async () => { calls++; }
      });
      const req = Object.assign(ReadableFromString(JSON.stringify({ data: {
        task_id: taskId, output: { video: 'https://example.invalid/video.mp4' }
      } })), { method: 'POST', url: '/seedance-webhook', headers: { 'x-webhook-secret': 'synthetic-secret' } });
      const res = createMockResponse();
      await handler(req, res);
      assert.equal(res.statusCode, 400);
      assert.equal(calls, 0);
      assert.deepEqual(fs.readdirSync(root), []);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('webhook handler acknowledges even when download fails', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seedance-webhook-'));
  const handler = createSeedanceWebhookHandler({
    outputDir,
    secret: 'topsecret',
    downloadDir: path.join(outputDir, 'downloads'),
    download: async () => {
      throw new Error('boom');
    }
  });

  const payload = {
    task_id: 'task-err',
    status: 'completed',
    output: {
      video: 'https://img.theapi.app/ephemeral/example.mp4'
    }
  };

  const req = Object.assign(ReadableFromString(JSON.stringify(payload)), {
    method: 'POST',
    url: '/seedance-webhook',
    headers: {
      'content-type': 'application/json',
      'x-webhook-secret': 'topsecret'
    }
  });

  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.taskId, 'task-err');
  assert.equal(body.downloadError, 'download_failed');
  assert.equal(fs.existsSync(path.join(outputDir, 'task-err', 'download-error.txt')), true);
});

function ReadableFromString(text) {
  async function* gen() {
    yield Buffer.from(text);
  }
  return gen();
}

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body += chunk || '';
    }
  };
}

