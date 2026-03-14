import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import type { SourceFile } from 'ott-language';
import { createOttServices, isSourceFile } from 'ott-language';

const FIXTURES_DIR = new URL('fixtures', import.meta.url).pathname;

/**
 * Files that ott itself cannot parse (lex errors, not real Ott).
 * Neither ott nor our parser should be expected to handle these.
 */
const OTT_UNPARSEABLE = new Set([
    'ocaml_light/library.ott',  // starts with -*-LaTeX-*- modeline
    'tapl/let_alltt.ott',       // LaTeX-rendered Ott, not actual Ott syntax
]);

/**
 * Files that ott parses but our Langium grammar doesn't yet support.
 * Each entry documents the missing feature so we can track progress.
 */
const KNOWN_FAILURES: Record<string, string> = {
    'ocaml_light/funex.ott':      'funs/fun blocks (function definitions)',
    'ocaml_light/opsem.ott':      'advanced defn syntax with >> headers',
    'ocaml_light/reduction.ott':  'rule-level {{ }} hom blocks outside defn',
    'ocaml_light/syntax.ott':     "'' quoting in homs, comprehensions in bind specs",
    'ocaml_light/typing.ott':     "'' quoting in homs, advanced features",
    'peterson_caml.ott':          "'' quoting in homs (isavar/holvar)",
    'tapl/common_labels.ott':     "'' quoting in homs (isavar/holvar)",
};

let parse: ReturnType<typeof parseHelper<SourceFile>>;

beforeAll(async () => {
    const services = createOttServices(EmptyFileSystem);
    parse = parseHelper<SourceFile>(services.Ott);
});

/** Recursively collect all .ott files under a directory. */
function collectOttFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) { // eslint-disable-line security/detect-non-literal-fs-filename
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { // eslint-disable-line security/detect-non-literal-fs-filename
            files.push(...collectOttFiles(full));
        } else if (entry.endsWith('.ott')) {
            files.push(full);
        }
    }
    return files.sort();
}

/** Check if the real `ott` tool can parse a file (ignoring semantic errors). */
function ottCanParse(filePath: string): boolean {
    try {
        // eslint-disable-next-line sonarjs/no-os-command-from-path, sonarjs/publicly-writable-directories
        execFileSync('ott', ['-i', filePath, '-o', '/tmp/ott_fixture_out.tex'], {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30_000,
        });
        return true;
    } catch (error: unknown) {
        const stderr = (error as { stderr?: string }).stderr ?? '';
        // Semantic errors (post-parse) are OK — we only care about lex/parse failures
        const isLexParseError = /Lexing error|parse error|Syntax error/i.test(stderr);
        return !isLexParseError;
    }
}

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
    const ottPath = (() => {
        try {
            // eslint-disable-next-line sonarjs/no-os-command-from-path
            return execFileSync('which', ['ott'], { encoding: 'utf-8' }).trim();
        } catch {
            return null;
        }
    })();

    test.runIf(ottPath !== null)('ott tool is available', () => {
        expect(ottPath).toBeTruthy();
    });

    for (const filePath of fixtureFiles) {
        const name = relative(FIXTURES_DIR, filePath);

        if (OTT_UNPARSEABLE.has(name) || name in KNOWN_FAILURES) continue;

        test.runIf(ottPath !== null)(`ott also parses: ${name}`, () => {
            expect(ottCanParse(filePath)).toBe(true);
        });
    }
});
