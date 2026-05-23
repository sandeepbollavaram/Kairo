# Publishing Kairo to npm

> First-time publish + ongoing release runbook. Kept short on purpose;
> nothing here is automated by Claude — every `npm publish` is a human
> decision.

## One-time prerequisites

1. **npm account** at https://www.npmjs.com/signup.
   - The Kairo maintainer email matches the GitHub account email.
   - **Enable 2FA** on the npm account (Settings → "Auth & Security"
     → set 2FA to _Authorization and writes_). npm rejects publishes
     to public packages without 2FA on modern accounts.
2. **Local login**:
   ```bash
   npm login
   # Username: <your npm username>
   # Email:    <your npm email>
   # Password / 2FA OTP follows.
   ```
   Verify with `npm whoami`.
3. **Name availability**: the package name is `kairo-mcp`. Check:
   ```bash
   npm view kairo-mcp
   ```
   If npm replies "404 Not Found", the name is free — proceed.
   If it returns an existing package, fall back to the scoped form by
   editing `package.json`:
   ```jsonc
   { "name": "@sandeepbollavaram/kairo", ... }
   ```
   (The scoped form needs `publishConfig.access: "public"` — already set.)

## Before every publish

The verification gate that gates the GitHub release also gates the npm
release. Run it locally first; CI runs the same gate.

```bash
# 1. The local gate (same as ci.yml's per-cell job)
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test                    # 193/193 passing
npm run build               # produces dist/

# 2. Inspect what's actually going into the tarball
npm pack --dry-run | tail -20

# 3. Confirm tarball contents do NOT include:
#    - .kairo/                     (any project state)
#    - tests/, *.test.ts           (the test suite)
#    - extensions/                 (VS Code extension; separate package)
#    - .github/, .git/             (workflow files)
#    - node_modules/               (dependencies are pulled by the consumer)
#    - Any *.env, secrets, fixtures
npm pack --dry-run 2>&1 | grep -E '\.kairo|test|fixtures|secret|env|\.git' || echo "clean"

# 4. Install the packed tarball into a throwaway project and smoke-test
mkdir -p /tmp/kairo-publish-smoke && cd /tmp/kairo-publish-smoke
npm init -y >/dev/null
npm install ~/path/to/kairo-mcp-1.3.0.tgz
./node_modules/.bin/kairo --version
./node_modules/.bin/kairo doctor --json -C .
cd - && rm -rf /tmp/kairo-publish-smoke
```

The GitHub Actions **install-smoke** job runs this same sequence on
Ubuntu in CI. If it's green, your local smoke will be green.

## Publishing

```bash
# 1. Make sure you're on a clean main with the right tag.
git status                  # working tree clean
git describe --tags         # matches package.json version

# 2. Confirm the version matches the tag.
node -p "require('./package.json').version"   # e.g. 1.3.0
git tag -l v1.3.0           # tag exists

# 3. Dry-run publish (no upload; shows what would happen).
npm publish --dry-run

# 4. Real publish.
npm publish
#   - If using the scoped name (@sandeepbollavaram/kairo) the first time,
#     pass --access public on the first publish only.
#   - npm will prompt for your 2FA OTP. Type it in and press enter.
```

After `npm publish` succeeds:

- `npm view kairo-mcp` shows the new version + the README rendered on
  https://www.npmjs.com/package/kairo-mcp.
- `npm install -g kairo-mcp` works for users globally.
- `npx -p kairo-mcp kairo init` works without a global install.

## What npm will reject (the safety net)

- **Files outside the `files:` allowlist** — already constrained in
  `package.json` to `dist`, `README.md`, `LICENSE`, `CHANGELOG.md`.
- **Missing `prepublishOnly`** — already set; runs `npm run build`
  before the tarball is created.
- **Stale `dist/`** — `prepublishOnly` rebuilds it, so even if you
  forgot, npm builds it fresh.
- **Version already published** — npm refuses to overwrite a version.
  Bump and re-tag.

## Yanking a bad publish

If a published version has a real problem (rare, but the v1.0.0 → v1.0.1
saga shows it happens):

```bash
# 1. Deprecate it within 72 hours of publish.
npm deprecate kairo-mcp@1.3.0 "broken: use 1.3.1"

# 2. Fix it. Bump to 1.3.1. Publish.
```

**Do not** use `npm unpublish` unless you literally just published seconds
ago and nobody can have installed it. Unpublishing public packages older
than 72 hours requires npm support intervention.

## What stays out of Kairo's repo

This file is the only thing in the repo that documents publishing. The
GitHub Actions workflows **never** call `npm publish` automatically.
Every npm release is a maintainer decision, run from a clean local
checkout with 2FA. CI handles tagging and the GitHub Release; npm
publish stays human.
