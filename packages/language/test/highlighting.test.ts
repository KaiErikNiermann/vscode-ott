import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { URI, type LangiumDocument } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { SemanticTokensDecoder } from 'langium/lsp';
import { createOttServices } from 'ott-language';
import { FIXTURES_DIR, collectOttFiles } from './helpers.js';

/**
 * What the editor actually paints.
 *
 * Each case asserts the exact `text:type` sequence for a span, in the style of
 * token-builder.test.ts — the point is that a reader can see the expected
 * colouring at a glance, and that a regression names the token it broke.
 * Anything unclassified is absent from the list rather than present with a
 * wrong type: the provider emits nothing for text it cannot name, leaving
 * whatever TextMate gave it.
 */

let services: ReturnType<typeof createOttServices>;

beforeAll(() => {
    services = createOttServices(NodeFileSystem);
});

/** Build `text` as `name.ott` in `dir`, alongside whatever else is loaded. */
async function open(dir: string, name: string, text: string): Promise<LangiumDocument> {
    const uri = URI.file(join(dir, name));
    const documents = services.shared.workspace.LangiumDocuments;
    documents.deleteDocument(uri);
    const document = documents.createDocument(uri, text);
    await services.shared.workspace.DocumentBuilder.build([document]);
    return document;
}

/** Semantic tokens as `text:type`, in document order. */
async function tokensOf(document: LangiumDocument): Promise<string[]> {
    const provider = services.Ott.lsp.SemanticTokenProvider;
    if (!provider) expect.fail('no SemanticTokenProvider registered');
    const tokens = await provider.semanticHighlight(document, {
        textDocument: { uri: document.uri.toString() },
    });
    return SemanticTokensDecoder.decode(tokens, provider.tokenTypes, document)
        .map(t => `${t.text}:${t.tokenType}`);
}

const SCRATCH = join(FIXTURES_DIR, 'stlc_lean');

const STLC = `
metavar var, x ::=
indexvar index, i, n ::=

grammar
typ, T :: 'typ_' ::=
  | bool :: :: bool
  | T1 -> T2 :: :: arrow

exp, e :: 'e_' ::=
  | x :: :: var
  | if e1 then e2 else e3 :: :: cond

ctx, G :: 'ctx_' ::=
  | empty :: :: empty

terminals :: 'terminals_' ::=
  | |- :: :: turnstile
  | -> :: :: arrow
`;

describe('inference rule bodies', () => {
    test('a typing judgement colours by what each token is', async () => {
        const document = await open(SCRATCH, 'hl_rule.ott', `${STLC}
defns J :: '' ::=

defn
G |- e : T :: :: typing :: '' by

----- :: var
G , x : T |- e : T
`);
        const tokens = await tokensOf(document);
        // The conclusion line. `,` and `:` are punctuation and stay untouched.
        expect(tokens).toEqual(expect.arrayContaining([
            'G:type', 'x:variable', 'T:type', '|-:operator', 'e:type',
        ]));
    });

    test('an arrow terminal is one operator, not two tokens', async () => {
        // `->` lexes as ELEMENT_STRING(`-`) + keyword(`>`), so emitting per AST
        // element would colour it twice. Maximal munch over the span rejoins it.
        const document = await open(SCRATCH, 'hl_arrow.ott', `${STLC}
defns J :: '' ::=

defn
G |- e : T :: :: typing :: '' by

----- :: arrow
G |- e : T1 -> T2
`);
        expect(await tokensOf(document)).toContain('->:operator');
    });

    test('production keywords are keywords, wherever they are used', async () => {
        // `if`/`then`/`else` are terminals only because a production introduced
        // them — nothing declares them anywhere.
        const document = await open(SCRATCH, 'hl_kw.ott', `${STLC}
defns J :: '' ::=

defn
G |- e : T :: :: typing :: '' by

----- :: cond
G |- if e1 then e2 else e3 : T
`);
        const tokens = await tokensOf(document);
        expect(tokens).toEqual(expect.arrayContaining([
            'if:keyword', 'then:keyword', 'else:keyword',
        ]));
        // The metavariables between them still resolve to their nonterminal.
        expect(tokens).toContain('e1:type');
    });

    test('a suffixed use colours the same as its root', async () => {
        const document = await open(SCRATCH, 'hl_suffix.ott', `${STLC}
defns J :: '' ::=

defn
G |- e : T :: :: typing :: '' by

----- :: suffix
G |- e1 : T1
`);
        const tokens = await tokensOf(document);
        expect(tokens).toContain('e1:type');
        expect(tokens).toContain('T1:type');
    });
});

describe('what is deliberately not highlighted', () => {
    test('a homomorphism body is target-language text', async () => {
        // `{{ lean ... }}` is Lean, not Ott — Ott does not read it, and neither
        // do we. Only the `[[ … ]]` splices inside are object language.
        const document = await open(SCRATCH, 'hl_hom.ott', `${STLC}
grammar
frob :: 'frob_' ::=
  | frobnicate T :: :: frob {{ lean (Ott.one T e G) }}
`);
        const tokens = await tokensOf(document);
        // `T`, `e` and `G` appear inside the hom body as Lean identifiers.
        // The production's own `T` is highlighted; the hom's is not, so exactly
        // one `T:type` may appear and no `G:type` from the hom.
        expect(tokens.filter(t => t === 'T:type')).toHaveLength(1);
        expect(tokens).not.toContain('G:type');
    });

    test('but a [[ … ]] splice inside one is', async () => {
        const document = await open(SCRATCH, 'hl_splice.ott', `${STLC}
grammar
frob :: 'frob_' ::=
  | frobnicate T :: :: frob {{ lean (Ott.one [[T]]) }}
`);
        // Two now: the production element and the splice.
        expect((await tokensOf(document)).filter(t => t === 'T:type')).toHaveLength(2);
    });

    test('an embed block is left entirely alone', async () => {
        const document = await open(SCRATCH, 'hl_embed.ott', `${STLC}
embed
{{ lean
def isValue : exp -> Bool
  | .e_true => true
}}
`);
        // Nothing from the embedded Lean is coloured as Ott.
        expect(await tokensOf(document)).not.toContain('exp:type');
    });

    test('an unknown word is left for TextMate rather than guessed at', async () => {
        const document = await open(SCRATCH, 'hl_unknown.ott', `${STLC}
defns J :: '' ::=

defn
G |- e : T :: :: typing :: '' by

----- :: unknown
G |- wibble : T
`);
        const tokens = await tokensOf(document);
        expect(tokens.some(t => t.startsWith('wibble:'))).toBe(false);
    });
});

describe('cross-file highlighting', () => {
    test('a nonterminal declared in a sibling file is coloured', async () => {
        // The point of the whole index: ocaml_light's rules are in typing.ott
        // and the grammar they use is declared in syntax.ott.
        const dir = join(FIXTURES_DIR, 'ocaml_light');
        const documents = services.shared.workspace.LangiumDocuments;
        const loaded: LangiumDocument[] = [];
        for (const file of collectOttFiles(dir)) {
            loaded.push(await documents.getOrCreateDocument(URI.file(file)));
        }
        await services.shared.workspace.DocumentBuilder.build(loaded);

        const typing = loaded.find(d => d.uri.fsPath.endsWith('typing.ott'));
        if (!typing) expect.fail('typing.ott not loaded');
        const tokens = await tokensOf(typing);

        expect(tokens.length).toBeGreaterThan(100);
        // `expr` is declared in syntax.ott; without the cross-file index this
        // would be absent entirely.
        expect(tokens.some(t => t.startsWith('expr:') && t.endsWith(':type'))).toBe(true);
    });
});
