import { readFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import type { FileSymbols, SourceFile } from 'ott-language';
import {
    buildProjectSymbols, collectFileSymbols, createClassifier, createNodeResolveHost,
    createOttServices, findManifestPath, loadManifest, resolveProject,
} from 'ott-language';
import { FIXTURES_DIR, OTT_UNPARSEABLE, collectOttFiles } from './helpers.js';

/**
 * How much of the object language inside inference rules we can actually name.
 *
 * Per-token tests pin individual constructs; this pins the aggregate, which is
 * what catches a change that silently stops resolving a whole class of token.
 * The floors are set just under the measured values — raise them when the
 * numbers improve, and never lower one without saying why.
 *
 * Only rule bodies are counted: they are the payload, and the place a reader
 * looks. Punctuation is excluded because colouring a comma proves nothing.
 */

let parse: ReturnType<typeof parseHelper<SourceFile>>;

beforeAll(() => {
    parse = parseHelper<SourceFile>(createOttServices(EmptyFileSystem).Ott);
});

/** The files that resolve a given file's symbols. */
function projectFilesOf(file: string): { key: string; files: string[] } {
    const manifestPath = findManifestPath(dirname(file));
    if (manifestPath?.startsWith(FIXTURES_DIR)) {
        const manifest = loadManifest(manifestPath);
        if (manifest) {
            const resolved = resolveProject(createNodeResolveHost(), manifest);
            const files = resolved.files.map(f => createNodeResolveHost().join(manifest.dir, f));
            return { key: manifestPath, files: [...new Set([...files, file])] };
        }
    }
    // No manifest: the directory. ocaml_light and tex are real multi-file
    // developments carrying only a Makefile, and scoping each file alone would
    // leave their rules with no grammar to resolve against.
    const dir = dirname(file);
    return { key: dir, files: collectOttFiles(dir) };
}

interface Coverage { total: number; classified: number; unknowns: Map<string, number> }

async function coverageOf(files: readonly string[]): Promise<Coverage> {
    const symbols: FileSymbols[] = [];
    const parsed = new Map<string, { src: string; root: SourceFile }>();
    for (const file of files) {
        const name = relative(FIXTURES_DIR, file);
        if (OTT_UNPARSEABLE.has(name)) continue;
        const src = readFileSync(file, 'utf-8'); // eslint-disable-line security/detect-non-literal-fs-filename
        const doc = await parse(src);
        parsed.set(file, { src, root: doc.parseResult.value });
        symbols.push(collectFileSymbols(doc.parseResult.value, file));
    }
    const project = buildProjectSymbols(symbols);

    const unknowns = new Map<string, number>();
    let total = 0;
    let classified = 0;
    for (const [file, { src, root }] of parsed) {
        const classifier = createClassifier(
            project.scopeOf(file), project.terminals, project.annotationNames);
        for (const item of root.items ?? []) {
            if (item.$type !== 'DefnClass') continue;
            for (const defn of item.definitions ?? []) {
                for (const body of defn.body ?? []) {
                    if (body.$type === 'RuleSeparator' || body.$type === 'DefnComment') continue;
                    const cst = body.$cstNode;
                    if (!cst) continue;
                    for (const token of classifier.scan(src.slice(cst.offset, cst.end), cst.offset)) {
                        if (token.kind === 'punctuation') continue;
                        total++;
                        if (token.kind === 'unknown') {
                            unknowns.set(token.text, (unknowns.get(token.text) ?? 0) + 1);
                        } else {
                            classified++;
                        }
                    }
                }
            }
        }
    }
    return { total, classified, unknowns };
}

/** Measured floors. `ocaml_light`'s residue is roots that only appear on its
 *  `%d`-prefixed lines, which its Makefile strips before ott ever sees them. */
const FLOORS: Readonly<Record<string, number>> = {
    '1Bsemantics': 100, ocaml_light: 97, peterson: 100, stlc_lean: 100, tapl: 100, tex: 99,
};

describe('object-language classification coverage', () => {
    // One entry per project, keyed the way the resolver would group them.
    const projects = new Map<string, string[]>();
    for (const file of collectOttFiles(FIXTURES_DIR)) {
        const { key, files } = projectFilesOf(file);
        if (!projects.has(key)) projects.set(key, files);
    }

    for (const [key, files] of projects) {
        const name = relative(FIXTURES_DIR, key).replace(/[/\\]Ott\.toml$/, '');
        const floor = FLOORS[name as keyof typeof FLOORS] ?? 95;

        test(`${name} classifies at least ${floor}% of rule-body tokens`, async () => {
            const { total, classified, unknowns } = await coverageOf(files);
            expect(total, `${name} contributed no rule-body tokens`).toBeGreaterThan(0);
            const percent = (100 * classified) / total;
            const worst = [...unknowns].sort((a, b) => b[1] - a[1]).slice(0, 6)
                .map(([word, n]) => `${word} x${n}`).join(', ');
            expect(percent, `${name}: ${classified}/${total} classified. Top unknowns: ${worst}`)
                .toBeGreaterThanOrEqual(floor);
        });
    }

    test('a nonterminal declared in a sibling file still resolves', async () => {
        // The whole point of the cross-file index: ocaml_light's rules live in
        // typing.ott while the grammar they use is declared in syntax.ott.
        const typing = `${FIXTURES_DIR}/ocaml_light/typing.ott`;
        const { files } = projectFilesOf(typing);
        const { total, classified } = await coverageOf([typing]);
        const alone = (100 * classified) / total;
        const withSiblings = await coverageOf(files);
        const together = (100 * withSiblings.classified) / withSiblings.total;
        expect(alone).toBeLessThan(85);
        expect(together).toBeGreaterThan(95);
    });
});
