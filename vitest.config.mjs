import { defineConfig } from 'vitest/config';

// Scope test discovery to the project's own tests. Without an explicit exclude,
// `vitest run tests/unit` also matches `tests/unit` inside any stale git worktree
// under `.claude/worktrees/`, pulling in outdated copies of test files that report
// phantom failures. Keep the default excludes and add worktrees + build output.
export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/.claude/**',
      '**/cypress/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
  },
});
