# Webhook security migration

Automatic callback downloads now require exact, trusted media hostnames:

    node src/tools/seedance-webhook.js serve --secret "$SEEDANCE_WEBHOOK_SECRET" \
      --output-dir ./data/webhooks --download-dir ./output \
      --download-hosts '<verified-media-hostname>'

Obtain current media hostnames from the provider's trusted configuration; do not copy a host supplied by an untrusted callback into this policy. Multiple hosts are comma-separated. No wildcard, implicit subdomain, IP-literal, credential-bearing URL, non-HTTPS protocol or non443 port is accepted. There is deliberately **no default media host**: existing fixtures reference img.theapi.app but are not authoritative documentation of the provider's complete/current CDN policy.

DNS answers must all be public. The validated address is pinned in the actual TLS socket lookup while the original hostname remains the certificate/SNI identity. Connections are not reused. Redirects are rejected entirely (even between allowed hosts): configure the final trusted URL. Downloads are bounded to64MiB and30s including DNS/body. Successful bytes are written through a fresh0600 temporary file and rename, rather than directly truncating an existing destination. Existing credential files/permissions are not modified.

Callback task IDs must contain1–128 ASCII letters/digits/hyphens/underscores, start alphanumeric, and are never treated as paths. Invalid IDs receive400 before files or downstream callbacks. Diagnostic header files retain only content-type/content-length/user-agent; authentication headers are excluded. Existing header artifacts are not deleted or rewritten automatically: investigate exposure and obtain authority before rotation/remediation.

The webhook still requires a secret (except explicitly opted-in insecure loopback testing). Output/download directories must be private to the service account; hostile local symlink races and directory manipulation are outside this patch. This is not a complete inbound DoS defense: body parsing remains a separate hardening item. Other provider download helpers and HTTP MCP authentication are unchanged.

## Checks performed
Only the newly authored webhook-security.mjs was executed, through its newly authored standalone Node tests with mocked DNS/network/writes. No upstream application, package lifecycle, integration test, real DNS, provider endpoint, credential or external service was used. Existing webhook integration tests were expanded but not executed; full integration requires a separately authorized sandbox. No installation or publish happened.

The public-address policy is intentionally conservative: e.g. all192.0/16 is rejected, and IPv6 is restricted to global2000::/3 excluding special/transition ranges. TLS certificate verification is explicitly required even if the process environment would otherwise disable its default.
