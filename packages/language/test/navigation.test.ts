import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { URI, type LangiumDocument } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createOttServices } from 'ott-language';
import { FIXTURES_DIR, collectOttFiles } from './helpers.js';

/**
 * Hover, go-to-definition and find-references over object-language
 * identifiers. All three answer the same question the highlighter does — which
 * token is here and what does it denote — so these mostly pin that the wiring
 * reaches the right documents, including across files.
 */

let services: ReturnType<typeof createOttServices>;

beforeAll(async () => {
    services = createOttServices(NodeFileSystem);
});

async function loadDir(dir: string): Promise<LangiumDocument[]> {
    const documents: LangiumDocument[] = [];
    for (const file of collectOttFiles(dir)) {
        documents.push(
            await services.shared.workspace.LangiumDocuments.getOrCreateDocument(URI.file(file)),
        );
    }
    await services.shared.workspace.DocumentBuilder.build(documents);
    return documents;
}

/** Position of the `nth` occurrence of `needle` in a document. */
function positionOf(document: LangiumDocument, needle: string, nth = 0) {
    const text = document.textDocument.getText();
    let index = -1;
    for (let i = 0; i <= nth; i++) index = text.indexOf(needle, index + 1);
    expect(index, `"${needle}" #${nth} not found`).toBeGreaterThanOrEqual(0);
    return document.textDocument.positionAt(index);
}

const uriOf = (document: LangiumDocument) => document.uri.toString();

describe('go to definition', () => {
    test('jumps from a use to the sibling file that declares it', async () => {
        const dir = join(FIXTURES_DIR, 'ocaml_light');
        const documents = await loadDir(dir);
        const typing = documents.find(d => d.uri.fsPath.endsWith('typing.ott'));
        if (!typing) expect.fail('typing.ott not loaded');

        // A use of `expr` inside a typing rule; it is declared in syntax.ott.
        const provider = services.Ott.lsp.DefinitionProvider;
        if (!provider) expect.fail('no DefinitionProvider registered');
        const links = await provider.getDefinition(typing, {
            textDocument: { uri: uriOf(typing) },
            position: positionOf(typing, 'expr', 40),
        });

        expect(links?.length ?? 0).toBeGreaterThan(0);
        expect(links?.some(l => l.targetUri.endsWith('syntax.ott'))).toBe(true);
    });

    test('returns every declaration when a root is merged across files', async () => {
        // `merge` is how a language is split into features, so several
        // declaration sites is normal rather than an error.
        const dir = join(FIXTURES_DIR, 'tapl');
        const documents = await loadDir(dir);
        const common = documents.find(d => d.uri.fsPath.endsWith('common_typing.ott'));
        if (!common) expect.fail('common_typing.ott not loaded');

        const links = await services.Ott.lsp.DefinitionProvider!.getDefinition(common, {
            textDocument: { uri: uriOf(common) },
            position: positionOf(common, 'G , x : T', 0),
        });
        expect(links?.length ?? 0).toBeGreaterThan(0);
    });

    test('offers nothing on a token that resolves to nothing', async () => {
        const dir = join(FIXTURES_DIR, 'stlc_lean');
        const documents = await loadDir(dir);
        const doc = documents[0];
        const links = await services.Ott.lsp.DefinitionProvider!.getDefinition(doc, {
            textDocument: { uri: uriOf(doc) },
            // A `%` comment line: Ott syntax, not object language.
            position: positionOf(doc, '%%', 0),
        });
        expect(links).toBeUndefined();
    });
});

describe('find references', () => {
    test('finds uses of a root across the project', async () => {
        const dir = join(FIXTURES_DIR, '1Bsemantics');
        const documents = await loadDir(dir);
        const l2 = documents.find(d => d.uri.fsPath.endsWith('l2.ott'));
        if (!l2) expect.fail('l2.ott not loaded');

        const locations = await services.Ott.lsp.ReferencesProvider!.findReferences(l2, {
            textDocument: { uri: uriOf(l2) },
            position: positionOf(l2, 'e1 e2,s>', 0),
            context: { includeDeclaration: true },
        });
        expect(locations.length).toBeGreaterThan(0);
    });

    test('reaches uses in a sibling file, not just the current one', async () => {
        const dir = join(FIXTURES_DIR, 'ocaml_light');
        const documents = await loadDir(dir);
        const syntax = documents.find(d => d.uri.fsPath.endsWith('syntax.ott'));
        if (!syntax) expect.fail('syntax.ott not loaded');

        const locations = await services.Ott.lsp.ReferencesProvider!.findReferences(syntax, {
            textDocument: { uri: uriOf(syntax) },
            position: positionOf(syntax, 'expr', 30),
            context: { includeDeclaration: false },
        });
        const files = new Set(locations.map(l => l.uri.split('/').pop()));
        expect(files.size).toBeGreaterThan(1);
    });
});

describe('hover', () => {
    test('explains a use and names the file that declares it', async () => {
        const dir = join(FIXTURES_DIR, 'ocaml_light');
        const documents = await loadDir(dir);
        const typing = documents.find(d => d.uri.fsPath.endsWith('typing.ott'));
        if (!typing) expect.fail('typing.ott not loaded');

        const hover = await services.Ott.lsp.HoverProvider!.getHoverContent(typing, {
            textDocument: { uri: uriOf(typing) },
            position: positionOf(typing, 'expr', 40),
        });
        const text = JSON.stringify(hover?.contents ?? '');
        expect(text).toContain('nonterminal');
        expect(text).toContain('syntax.ott');
    });

    test('says which root a suffixed use belongs to', async () => {
        const dir = join(FIXTURES_DIR, 'stlc_lean');
        const documents = await loadDir(dir);
        const doc = documents.find(d => d.uri.fsPath.endsWith('stlc_lean.ott'));
        if (!doc) expect.fail('stlc_lean.ott not loaded');

        const hover = await services.Ott.lsp.HoverProvider!.getHoverContent(doc, {
            textDocument: { uri: uriOf(doc) },
            position: positionOf(doc, 'T1 -> T2', 1),
        });
        const text = JSON.stringify(hover?.contents ?? '');
        // `T1` is `T` with a suffix, and the suffix carries no identity.
        expect(text).toMatch(/suffixed|nonterminal/);
    });

    test('still hovers declarations, as it always did', async () => {
        const dir = join(FIXTURES_DIR, 'stlc_lean');
        const documents = await loadDir(dir);
        const doc = documents[0];
        const hover = await services.Ott.lsp.HoverProvider!.getHoverContent(doc, {
            textDocument: { uri: uriOf(doc) },
            position: positionOf(doc, 'metavar', 0),
        });
        expect(JSON.stringify(hover?.contents ?? '')).toContain('metavar');
    });
});
