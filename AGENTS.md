# Agent Development Notes

## Scope

This repo is an agent-first short-form video generation CLI and MCP server for model/provider orchestration.

## Commands

- Install: `npm ci`
- Syntax check: `npm run check`
- Test: `npm test`
- Doctor: `npm run doctor`
- Manifest: `npm run manifest`
- Privacy audit: `npm run privacy`

## Rules

- Never commit provider API keys, generated private media, prompt files with customer data, or local config.
- Keep dry-run and planning behavior safe for agents.
- Preserve manifest, connection status, privacy audit and metadata checks.
- Keep provider-specific mutation/generation calls explicit.
