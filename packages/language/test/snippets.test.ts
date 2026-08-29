import { describe, expect, test } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import type { SourceFile } from 'ott-language';
import { createOttServices } from 'ott-language';
import type { CompletionList } from 'vscode-languageserver';
import { CompletionItemKind } from 'vscode-languageserver';
import { SNIPPETS, type SnippetContext } from '../src/snippets.js';

/**
 * Construct scaffolds.
 *
 * Two things are worth asserting and they pull in opposite directions. That a
 * scaffold is *offered where it belongs* is the point of serving these from the
 * server at all, so the gating gets explicit cases. That a scaffold is *correct*
 * matters more: a newcomer accepting a completion and getting a parse error is
 * worse off than one who typed it themselves, so every body is expanded and
 * parsed.
 */

const services = createOttServices(EmptyFileSystem);
const parse = parseHelper<SourceFile>(services.Ott);

/**
 * Expand snippet syntax the way an editor would, taking each placeholder's
 * default and the first branch of each choice.
 */
function expand(body: readonly string[]): string {
    return body.join('\n')
        .replace(/\$\{\d+\|([^|]*)\|}/g, (_, choices: string) => choices.split(',')[0])
        .replace(/\$\{\d+:([^}]*)}/g, '$1')
        .replace(/\$\{\d+}/g, '')
        .replace(/\$\d+/g, '')
        .replace(/\\(.)/g, '$1');
}

/** A minimal valid file with `body` placed where that context puts it. */
function inContext(context: SnippetContext, body: string): string {
    switch (context) {
        case 'header':
        case 'item':
            return body;
        case 'grammar':
            // With a rule already open, so a bare production has one to join.
            return `grammar\n\nt :: 't_' ::=\n  | x   ::   :: var\n\n${body}`;
        case 'element':
            return `grammar\n\nt :: 't_' ::=\n  | x ${body}   ::   :: var`;
        case 'defns':
            return `defns\nJ :: '' ::=\n\n${body}`;
        case 'defn-body':
            return `defns\nJ :: '' ::=\n\ndefn\nG |- e : T :: :: typing :: 'typing_'\nby\n\n${body}`;
        case 'funs':
            return `funs\nF ::=\n\n${body}`;
        case 'hom':
            // Homs and bind specs follow a production's name, not its elements.
            return `grammar\n\nt :: 't_' ::=\n  | x   ::   :: var  ${body}`;
    }
}

/** The labels of the snippet items offered at `|` in `source`. */
async function offeredAt(source: string): Promise<string[]> {
    const offset = source.indexOf('|CURSOR|');
    expect(offset, 'the source must mark the cursor').toBeGreaterThanOrEqual(0);
    const text = source.replace('|CURSOR|', '');
    const document = await parse(text);
    const list = await services.Ott.lsp.CompletionProvider!.getCompletion(document, {
        textDocument: { uri: document.uri.toString() },
        position: document.textDocument.positionAt(offset),
    }) as CompletionList | undefined;
    return (list?.items ?? [])
        .filter(item => item.kind === CompletionItemKind.Snippet)
        .map(item => item.label)
        .sort();
}

describe('every scaffold', () => {
    test.each(SNIPPETS.map(s => [s.prefix, s] as const))(
        '%s expands to something Ott parses', async (_prefix, snippet) => {
            const expanded = expand(snippet.body);
            for (const context of snippet.contexts) {
                const document = await parse(inContext(context, expanded));
                expect(
                    document.parseResult.parserErrors.map(e => e.message),
                    `as ${context}:\n${inContext(context, expanded)}`,
                ).toHaveLength(0);
            }
        });

    test('has a unique prefix', () => {
        const prefixes = SNIPPETS.map(s => s.prefix);
        expect(new Set(prefixes).size).toBe(prefixes.length);
    });

    test('is reachable from some context', () => {
        for (const snippet of SNIPPETS) {
            expect(snippet.contexts.length, snippet.prefix).toBeGreaterThan(0);
        }
    });
});

describe('where scaffolds are offered', () => {
    test('the header offers module, extends and imports', async () => {
        const offered = await offeredAt('|CURSOR|');
        expect(offered).toContain('module');
        expect(offered).toContain('extends');
        expect(offered).toContain('imports');
    });

    test('an item keyword closes the header to them', async () => {
        const offered = await offeredAt("metavar x ::=\n\n|CURSOR|");
        expect(offered).not.toContain('module');
        expect(offered).toContain('grammar');
    });

    test('the top level offers the item scaffolds', async () => {
        const offered = await offeredAt('metavar x ::=\n\n|CURSOR|');
        expect(offered).toEqual(expect.arrayContaining(
            ['grammar', 'defns', 'funs', 'subrules', 'parsing', 'embed']));
        expect(offered).not.toContain('inferrule');
    });

    test('a grammar block offers a rule and a production', async () => {
        const offered = await offeredAt("grammar\n\nt :: 't_' ::=\n  | x   ::   :: var\n|CURSOR|");
        expect(offered).toContain('rule');
        expect(offered).toContain('production');
        expect(offered).not.toContain('inferrule');
    });

    test('a defns block offers defn but not inferrule', async () => {
        const offered = await offeredAt("defns\nJ :: '' ::=\n|CURSOR|");
        expect(offered).toContain('defn');
        expect(offered).not.toContain('inferrule');
    });

    test('a defn body offers inferrule and axiom', async () => {
        const offered = await offeredAt(
            "defns\nJ :: '' ::=\n\ndefn\nG |- e : T :: :: typing :: 'typing_'\nby\n\n"
            + '----------- :: var\nG |- x : T\n\n|CURSOR|');
        expect(offered).toContain('inferrule');
        expect(offered).toContain('axiom');
    });

    test('mid-line inside a rule offers no block scaffolds', async () => {
        // `metavar` is only an item keyword as the first word of a line
        // (`grammar_lexer.mll:436-460`), so mid-rule it is just a name — and a
        // scaffold there would be wrong, not merely noisy.
        const offered = await offeredAt(
            "defns\nJ :: '' ::=\n\ndefn\nG |- e : T :: :: typing :: 'typing_'\nby\n\n"
            + '----------- :: var\nG |- x |CURSOR|');
        expect(offered).not.toContain('metavar');
        expect(offered).not.toContain('inferrule');
        expect(offered).not.toContain('defns');
    });

    test('a partly typed word still counts as the start of a line', async () => {
        const offered = await offeredAt('metavar x ::=\n\ndefn|CURSOR|');
        expect(offered).toContain('defns');
    });
});
