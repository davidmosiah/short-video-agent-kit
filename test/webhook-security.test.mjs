import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { validateTaskId, diagnosticHeaders, isPublicAddress, validateDownloadUrl, downloadWebhookVideo } from '../src/tools/webhook-security.mjs';

const host = 'media.example.invalid';
const url = `https://${host}/video.mp4`;
function harness({ addresses = [{ address: '93.184.216.34', family: 4 }], status = 200, headers = {}, chunks = ['video'], resolver } = {}) {
  const seen = { resolves: 0, requests: 0, writes: [], options: null };
  return { seen, options: {
    allowedHosts: [host],
    resolve: async (...args) => { seen.resolves++; return resolver ? resolver(...args) : addresses; },
    request: (target, options, cb) => {
      seen.requests++; seen.options = options; seen.target = target;
      const req = new EventEmitter();
      req.end = () => queueMicrotask(() => {
        const res = Readable.from(chunks.map(c => Buffer.from(c)));
        res.statusCode = status; res.headers = headers; cb(res);
      });
      return req;
    },
    write: (output, bytes) => seen.writes.push({ output, bytes: bytes.toString() })
  } };
}

test('IDs cannot carry traversal, separator, control, or oversized strings', () => {
  for (const id of ['../x', '..', '.', '/x', 'x/y', 'x\\y', 'x\0y', '', 0, {}, [], 'x'.repeat(129)]) {
    assert.throws(() => validateTaskId(id), /invalid_task_id/);
  }
  for (const id of ['task-123', 'a_b', 'A'.repeat(128)]) assert.equal(validateTaskId(id), id);
});

test('diagnostics drop all authentication and arbitrary headers', () => {
  assert.deepEqual(diagnosticHeaders({ 'content-type': 'application/json', 'x-webhook-secret': 'fake',
    'x-piapi-secret': 'fake', 'x-piapi-webhook-secret': 'fake', authorization: 'fake', cookie: 'fake', 'x-custom': 'fake' }),
  { 'content-type': 'application/json' });
});

test('only public addresses are accepted, including IPv6 special/transition cases', () => {
  for (const ip of ['0.0.0.0','10.1.2.3','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1',
    '192.0.2.1','192.88.99.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255',
    '::1','::','::ffff:127.0.0.1','::ffff:7f00:1','fc00::1','fe80::1','ff02::1','2001:db8::1','2001::1','2002:7f00:1::','3fff::1','invalid']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['93.184.216.34','8.8.8.8','2001:4860:4860::8888','2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
});

test('URL policy is exact, HTTPS-only and excludes credentials, IP literals and ports', () => {
  for (const value of ['http://media.example.invalid/x','https://media.example.invalid:444/x','https://user:pass@media.example.invalid/x',
    'https://media.example.invalid.attacker.test/x','https://127.0.0.1/x','https://[::1]/x','file:///tmp/x']) {
    assert.throws(() => validateDownloadUrl(value, [host]));
  }
  assert.throws(() => validateDownloadUrl(url, []));
  assert.equal(validateDownloadUrl(url, [host]).hostname, host);
});

test('validated address is pinned in the actual request lookup, TLS hostname retained', async () => {
  const { seen, options } = harness();
  await downloadWebhookVideo(url, '/fake/output.mp4', options);
  assert.equal(seen.resolves, 1); assert.equal(seen.requests, 1);
  assert.equal(seen.options.agent, false); assert.equal(seen.options.servername, host);
  assert.equal(seen.options.rejectUnauthorized, true); // Do not inherit an insecure TLS environment default.
  for (const all of [false, true]) {
    seen.options.lookup(host, { all }, (error, value, family) => {
      assert.equal(error, null);
      assert.deepEqual(value, all ? [{ address: '93.184.216.34', family: 4 }] : '93.184.216.34');
      if (!all) assert.equal(family, 4);
    });
  }
  assert.deepEqual(seen.writes, [{ output: '/fake/output.mp4', bytes: 'video' }]);
});

test('mixed public/private DNS answer is rejected before socket creation', async () => {
  const { seen, options } = harness({ addresses: [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] });
  await assert.rejects(downloadWebhookVideo(url, '/fake/output.mp4', options), /not_public/);
  assert.equal(seen.requests, 0); assert.equal(seen.writes.length, 0);
});

test('all redirects are rejected; Location is never followed', async () => {
  for (const location of ['http://169.254.169.254/', url]) {
    const { seen, options } = harness({ status: 302, headers: { location } });
    await assert.rejects(downloadWebhookVideo(url, '/fake/output.mp4', options), /status_rejected/);
    assert.equal(seen.requests, 1); assert.equal(seen.writes.length, 0);
  }
});

test('declared and streamed response limits prevent writes', async () => {
  for (const setup of [{ headers: { 'content-length': '100' } }, { chunks: ['123', '456'] }]) {
    const { seen, options } = harness(setup);
    await assert.rejects(downloadWebhookVideo(url, '/fake/output.mp4', { ...options, maxBytes: 4 }), /too_large/);
    assert.equal(seen.writes.length, 0);
  }
});

test('deadline includes DNS, and delayed resolution cannot start a request', async () => {
  let finish;
  const { seen, options } = harness({ resolver: () => new Promise(resolve => { finish = resolve; }) });
  await assert.rejects(downloadWebhookVideo(url, '/fake/output.mp4', { ...options, timeoutMs: 5 }), /timeout/);
  finish([{ address: '8.8.8.8', family: 4 }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(seen.requests, 0); assert.equal(seen.writes.length, 0);
});

test('socket errors fail closed with no output write', async () => {
  const { seen, options } = harness();
  options.request = () => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => req.emit('error', new Error('synthetic_socket_failure')));
    return req;
  };
  await assert.rejects(downloadWebhookVideo(url, '/fake/output.mp4', options), /synthetic_socket_failure/);
  assert.equal(seen.writes.length, 0);
});

test('deadline covers stalled body, and late bytes never reach disk', async () => {
  const { seen, options } = harness();
  let body;
  options.request = (_url, requestOptions, callback) => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      body = new Readable({ read() {} });
      body.statusCode = 200; body.headers = {};
      callback(body);
    });
    return req;
  };
  await assert.rejects(downloadWebhookVideo(url, '/fake/output.mp4', { ...options, timeoutMs: 5 }), /timeout/);
  body.push(Buffer.from('late bytes')); body.push(null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(seen.writes.length, 0);
});
