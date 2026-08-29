import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bench, describe } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import type { FileSymbols, SourceFile } from 'ott-language';
import {
    buildProjectSymbols, collectFileSymbols, createClassifier, createOttServices,
} from 'ott-language';
import { FIXTURES_DIR, collectOttFiles } from './helpers.js';

/**
 * What the index costs relative to what it rides on.
 *
 * The budget is not "fast" in the abstract — it is "small next to parsing",
 * because parsing already happens on every edit and the index only adds to it.
 * Measured on ocaml_light, the largest genuinely-parseable project in the
 * corpus, parsing its three main files takes ~230ms while assembling their
 * symbol table takes single-digit milliseconds.
 *
 * `library.ott` is excluded on purpose despite being the biggest file by far:
 * it is 99% prose commented with `%` in column 0 and lexes to a few hundred
 * tokens, so it measures the comment matcher rather than anything else.
 */

const OCAML_LIGHT = join(FIXTURES_DIR, 'ocaml_light');
const BENCH_FILES = collectOttFiles(OCAML_LIGHT)
    .filter(f => !f.endsWith('library.ott'));

const services = createOttServices(EmptyFileSystem);
const parse = parseHelper<SourceFile>(services.Ott);

/** Parse every benchmark file once, so the measurements below exclude parsing. */
const sources = BENCH_FILES.map(file => ({
    file,
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    text: readFileSync(file, 'utf-8'),
}));
const parsed: Array<{ file: string; text: string; root: SourceFile }> = [];
const symbols: FileSymbols[] = [];

for (const { file, text } of sources) {
    const document = await parse(text);
    parsed.push({ file, text, root: document.parseResult.value });
    symbols.push(collectFileSymbols(document.parseResult.value, file));
}

describe('parsing (the cost the index is measured against)', () => {
    bench('parse the ocaml_light sources', async () => {
        for (const { text } of sources) {
            await parse(text);
        }
    });
});

describe('symbol index', () => {
    bench('collect declarations from a parsed file', () => {
        for (const { file, root } of parsed) {
            collectFileSymbols(root, file);
        }
    });

    bench('assemble the project symbol table', () => {
        buildProjectSymbols(symbols);
    });

    bench('rebuild after one file changes', () => {
        // The editor's hot path: one document reparsed, the project table
        // dropped and rebuilt from cached per-file symbols.
        const first = parsed[0];
        const refreshed = [collectFileSymbols(first.root, first.file), ...symbols.slice(1)];
        buildProjectSymbols(refreshed);
    });
});

describe('classification', () => {
    const project = buildProjectSymbols(symbols);

    bench('classify every rule body in the project', () => {
        for (const { file, text, root } of parsed) {
            const classifier = createClassifier(
                project.scopeOf(file), project.terminals, project.annotationNames,
            );
            for (const item of root.items ?? []) {
                if (item.$type !== 'DefnClass') continue;
                for (const defn of item.definitions ?? []) {
                    for (const body of defn.body ?? []) {
                        const cst = body.$cstNode;
                        if (cst) classifier.scan(text.slice(cst.offset, cst.end), cst.offset);
                    }
                }
            }
        }
    });

    bench('build a classifier for one file', () => {
        createClassifier(
            project.scopeOf(parsed[0].file), project.terminals, project.annotationNames,
        );
    });
});
