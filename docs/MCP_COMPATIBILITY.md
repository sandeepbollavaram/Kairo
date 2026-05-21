# MCP compatibility

> What Kairo guarantees about its Model Context Protocol surface.

## Server identity

- `name`: `kairo`
- `version`: matches `SERVER_VERSION` in
  [`src/server/createServer.ts`](../src/server/createServer.ts) (semver,
  v0.9.4 at the time of writing).
- Transport: **stdio** (`StdioServerTransport`).

## Protocol baseline

Kairo speaks `@modelcontextprotocol/sdk` v1.x. The contract surface is:

| Capability                          | Stable since | Notes                                                   |
| ----------------------------------- | ------------ | ------------------------------------------------------- |
| `tools/list` + `tools/call`         | v0.1.0       | 41 tools at v0.9.4.                                     |
| `prompts/list` + `prompts/get`      | v0.1.0       | One prompt: `kairo_continuity`.                         |
| `resources/list` + `resources/read` | v0.1.0       | `kairo://session/current`, `kairo://checkpoint/latest`. |

Other MCP capabilities (sampling, roots, notifications) are not exposed.
Adding any of them in a future minor would be additive and back-compat.

## Wire-level invariants

1. **Server name and version are reported on initialize**, exactly as in
   `createServer.ts`. Downstream version-detection code can rely on this.
2. **Every tool has a name and an inputSchema object.** Verified by
   `tests/integration.server.test.ts`.
3. **`tools/list` returns at least the names in
   [`docs/API_STABILITY.md`](API_STABILITY.md)** marked `stable`. Adding
   tools is back-compat; removing a stable tool requires a deprecation
   cycle (ADR-0015).
4. **Invalid tool input does NOT crash the transport.** Bad arguments
   produce an error result; subsequent `tools/list` and `tools/call`
   continue to work on the same connection.
5. **Compact responses by default** (ADR-0010). Every stable tool returns a
   single-line summary as the human-readable content. Reports go to
   `.kairo/reports/`. The token-discipline contract is part of stability.
6. **Resource URIs** under the `kairo://` scheme are stable strings;
   their content shape follows the same schema-versioning policy as
   on-disk artefacts (ADR-0012).
7. **Clean shutdown.** `server.close()` resolves and the stdio process
   exits cleanly on SIGINT/SIGTERM (see `src/index.ts`).

## Backward-compatible tool schemas

A `stable` tool's `inputSchema` may:

- **Add** optional arguments (back-compat).
- Add or relax constraints on existing optional arguments (back-compat in
  the sense that previously valid input remains valid).

A `stable` tool's `inputSchema` may NOT:

- Remove an existing argument.
- Rename an argument.
- Make a previously optional argument required.
- Change the JSON type of an argument.

Any of those changes requires a deprecation cycle (one minor version of
notice, replacement documented in the CHANGELOG).

## Error shape stability

The current MCP SDK returns errors as a tool call result with
`isError: true` and a `content` array. Kairo's `fail(e)` helper preserves
this shape, with the error message as `content[0].text`. The text content
of error messages is **not** a stability promise (we may rephrase for
clarity); the _shape_ is.

## Versioning policy

- **Patch** (`0.9.x → 0.9.y`): no protocol-visible changes. Bug fixes,
  internal refactors, doc updates only.
- **Minor** (`0.X → 0.X+1`): may add new tools / prompts / resources;
  may bump experimental tools to stable. May deprecate stable surfaces
  with a one-minor notice.
- **Major** (`X → X+1`): may remove deprecated surfaces. Schema bumps
  ship with migrations in the same release.

`SERVER_VERSION` increments accordingly. Hosts that need to gate behavior
can read it from `initialize`.

## Compatibility matrix

See [V1_READINESS.md](V1_READINESS.md) for the supported Node versions,
MCP SDK versions, transports, embedder providers, and OS/filesystem
assumptions.

## Compatibility tests

[`tests/integration.server.test.ts`](../tests/integration.server.test.ts)
runs against the actual built binary over stdio with the official MCP
SDK client. It asserts:

- The full v0.9.4 tool surface is advertised.
- The continuity prompt and state resources are listed.
- A full session (start → record → assess → checkpoint → end) drives
  every continuity-loop tool.
- Persisted `.kairo/` artefacts match the documented format.
- A fresh client resumes from the prior continuation brief without
  rescanning the repo.
- `tools/list` shape is stable; bad input does not kill the transport.
- `kairo_stability_of` returns the registered tier for any known surface.

CI runs these tests against every commit. A failure on a stable surface
blocks the release.
