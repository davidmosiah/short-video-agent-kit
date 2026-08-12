import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

function documentedHttpCommand() {
  const match = readme.match(/npx -y -p (\S+) (\S+) --http/);
  assert.ok(match, 'README must document npx -y -p <pkg> <mcp-bin> --http');
  return { pkgName: match[1], bin: match[2] };
}

test('README HTTP command maps to the MCP bin (index.js), not the CLI', () => {
  const { pkgName, bin } = documentedHttpCommand();
  assert.equal(pkgName, pkg.name);
  assert.equal(pkg.bin[bin], 'src/index.js');
  assert.notEqual(pkg.bin[pkg.name], 'src/index.js');
  assert.match(pkg.bin[pkg.name], /cli\.js$/);
});

test('CLI --http does not start HTTP MCP', async () => {
  const child = spawn(process.execPath, [join(root, 'src/cli.js'), '--http'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const out = [];
  child.stdout.on('data', (c) => out.push(c));
  child.stderr.on('data', (c) => out.push(c));
  const code = await new Promise((resolve) => child.on('close', resolve));
  const text = Buffer.concat(out).toString('utf8');
  assert.notEqual(code, 0);
  assert.doesNotMatch(text, /HTTP transport listening/);
});

test('documented MCP bin --http serves /health and sessionless /mcp', async () => {
  const { bin } = documentedHttpCommand();
  const entry = join(root, pkg.bin[bin]);
  const port = 18773;
  const child = spawn(process.execPath, [entry, '--http'], {
    cwd: root,
    env: { ...process.env, SHORT_VIDEO_MCP_HOST: '127.0.0.1', SHORT_VIDEO_MCP_PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  const started = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('http boot timeout')), 8000);
    child.stderr.on('data', (chunk) => {
      if (String(chunk).includes('/mcp')) {
        clearTimeout(timer);
        resolve(true);
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`mcp bin exited ${code}`)));
  });
  assert.equal(started, true);
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.ok, true);
    assert.ok(health.name);
    const mcpRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'readme-bin', version: '0' } }
      })
    });
    const text = await mcpRes.text();
    assert.equal(mcpRes.headers.get('mcp-session-id'), null);
    assert.match(text, /"jsonrpc"\s*:\s*"2\.0"/);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.on('close', r));
  }
});
