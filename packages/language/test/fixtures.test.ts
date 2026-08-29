import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import type { SourceFile } from 'ott-language';
import { createOttServices, isSourceFile } from 'ott-language';
import {
    FIXTURES_DIR, OTT_REJECTS, OTT_UNPARSEABLE, collectOttFiles, ottAccepts, resolveOttBinary,
} from './helpers.js';

/**
 * Files that ott parses but our Langium grammar doesn't yet support.
 * Empty: every parseable file in the corpus now parses without errors. The two
 * rules that need more than a plain regex terminal both live in OttTokenBuilder
 * — the mode-sensitive `%` / `>> .. <<` comment lexing, and the module header's
 * contextual keywords.
 */
const KNOWN_FAILURES: Record<string, string> = {};

let parse: ReturnType<typeof parseHelper<SourceFile>>;

beforeAll(async () => {
    const services = createOttServices(EmptyFileSystem);
    parse = parseHelper<SourceFile>(services.Ott);
});

const fixtureFiles = collectOttFiles(FIXTURES_DIR);

// ── Langium parser tests ─────────────────────────────────────

describe('Real-world .ott fixtures (Langium parser)', () => {

    test('fixtures directory is not empty', () => {
        expect(fixtureFiles.length).toBeGreaterThan(0);
    });

    for (const filePath of fixtureFiles) {
        const name = relative(FIXTURES_DIR, filePath);

        if (OTT_UNPARSEABLE.has(name)) {
            test.skip(`[not Ott] ${name}`, () => {});
            continue;
        }

        if (name in KNOWN_FAILURES) {
            test.todo(`[known: ${KNOWN_FAILURES[name]}] ${name}`); // eslint-disable-line security/detect-object-injection
            continue;
        }

        test(`parses without errors: ${name}`, async () => {
            const content = readFileSync(filePath, 'utf-8'); // eslint-disable-line security/detect-non-literal-fs-filename
            const doc: LangiumDocument<SourceFile> = await parse(content);
            const errors = doc.parseResult.parserErrors;

            if (errors.length > 0) {
                const msgs = errors.map(e =>
                    `  L${e.token?.startLine}:${e.token?.startColumn} ${e.message}`,
                );
                expect.fail(
                    `${name} has ${errors.length} parse error(s):\n${msgs.join('\n')}`,
                );
            }

            expect(doc.parseResult.value).toBeDefined();
            expect(isSourceFile(doc.parseResult.value)).toBe(true);
        });
    }
});

// ── Cross-validation with real ott tool ──────────────────────

describe('Cross-validation: Langium agrees with ott', () => {
    const ottPath = resolveOttBinary();

    test.runIf(ottPath !== null)('ott tool is available', () => {
        expect(ottPath).toBeTruthy();
    });

    for (const filePath of fixtureFiles) {
        const name = relative(FIXTURES_DIR, filePath);

        if (OTT_UNPARSEABLE.has(name) || OTT_REJECTS.has(name) || name in KNOWN_FAILURES) continue;

        test.runIf(ottPath !== null)(`ott also parses: ${name}`, () => {
            expect(ottAccepts(ottPath as string, readFileSync(filePath, 'utf-8'), name)).toBe(true);
        });
    }
});
