import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { URI, type LangiumDocument } from 'langium';
import { parseHelper } from 'langium/test';
import { NodeFileSystem } from 'langium/node';
import { createOttServices } from 'ott-language';
import type { SourceFile } from 'ott-language';
import { buildProjectSymbols, collectFileSymbols } from 'ott-language';
import { readFileSync } from 'node:fs';
import { FIXTURES_DIR, collectOttFiles } from './helpers.js';

/**
 * The index as the editor actually drives it: real documents, loaded through
 * Langium's document builder, with the index populating itself from the build
 * phases rather than being handed a file list.
 */

let services: ReturnType<typeof createOttServices>;

/** Load `files` into the workspace and build them, as opening a folder would. */
async function load(files: readonly string[]): Promise<LangiumDocument[]> {
    const documents: LangiumDocument[] = [];
    for (const file of files) {
        documents.push(
            await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.file(file)),
        );
    }
    await services.shared.workspace.DocumentBuilder.build(documents);
    return documents;
}

beforeAll(() => {
    services = createOttServices(NodeFileSystem);
});

describe('the index populates itself from document builds', () => {
    test('a rule file resolves nonterminals declared in a sibling', async () => {
        // ocaml_light keeps its grammar in syntax.ott and its rules in
        // typing.ott, with only a Makefile tying them together. This is the case
        // that motivated cross-file resolution at all.
        const dir = join(FIXTURES_DIR, 'ocaml_light');
        await load(collectOttFiles(dir));

        const index = services.Ott.symbols.SymbolIndex;
        const { scope } = index.lookup(URI.file(join(dir, 'typing.ott')));

        // `expr` and `pattern` are declared in syntax.ott, not typing.ott.
        expect(scope.get('expr')).toBeDefined();
        expect(scope.get('pattern')).toBeDefined();
        const expr = scope.get('expr');
        expect(expr?.declarations.some(d => d.uri.endsWith('syntax.ott'))).toBe(true);
    });

    test('classification uses the sibling-derived scope', async () => {
        const dir = join(FIXTURES_DIR, 'ocaml_light');
        await load(collectOttFiles(dir));

        const { classifier } = services.Ott.symbols.SymbolIndex
            .lookup(URI.file(join(dir, 'typing.ott')));
        expect(classifier.classifyWord('expr').kind).toBe('nonterminal');
        // Suffixed uses resolve to the same root, since a suffix carries no
        // identity of its own.
        expect(classifier.classifyWord('expr1').root).toBe('expr');
    });

    test('a manifest project resolves through Ott.toml, not the directory', async () => {
        const dir = join(FIXTURES_DIR, 'tapl');
        await load(collectOttFiles(dir));

        const index = services.Ott.symbols.SymbolIndex;
        const scope = index.projectScopeOf(join(dir, 'common.ott'));
        // The default [spec] list is 19 of the 29 .ott files in the directory,
        // so a directory scan would be the wrong answer here.
        expect(scope.files.length).toBeLessThan(collectOttFiles(dir).length);
        expect(scope.files.some(f => f.endsWith('common.ott'))).toBe(true);
        expect(scope.key).toContain('Ott.toml');
    });

    test('a file outside the active source set falls back to a union', async () => {
        const dir = join(FIXTURES_DIR, 'tapl');
        await load(collectOttFiles(dir));

        // sub_record.ott belongs to no profile's default list; without the
        // fallback it would resolve against nothing at all.
        const scope = services.Ott.symbols.SymbolIndex
            .projectScopeOf(join(dir, 'sub_record.ott'));
        expect(scope.files.length).toBeGreaterThan(1);
        expect(scope.key).toContain('union');
    });

    test('deleting a file removes what it contributed to its siblings', async () => {
        const dir = join(FIXTURES_DIR, '1Bsemantics');
        const [l1] = await load(collectOttFiles(dir));
        const index = services.Ott.symbols.SymbolIndex;

        // l2 extends l1, so `store` reaches it only through that edge.
        expect(index.lookup(URI.file(join(dir, 'l2.ott'))).scope.get('store')).toBeDefined();

        // The path a real file deletion takes: didChangeWatchedFiles -> update.
        await services.shared.workspace.DocumentBuilder.update([], [l1.uri]);

        expect(index.lookup(URI.file(join(dir, 'l2.ott'))).scope.get('store')).toBeUndefined();
    });
});

/**
 * A guard on the shape of the cost, not its absolute value: indexing rides on
 * parsing, which happens on every edit anyway, so what matters is that it stays
 * small next to it. A ratio survives a noisy CI runner where a millisecond
 * threshold would not. Run with OTT_PERF=1; `pnpm bench` prints the detail.
 */
describe('indexing cost', () => {
    test.runIf(process.env.OTT_PERF)('stays a small fraction of parsing', async () => {
        const files = collectOttFiles(join(FIXTURES_DIR, 'ocaml_light'))
            .filter(f => !f.endsWith('library.ott'));
        const sources = files.map(f => ({
            file: f,
            text: readFileSync(f, 'utf-8'), // eslint-disable-line security/detect-non-literal-fs-filename
        }));

        const parse = parseHelper<SourceFile>(services.Ott);
        const parseStart = performance.now();
        const roots: Array<{ file: string; root: SourceFile }> = [];
        for (const { file, text } of sources) {
            roots.push({ file, root: (await parse(text)).parseResult.value });
        }
        const parseMs = performance.now() - parseStart;

        const indexStart = performance.now();
        buildProjectSymbols(roots.map(r => collectFileSymbols(r.root, r.file)));
        const indexMs = performance.now() - indexStart;

        expect(indexMs / parseMs,
            `indexing ${indexMs.toFixed(1)}ms vs parsing ${parseMs.toFixed(1)}ms`,
        ).toBeLessThan(0.25);
    });
});
