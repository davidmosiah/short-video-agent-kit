# MCP input boundaries and runtime dependency update

The MCP executable now defaults to stdio when invoked without CLI arguments.
Explicit CLI commands and `--http` retain their routes. The CLI executable still
shows help without arguments. A stdio handshake regression is covered by the
input-boundary suite.

Tool argument collections are limited to 10,000 object members plus array elements,
including nested containers, before input-schema parsing/handler execution. Both
stdio and HTTP use this ceiling. It is not a total process-memory/protocol limit.
Normal and exactly-at-limit arguments are tested, as are recovery after rejection.

The existing HTTP JSON byte limit remains 2MiB. HTTP compressed request bodies are
now rejected rather than inflated. This is a deliberate compatibility boundary;
clients must send uncompressed JSON. Tests cover gzip/deflate/br with and without
trailing bytes, malformed JSON, over-limit bodies, uncompressed UTF-16 JSON, and
continued server availability. HTTP access control is unchanged.

Dependency updates are targeted to patched MCP SDK/Zod and their vulnerable
transitive parsers/server dependencies. Lock resolution uses the official npm
registry with installation lifecycle scripts disabled. No provider credentials,
paid API calls, permission changes or live publication are part of verification.

The dependency audit snapshot reported 0 vulnerabilities after the update; that is
not proof of an absence of all vulnerabilities. Local full tests passed on official
Node 20.20.2 and Node 24.22.1; GitHub CI passed on Node 22.23.4 for the runtime/dependency
commit. See WEBHOOK_SECURITY.md for controlled TLS coverage and its explicit
loopback-routing limitation. Operator-approved provider hostnames and compatible
identifiers remain deployment configuration requirements; no live provider was
contacted. Subsequent changes must pass their own exact-head CI before integration.
