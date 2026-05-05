export function makeResponse(data, format = 'json', markdown = '') {
  return {
    content: [{
      type: 'text',
      text: format === 'markdown' ? markdown || toMarkdown('Result', data) : JSON.stringify(data, null, 2)
    }],
    structuredContent: data
  };
}

export function makeError(error) {
  const message = redactSecretText(error instanceof Error ? error.message : String(error));
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}` }],
    structuredContent: { error: message }
  };
}

export function toMarkdown(title, data) {
  const lines = [`# ${title}`, ''];
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || value === null || value === '') continue;
    lines.push(`- **${key}**: ${formatValue(value)}`);
  }
  return lines.join('\n');
}

export function redactSecretText(value) {
  return String(value)
    .replace(/([?&](?:token|key|api_key|client_secret|authorization)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
}

function formatValue(value) {
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join(', ') : '(none)';
  if (typeof value === 'object' && value !== null) return JSON.stringify(value);
  return String(value);
}
