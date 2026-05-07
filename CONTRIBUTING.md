# Contributing

Contributions are welcome around provider planning, dry-run safety, video generation ergonomics, MCP tools, tests and docs.

## Local development

```bash
npm ci
npm run check
npm test
npm run doctor
npm run manifest
npm run privacy
```

## Design rules

- Keep dry-run/planning behavior safe for agents.
- Never commit provider API keys, generated private media, prompt files with customer data or local config.
- Keep provider-specific generation calls explicit.
- Preserve manifest, connection status, privacy audit and metadata checks.

## Pull request checklist

- `npm run check` passes.
- `npm test` passes.
- README, `llms.txt` and examples are updated when commands or tools change.
