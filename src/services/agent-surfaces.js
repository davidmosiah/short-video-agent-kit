export const SUPPORTED_CLIENTS = ['generic', 'claude', 'codex', 'cursor', 'windsurf', 'hermes', 'openclaw'];

function safeClient(client = 'generic') {
  return SUPPORTED_CLIENTS.includes(client) ? client : 'generic';
}

function present(env, key) {
  return Boolean(String(env?.[key] || '').trim());
}

function enabled(env, key, fallback = false) {
  const value = env?.[key];
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function buildAgentManifest({ client = 'generic' } = {}) {
  return {
    project: 'short-video-agent-kit',
    mcp_name: 'io.github.davidmosiah/short-video-agent-kit',
    client: safeClient(client),
    package: {
      name: 'short-video-agent-kit',
      install_command: 'npx -y short-video-agent-kit',
      binary: 'short-video-agent-kit'
    },
    supported_clients: SUPPORTED_CLIENTS,
    providers: ['openai_sora', 'gemini_veo', 'xai_grok', 'seedance_piapi'],
    standard_tools: [
      'short_video_agent_manifest',
      'short_video_connection_status',
      'short_video_privacy_audit',
      'short_video_build_payload',
      'short_video_generate'
    ],
    recommended_first_calls: ['short_video_connection_status', 'short_video_privacy_audit'],
    hermes: {
      config_path: '~/.hermes/config.yaml',
      tool_name_prefix: 'mcp_short_video_',
      reload_after_config_change: '/reload-mcp or hermes mcp test short_video',
      recommended_config: 'mcp_servers:\n  short_video:\n    command: npx\n    args: ["-y", "short-video-agent-kit"]\n    sampling:\n      enabled: false'
    },
    agent_rules: [
      'Call short_video_connection_status before generation.',
      'Keep prompts and generated media in user-controlled local paths.',
      'Never print API keys or provider authorization headers.',
      'Only use user-owned or licensed reference images.',
      'Return structured provider metadata so agents can retry or poll safely.'
    ]
  };
}

export function buildConnectionStatus({ env = process.env } = {}) {
  const providers = {
    openai_sora: {
      configured: present(env, 'OPENAI_API_KEY'),
      env_keys: ['OPENAI_API_KEY'],
      models: [env.OPENAI_VIDEO_MODEL || 'sora-2']
    },
    gemini_veo: {
      configured: present(env, 'GEMINI_API_KEY') || present(env, 'GOOGLE_API_KEY'),
      env_keys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      models: [env.GEMINI_VIDEO_MODEL || 'veo-3.1-fast-generate-preview']
    },
    xai_grok: {
      configured: present(env, 'XAI_API_KEY'),
      env_keys: ['XAI_API_KEY'],
      models: [env.XAI_VIDEO_MODEL || 'grok-imagine-video', env.XAI_IMAGE_MODEL || 'grok-imagine-image']
    },
    seedance_piapi: {
      configured: present(env, 'PIAPI_KEY') || present(env, 'SEEDANCE_API_KEY'),
      env_keys: ['PIAPI_KEY', 'SEEDANCE_API_KEY'],
      models: [env.SEEDANCE_VIDEO_MODEL || 'seedance-2-fast-preview']
    }
  };

  return {
    ok: Object.values(providers).some((provider) => provider.configured),
    dry_run: enabled(env, 'SHORT_VIDEO_DRY_RUN', true),
    providers,
    output_dir: env.SHORT_VIDEO_OUTPUT_DIR || './output',
    next_steps: Object.values(providers).some((provider) => provider.configured)
      ? ['At least one provider is configured. Run provider-specific dry payload tests before paid generation.']
      : ['Set one provider key: OPENAI_API_KEY, GEMINI_API_KEY, XAI_API_KEY or PIAPI_KEY.']
  };
}

export function buildPrivacyAudit() {
  return {
    project: 'short-video-agent-kit',
    secrets_returned_to_agent: false,
    local_files_ignored: ['.env', 'output/', '.agent-data/', 'node_modules/', 'coverage/'],
    external_services: ['OpenAI Videos API', 'Google Gemini/Veo API', 'xAI API', 'PiAPI Seedance API'],
    token_storage: 'Provider API keys are read from environment variables or local .env and are never returned by tools.',
    safety_rules: [
      'Use user-owned or licensed reference assets only.',
      'Avoid logging full prompts when they contain private campaign strategy or unreleased creative details.',
      'Store outputs in user-controlled local directories.',
      'Make paid generation explicit; use payload builders for dry validation.',
      'Respect each provider policy and disclose synthetic media where platforms require it.'
    ]
  };
}

export function formatMarkdown(title, data) {
  return [`# ${title}`, '', '```json', JSON.stringify(data, null, 2), '```'].join('\n');
}
