#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';

import { getConfig } from './config.js';
import { buildGenerationPayload, generateWithProvider, normalizeProvider, PROVIDERS } from './generation.js';
import { buildAgentManifest, buildConnectionStatus, buildPrivacyAudit, formatMarkdown } from './services/agent-surfaces.js';

const COMMANDS = new Set(['manifest', 'doctor', 'privacy-audit', 'payload', 'generate', 'help']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    if (args[key] === undefined) {
      args[key] = next;
    } else if (Array.isArray(args[key])) {
      args[key].push(next);
    } else {
      args[key] = [args[key], next];
    }
    i += 1;
  }
  return args;
}

function asArray(value) {
  if (Array.isArray(value)) return value.flatMap(asArray);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function readText(args, key) {
  const file = args[`${key}-file`];
  if (file) return fs.readFileSync(String(file), 'utf8').trim();
  return String(args[key] || '').trim();
}

function boolArg(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function commonGenerationParams(args) {
  return {
    provider: normalizeProvider(args.provider || 'openai_sora'),
    prompt: readText(args, 'prompt'),
    outputPath: String(args.output || '').trim(),
    model: String(args.model || '').trim(),
    durationSeconds: Number(args.duration || args.seconds || 8),
    aspectRatio: String(args['aspect-ratio'] || '9:16'),
    size: String(args.size || '720x1280'),
    resolution: String(args.resolution || '720p'),
    negativePrompt: readText(args, 'negative-prompt'),
    personGeneration: String(args['person-generation'] || '').trim(),
    imageUrl: String(args['image-url'] || '').trim(),
    referenceImageUrls: asArray(args['reference-image-url'] || args['reference-image-urls']),
    pollIntervalMs: Number(args['poll-interval-ms'] || 0),
    timeoutMs: Number(args['timeout-ms'] || 0)
  };
}

function output(data, args, title = 'Result') {
  if (args.format === 'markdown') {
    console.log(formatMarkdown(title, data));
    return;
  }
  console.log(JSON.stringify(data, null, 2));
}

function help() {
  return {
    name: 'short-video-agent-kit',
    providers: PROVIDERS,
    usage: [
      'short-video-agent-kit doctor',
      'short-video-agent-kit payload --provider gemini_veo --prompt-file prompt.txt',
      'short-video-agent-kit generate --provider openai_sora --prompt "Vertical launch video" --output ./out.mp4 --live'
    ],
    safety: 'Generation is dry-run by default. Set --live or SHORT_VIDEO_DRY_RUN=false only when paid provider calls are intended.'
  };
}

export async function runCliCommand(argv = process.argv.slice(2)) {
  const command = argv[0] || 'help';
  if (!COMMANDS.has(command)) return undefined;

  const args = parseArgs(argv.slice(1));
  const cfg = getConfig();

  if (command === 'help') {
    output(help(), args, 'Short Video Agent Kit');
    return 0;
  }

  if (command === 'manifest') {
    output(buildAgentManifest({ client: args.client || 'generic' }), args, 'Short Video Agent Manifest');
    return 0;
  }

  if (command === 'doctor') {
    output(buildConnectionStatus({ env: process.env }), args, 'Short Video Connection Status');
    return 0;
  }

  if (command === 'privacy-audit') {
    output(buildPrivacyAudit(), args, 'Short Video Privacy Audit');
    return 0;
  }

  if (command === 'payload') {
    output(buildGenerationPayload(commonGenerationParams(args)), args, 'Short Video Generation Payload');
    return 0;
  }

  if (command === 'generate') {
    const params = commonGenerationParams(args);
    const live = boolArg(args.live, false) || cfg.dryRun === false;
    if (!live) {
      output({
        ok: true,
        dry_run: true,
        next_step: 'Pass --live or set SHORT_VIDEO_DRY_RUN=false to call the provider API.',
        ...buildGenerationPayload(params)
      }, args, 'Short Video Dry Run');
      return 0;
    }
    output(await generateWithProvider({ cfg, ...params }), args, 'Short Video Generation Result');
    return 0;
  }

  return undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const code = await runCliCommand();
    if (code === undefined) {
      output(help(), {}, 'Short Video Agent Kit');
      process.exitCode = 1;
    } else {
      process.exitCode = code;
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
