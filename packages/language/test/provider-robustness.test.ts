import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { EmptyFileSystem, type CstNode, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import type { SourceFile } from 'ott-language';
import { createOttServices } from 'ott-language';

const FIXTURES_DIR = new URL('fixtures', import.meta.url).pathname;

/**
 * LSP providers run on whatever the parser produces — including the
 * error-recovered, partially-built ASTs of files we don't fully parse yet
 * (see KNOWN_FAILURES in fixtures.test.ts). On such ASTs, fields the generated
 * types mark as required can be `undefined`. A provider that dereferences one
 * blindly turns into a "Request textDocument/… failed" popup in the editor.
 *
 * This suite is the guard against that: every fixture is pushed through every
 * provider, and none may throw. It deliberately includes the known parse
 * failures, since those partial ASTs are exactly what triggers the crashes.
 *
 * The providers also have a last-resort try/catch that logs and degrades
 * gracefully, so a crash never reaches the user. That would make a bare
 * "doesn't throw" assertion trivially true, so the suite additionally fails if
 * any provider hits that fallback path (a `[ott] … failed` log) — keeping it a
 * real regression test for the field-access logic, not just the safety net.
 */

let services: ReturnType<typeof createOttServices>;
let parse: ReturnType<typeof parseHelper<SourceFile>>;

beforeAll(async () => {
    services = createOttServices(EmptyFileSystem);
    parse = parseHelper<SourceFile>(services.Ott);
});

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

/** Start offset of every CST leaf — every position a user could hover. */
function leafOffsets(root: SourceFile): number[] {
    const cst = root.$cstNode;
    if (!cst) return [0];
    const offsets = new Set<number>([0]);
    const stack: CstNode[] = [cst];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;
        const container = node as CstNode & { content?: CstNode[] };
        if (container.content) {
            stack.push(...container.content);
        } else {
            offsets.add(node.offset);
        }
    }
    return [...offsets];
}

const fixtureFiles = collectOttFiles(FIXTURES_DIR);
const docUri = (doc: LangiumDocument) => doc.uri.toString();

describe('LSP providers never throw on real fixtures (incl. partial parses)', () => {

    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        const guardHits = errorSpy.mock.calls.filter(
            (call: unknown[]) => typeof call[0] === 'string' && call[0].startsWith('[ott]'),
        );
        errorSpy.mockRestore();
        expect(
            guardHits,
            `provider hit its crash-guard fallback:\n${guardHits.map((c: unknown[]) => String(c[0])).join('\n')}`,
        ).toHaveLength(0);
    });

    for (const filePath of fixtureFiles) {
        const name = relative(FIXTURES_DIR, filePath);

        test(`providers survive: ${name}`, async () => {
            const content = readFileSync(filePath, 'utf-8'); // eslint-disable-line security/detect-non-literal-fs-filename
            const doc = await parse(content);

            const symbols = services.Ott.lsp.DocumentSymbolProvider!;
            const hover = services.Ott.lsp.HoverProvider!;
            const formatter = services.Ott.lsp.Formatter!;

            await expect(
                Promise.resolve(symbols.getSymbols(doc, { textDocument: { uri: docUri(doc) } })),
            ).resolves.not.toThrow();

            await expect(
                Promise.resolve(formatter.formatDocument(doc, {
                    textDocument: { uri: docUri(doc) },
                    options: { tabSize: 2, insertSpaces: true },
                })),
            ).resolves.not.toThrow();

            for (const offset of leafOffsets(doc.parseResult.value)) {
                const position = doc.textDocument.positionAt(offset);
                await expect(
                    Promise.resolve(hover.getHoverContent(doc, {
                        textDocument: { uri: docUri(doc) },
                        position,
                    })),
                ).resolves.not.toThrow();
            }
        });
    }
});
