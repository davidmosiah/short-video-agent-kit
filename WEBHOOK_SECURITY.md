# Webhook security migration

Automatic callback downloads now require exact, trusted media hostnames:

    node src/tools/seedance-webhook.js serve --secret "$SEEDANCE_WEBHOOK_SECRET" \
      --output-dir ./data/webhooks --download-dir ./output \
      --download-hosts '<verified-media-hostname>'

Obtain current media hostnames from the provider's trusted configuration; do not copy a host supplied by an untrusted callback into this policy. Multiple hosts are comma-separated. No wildcard, implicit subdomain, IP-literal, credential-bearing URL, non-HTTPS protocol or non 443 port is accepted. There is deliberately **no default media host**: existing fixtures reference img.theapi.app but are not authoritative documentation of the provider's complete/current CDN policy.

DNS answers must all be public. The validated address is pinned in the actual TLS socket lookup while the original hostname remains the certificate/SNI identity. Connections are not reused. Downloads use direct Node HTTPS sockets, not a configured HTTP proxy or custom agent. Deployments requiring proxy-only egress are not supported by this downloader; do not weaken address/TLS policy to bypass that restriction. Redirects are rejected entirely (even between allowed hosts): configure the final trusted URL. Downloads are bounded to 64MiB and 30s including DNS/body. Successful bytes are written through a fresh 0600 temporary file and rename, rather than directly truncating an existing destination. Existing credential files/permissions are not modified.

Callback task IDs must contain 1–128 ASCII letters/digits/hyphens/underscores, start alphanumeric, and are never treated as paths. Invalid IDs receive 400 before files or downstream callbacks. Diagnostic header files retain only content-type/content-length/user-agent; authentication headers are excluded. Existing header artifacts are not deleted or rewritten automatically: investigate exposure and obtain authority before rotation/remediation.

The webhook still requires a secret (except explicitly opted-in insecure loopback testing). Output/download directories must be private to the service account; hostile local symlink races and directory manipulation are outside this patch. This is not a complete inbound DoS defense: body parsing remains a separate hardening item. Other provider download helpers and HTTP MCP authentication are unchanged.

## Checks performed
The standalone security tests cover DNS policy, pinned lookup, headers, identifiers, limits and deadlines with mocks. Full application tests and MCP transport boundaries also passed in isolated credential-free environments on Node 20.20.2 and Node 24.22.1; GitHub CI passed on Node 22.23.4. The dependency audit at that snapshot reported zero known vulnerabilities, not a guarantee of vulnerability absence.

An author-created local HTTPS fixture additionally verified explicit trusted-CA success and rejection of an untrusted certificate, incorrect hostname, redirects, oversized responses and deadline expiry without late writes on Node 20/24. Its test transport checks the pinned lookup answers before translating routing to loopback: this exercises real TLS and response handling but does not claim public-network DNS/rebinding or live-provider compatibility. No production credentials or provider APIs were used. Installation lifecycle scripts were disabled.

The public-address policy is intentionally conservative: e.g. all 192.0/16 is rejected, and IPv 6 is restricted to global 2000::/3 excluding special/transition ranges. TLS certificate verification is explicitly required even if the process environment would otherwise disable its default.

