// @ts-check
import { defineConfig } from '@vscode/test-cli';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// The suite edits settings, which VS Code writes to <workspace>/.vscode, so it
// runs on a throwaway copy of the fixture rather than the checked-in one.
const workspace = mkdtempSync(join(tmpdir(), 'ott-e2e-'));
cpSync('test/fixtures/workspace', workspace, { recursive: true });

export default defineConfig({
    label: 'vscode',
    files: 'out/test/vscode/**/*.test.cjs',
    // CI also runs this against engines.vscode, the oldest release we claim.
    version: process.env.VSCODE_TEST_VERSION ?? 'stable',
    // Point at an unpacked .vsix to test what ships rather than the checkout.
    extensionDevelopmentPath: resolve(process.env.OTT_EXTENSION_PATH ?? '.'),
    workspaceFolder: workspace,
    launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
    mocha: { ui: 'tdd', timeout: 60_000 },
});
