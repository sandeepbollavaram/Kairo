<!--
  Thanks for contributing. Kairo's bar is determinism + replay-safety +
  honest scope. The four questions below exist because they're where
  most regressions sneak in.
-->

## What's the smallest user-visible change?

<!-- One or two sentences. If it's "no user-visible change", say so. -->

## Stability contract

- [ ] If this PR adds a documented surface (MCP tool, inspect route,
      schema, snapshot field, CLI command), it has an entry in
      `src/contracts/stability.ts`.
- [ ] If this PR renames or removes a `stable` surface, it goes
      through the deprecation cycle in `docs/API_STABILITY.md`.

## Schemas & migrations (ADR-0012)

- [ ] No schema constant was changed, OR a migration is shipped in this
      same PR and a frozen fixture test was added.

## Determinism & replay-safety

- [ ] No new `Date.now()` / `Math.random()` inside a hashable path
      (use `Clock` / pass `now` explicitly).
- [ ] No new network I/O in core paths (the only network surface is
      `HttpEmbeddingProvider`, opt-in via env).
- [ ] Tests still pass with `--no-color` and on a non-TTY stdout.

## Verification gate (paste the local result if you ran it)

```
npm run typecheck   # 0 errors
npm run lint        # 0 errors
npm run format:check
npm test            # N/N passing
npm run build       # 0 errors
```

## Honest scope

<!--
  Anything this PR deliberately *doesn't* do that a reviewer might
  expect? Anything it's a step toward but not the whole thing?
-->
