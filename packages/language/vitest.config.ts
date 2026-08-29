/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://vitest.dev/config/
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        deps: {
            interopDefault: true
        },
        include: ['**/*.test.ts'],
        // `include` above matches no *.bench.ts, so benchmarks need their own
        // glob. They live under test/ so tsconfig.test.json type-checks them —
        // the pre-push hook runs tsc -b, so they must compile.
        benchmark: {
            include: ['test/**/*.bench.ts'],
        }
    }
});
