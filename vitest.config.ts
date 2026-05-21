import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 15s ceiling. Several tests do real filesystem + spawn work and the
    // default 5s flakes on Windows + Node 22 CI runners (v1.1.1 dogfood
    // caught this on tests/snapshot.test.ts). Fast tests don't notice;
    // honest integration tests get headroom. The single heaviest test
    // sets a higher per-test ceiling at its callsite.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/*.d.ts'],
    },
  },
});
