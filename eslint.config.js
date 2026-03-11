import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import security from 'eslint-plugin-security';

export default tseslint.config(
    {
        ignores: [
            '**/out/**',
            '**/generated/**',
            '**/node_modules/**',
            '**/*.cjs',
            'packages/extension/esbuild.mjs',
        ],
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    sonarjs.configs.recommended,
    security.configs.recommended,
    {
        plugins: { unicorn },
        rules: {
            // Unicorn - selective rules
            'unicorn/prefer-node-protocol': 'error',
            'unicorn/no-array-push-push': 'error',
            'unicorn/prefer-array-flat-map': 'error',
            'unicorn/prefer-string-starts-ends-with': 'error',
            'unicorn/no-lonely-if': 'error',
            'unicorn/no-useless-spread': 'error',
            'unicorn/prefer-optional-catch-binding': 'error',

            // TypeScript overrides
            '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'warn',

            // SonarJS tuning
            'sonarjs/cognitive-complexity': ['warn', 15],
            'sonarjs/no-duplicate-string': 'off',

            // Security - already good defaults
        },
    },
);
