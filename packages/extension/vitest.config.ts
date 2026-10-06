import { defineConfig } from 'vitest/config';

// The stdio LSP suite. It drives the bundled server through bin/, so it needs
// `pnpm run build` first; the VS Code suite in test/vscode runs under
// @vscode/test-cli instead.
export default defineConfig({
    test: {
        include: ['test/lsp/**/*.test.ts'],
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
