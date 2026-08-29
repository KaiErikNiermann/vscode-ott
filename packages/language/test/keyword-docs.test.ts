import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import type { SourceFile } from 'ott-language';
import { createOttServices } from 'ott-language';
import type { Hover } from 'vscode-languageserver';
import { KEYWORD_DOCS, TERMINALS_DOC } from '../src/keyword-docs.js';

/**
 * Reference hovers for Ott's own keywords.
 *
 * The prose cannot be checked mechanically, but three things about it can: that
 * every keyword a reader can hover actually has an entry, that the examples are
 * real Ott rather than plausible-looking Ott, and that a *name* which happens to
 * spell a keyword is left alone. The last is the one that would be a bug rather
 * than a gap — `tests/test-j.ott:8` has a production named `module`.
 */

const services = createOttServices(EmptyFileSystem);
const parse = parseHelper<SourceFile>(services.Ott);

/** The hover markdown at `|CURSOR|`, or undefined if there is none. */
async function hoverAt(source: string): Promise<string | undefined> {
    const offset = source.indexOf('|CURSOR|');
    expect(offset, 'the source must mark the cursor').toBeGreaterThanOrEqual(0);
    const document = await parse(source.replace('|CURSOR|', ''));
    const hover = await services.Ott.lsp.HoverProvider!.getHoverContent(document, {
        textDocument: { uri: document.uri.toString() },
        position: document.textDocument.positionAt(offset),
    }) as Hover | undefined;
    const contents = hover?.contents;
    return typeof contents === 'object' && 'value' in contents ? contents.value : undefined;
}

describe('the table', () => {
    test('covers every item keyword Ott has', async () => {
        // `ITEM_KEYWORDS` in ott-header.ts, from `grammar_parser.mly:143-161`.
        // The three coq section keywords are excluded: ott.langium has no rule
        // for them yet, so they are not hoverable in the first place.
        const { HEADER_KEYWORDS } = await import('../src/ott-header.js');
        const items = ['metavar', 'indexvar', 'grammar', 'defns', 'defn', 'funs', 'fun',
            'embed', 'subrules', 'substitutions', 'freevars', 'parsing', 'homs'];
        for (const keyword of [...items, ...HEADER_KEYWORDS]) {
            expect(KEYWORD_DOCS[keyword], `no entry for \`${keyword}\``).toBeDefined();
        }
    });

    test('gives every entry a title, a summary and an example', () => {
        for (const [keyword, entry] of Object.entries(KEYWORD_DOCS)) {
            expect(entry.title, keyword).not.toBe('');
            expect(entry.summary.length, keyword).toBeGreaterThan(30);
            expect(entry.example.length, keyword).toBeGreaterThan(0);
        }
    });

    test('names a doc page that exists, when the ott checkout is available', () => {
        // `OTT_REPO` mirrors the `OTT_BIN` precedent: a link to a page that was
        // renamed is worse than no link, but the checkout is not always there.
        const repo = process.env.OTT_REPO;
        if (!repo || !existsSync(repo)) return;
        for (const [keyword, entry] of [...Object.entries(KEYWORD_DOCS),
            ['terminals', TERMINALS_DOC] as const]) {
            if (!entry.doc) continue;
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            expect(existsSync(join(repo, 'docs', entry.doc)), `${keyword} -> ${entry.doc}`)
                .toBe(true);
        }
    });
});

describe('hovering a keyword', () => {
    test('explains the construct as well as the instance', async () => {
        const hover = await hoverAt("defns\nJ :: '' ::=\n\nde|CURSOR|fn\n"
            + "G |- e : T :: :: typing :: 'typing_'\nby\n\n---- :: r\nG |- e : T\n");
        // Both halves: what a judgement form is, and what this one contains.
        expect(hover).toContain('Judgement form');
        expect(hover).toContain('```ott');
        expect(hover).toContain('inference rule');
    });

    test('links into the docs', async () => {
        const hover = await hoverAt('gram|CURSOR|mar\n\nt :: \'t_\' ::=\n  | x :: :: v\n');
        expect(hover).toContain('https://github.com/KaiErikNiermann/ott/blob/new-docs/docs'
            + '/guide/syntax-definitions.rst');
    });

    test('explains `by`, which introduces the rule list', async () => {
        const hover = await hoverAt("defns\nJ :: '' ::=\n\ndefn\n"
            + "G |- e : T :: :: typing :: 'typing_'\nb|CURSOR|y\n\n---- :: r\nG |- e : T\n");
        expect(hover).toContain('rule list');
    });

    test('explains the module header', async () => {
        expect(await hoverAt('mod|CURSOR|ule tapl\n\nmetavar x ::=\n'))
            .toContain('Module declaration');
        expect(await hoverAt('module l2\nex|CURSOR|tends l1\n\nmetavar x ::=\n'))
            .toContain('Module extension');
    });

    test('explains `terminals`, which is a rule and not a keyword', async () => {
        const hover = await hoverAt(
            "grammar\n\nterm|CURSOR|inals :: 'terminals_' ::=\n  | -> :: :: arrow\n");
        expect(hover).toContain('Terminals rule');
    });
});

describe('what is left alone', () => {
    test('a production named `module` is a name, not a keyword', async () => {
        // tests/test-j.ott:8. The check is on the CST leaf's grammar source, so
        // the word never reaches the table here.
        const hover = await hoverAt(
            "metavar x ::=\n\ngrammar\nt :: 't_' ::=\n  | U . Term :: :: mod|CURSOR|ule\n");
        expect(hover ?? '').not.toContain('Module declaration');
    });

    test('`as` in an ascription is object syntax', async () => {
        // tapl/ascribe.ott. `as` is a keyword only inside a file header.
        const hover = await hoverAt(
            "grammar\nt :: 't_' ::=\n  | t a|CURSOR|s T :: :: ascribe\n");
        expect(hover ?? '').not.toContain('Import renaming');
    });

    test('`uniq` is a judgement the spec declares, not Ott syntax', async () => {
        // `auxl.ml:783` only maps the identifier in the Lean backend's fallback
        // vocabulary; there is deliberately no table entry for it.
        expect(KEYWORD_DOCS['uniq']).toBeUndefined();
    });
});
