import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function validateTaskId(taskId) {
  if (typeof taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(taskId)) {
    throw new Error('invalid_task_id');
  }
  return taskId;
}

export function diagnosticHeaders(headers) {
  return Object.fromEntries(['content-type', 'content-length', 'user-agent']
    .filter(name => typeof headers[name] === 'string')
    .map(name => [name, headers[name]]));
}

// Fail closed for non-global, transition, mapped, and special-purpose addresses.
export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (family !== 6 || address.includes('.') || address.includes('%')) return false;
  const [firstText, secondText = '0'] = address.toLowerCase().split(':');
  const first = parseInt(firstText, 16);
  const second = parseInt(secondText || '0', 16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff &&
    !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8));
}

export function validateDownloadUrl(value, allowedHosts) {
  const url = new URL(value);
  const hosts = new Set(allowedHosts.map(host => host.trim().toLowerCase()).filter(Boolean));
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password ||
      isIP(url.hostname.replace(/^\[|\]$/g, '')) || !hosts.has(url.hostname.toLowerCase())) {
    throw new Error('download_destination_not_allowed');
  }
  return url;
}

function atomicWrite(outputPath, data) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temp = path.join(path.dirname(outputPath), `.webhook-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, data, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, outputPath);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

// Exact hostname opt-in, HTTPS only, pinned DNS result, TLS validation retained,
// no connection reuse, no redirects, and one deadline covering DNS + body.
export async function downloadWebhookVideo(value, outputPath, {
  allowedHosts = [], resolve = lookup, request = httpsRequest, write = atomicWrite,
  maxBytes = 64 * 1024 * 1024, timeoutMs = 30000
} = {}) {
  const url = validateDownloadUrl(value, allowedHosts);
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('download_timeout'));
    }, timeoutMs);
  });
  const operation = async () => {
    const addresses = await resolve(url.hostname, { all: true, verbatim: true });
    if (controller.signal.aborted) throw new Error('download_timeout');
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address) || isIP(item.address) !== item.family)) {
      throw new Error('download_address_not_public');
    }
    const pinned = addresses[0];
    const body = await new Promise((resolveBody, reject) => {
      const req = request(url, {
        agent: false, signal: controller.signal, servername: url.hostname, rejectUnauthorized: true,
        lookup: (_hostname, options, callback) => options?.all
          ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family),
        headers: { 'User-Agent': 'short-video-agent-kit-webhook', Accept: 'video/*,application/octet-stream' }
      }, async res => {
        try {
          // Node HTTPS does not follow Location. Fail closed even to allowlisted hosts.
          if (res.statusCode !== 200) throw new Error('download_http_status_rejected');
          const length = res.headers['content-length'];
          if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > maxBytes)) {
            throw new Error('download_too_large');
          }
          let size = 0;
          const chunks = [];
          for await (const chunk of res) {
            if (controller.signal.aborted) throw new Error('download_timeout');
            size += chunk.length;
            if (size > maxBytes) throw new Error('download_too_large');
            chunks.push(Buffer.from(chunk));
          }
          resolveBody(Buffer.concat(chunks));
        } catch (error) {
          res.destroy();
          reject(error);
        }
      });
      req.on('error', reject);
      req.end();
    });
    if (controller.signal.aborted) throw new Error('download_timeout');
    write(outputPath, body);
  };
  try {
    await Promise.race([operation(), deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
