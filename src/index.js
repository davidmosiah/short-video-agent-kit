#!/usr/bin/env node
import cors from 'cors';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { getConfig } from './config.js';
import { buildGenerationPayload, generateWithProvider, PROVIDERS } from './generation.js';
import { runCliCommand } from './cli.js';
import { makeError, makeResponse, toMarkdown } from './mcp-utils.js';
import { buildAgentManifest, buildConnectionStatus, buildPrivacyAudit, formatMarkdown } from './services/agent-surfaces.js';

const SERVER_NAME = 'short-video-agent-kit';
const SERVER_VERSION = '0.1.0';
const ResponseFormatSchema = z.enum(['json', 'markdown']).default('json');
const ProviderSchema = z.enum(PROVIDERS);

function GenerationSchema() {
  return {
    provider: ProviderSchema.default('openai_sora'),
    prompt: z.string(),
    output_path: z.string().default(''),
    model: z.string().default(''),
    duration_seconds: z.number().int().min(1).max(30).default(8),
    aspect_ratio: z.string().default('9:16'),
    size: z.string().default('720x1280'),
    resolution: z.string().default('720p'),
    negative_prompt: z.string().default(''),
    person_generation: z.string().default(''),
    image_url: z.string().default(''),
    reference_image_urls: z.array(z.string()).default([]),
    live: z.boolean().default(false),
    response_format: ResponseFormatSchema
  };
}

function toGenerationParams(params) {
  return {
    provider: params.provider,
    prompt: params.prompt,
    outputPath: params.output_path,
    model: params.model,
    durationSeconds: params.duration_seconds,
    aspectRatio: params.aspect_ratio,
    size: params.size,
    resolution: params.resolution,
    negativePrompt: params.negative_prompt,
    personGeneration: params.person_generation,
    imageUrl: params.image_url,
    referenceImageUrls: params.reference_image_urls
  };
}

function registerTools(server) {
  server.registerTool('short_video_agent_manifest', {
    title: 'Short Video Agent Manifest',
    description: 'Machine-readable install, provider, runtime and safety guidance for agents.',
    inputSchema: {
      client: z.string().default('generic'),
      response_format: ResponseFormatSchema
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ client, response_format }) => {
    const manifest = buildAgentManifest({ client });
    return makeResponse(manifest, response_format, formatMarkdown('Short Video Agent Manifest', manifest));
  });

  server.registerTool('short_video_connection_status', {
    title: 'Short Video Connection Status',
    description: 'Check configured providers and dry-run mode without exposing API keys.',
    inputSchema: { response_format: ResponseFormatSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const status = buildConnectionStatus({ env: process.env });
    return makeResponse(status, response_format, toMarkdown('Short Video Connection Status', status));
  });

  server.registerTool('short_video_privacy_audit', {
    title: 'Short Video Privacy Audit',
    description: 'Return prompt, asset, output and provider-key safety boundaries.',
    inputSchema: { response_format: ResponseFormatSchema },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ response_format }) => {
    const audit = buildPrivacyAudit();
    return makeResponse(audit, response_format, toMarkdown('Short Video Privacy Audit', audit));
  });

  server.registerTool('short_video_build_payload', {
    title: 'Build Short Video Payload',
    description: 'Build a provider-specific request payload without calling the paid provider API.',
    inputSchema: GenerationSchema(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async (params) => {
    try {
      const payload = buildGenerationPayload(toGenerationParams(params));
      return makeResponse(payload, params.response_format, toMarkdown('Short Video Payload', payload));
    } catch (error) {
      return makeError(error);
    }
  });

  server.registerTool('short_video_generate', {
    title: 'Generate Short Video',
    description: 'Generate one vertical video. Returns a dry-run payload unless live=true or SHORT_VIDEO_DRY_RUN=false.',
    inputSchema: GenerationSchema(),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async (params) => {
    try {
      const cfg = getConfig();
      const generationParams = toGenerationParams(params);
      const live = params.live || cfg.dryRun === false;
      if (!live) {
        const payload = {
          ok: true,
          dry_run: true,
          next_step: 'Set live=true or SHORT_VIDEO_DRY_RUN=false to call the provider API.',
          ...buildGenerationPayload(generationParams)
        };
        return makeResponse(payload, params.response_format, toMarkdown('Short Video Dry Run', payload));
      }
      const result = await generateWithProvider({ cfg, ...generationParams });
      return makeResponse(result, params.response_format, toMarkdown('Short Video Generation Result', result));
    } catch (error) {
      return makeError(error);
    }
  });
}

function createServer() {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server);
  return server;
}

async function runStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

async function runHttp() {
  const cfg = getConfig();
  const app = express();
  const allowedOrigin = cfg.mcp.allowedOrigin || `http://${cfg.mcp.host}:${cfg.mcp.port}`;
  app.use(express.json({ limit: '2mb' }));
  app.use(cors({ origin: allowedOrigin }));
  app.get('/health', (_req, res) => res.json({ ok: true, name: SERVER_NAME, version: SERVER_VERSION }));
  app.post('/mcp', async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('MCP HTTP request failed:', error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  });
  app.listen(cfg.mcp.port, cfg.mcp.host, () => {
    console.error(`${SERVER_NAME} HTTP transport listening on http://${cfg.mcp.host}:${cfg.mcp.port}/mcp`);
  });
}

let cliResult;
try {
  cliResult = await runCliCommand(process.argv.slice(2));
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

if (cliResult !== undefined) {
  process.exitCode = cliResult;
} else if (process.exitCode === undefined) {
  const args = new Set(process.argv.slice(2));
  const transport = process.env.SHORT_VIDEO_MCP_TRANSPORT || (args.has('--http') ? 'http' : 'stdio');
  if (transport === 'http') await runHttp();
  else await runStdio();
}
