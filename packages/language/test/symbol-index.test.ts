import { beforeAll, describe, expect, test } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import type { FileSymbols, SourceFile } from 'ott-language';
import {
    buildProjectSymbols, collectFileSymbols, createOttServices, resolveRoot, splitRoot,
} from 'ott-language';

let parse: ReturnType<typeof parseHelper<SourceFile>>;

beforeAll(() => {
    parse = parseHelper<SourceFile>(createOttServices(EmptyFileSystem).Ott);
});

/** Parse `text` as the file at `uri` and collect what it declares. */
async function symbolsOf(uri: string, text: string): Promise<FileSymbols> {
    const doc = await parse(text);
    expect(doc.parseResult.parserErrors, `${uri} should parse`).toHaveLength(0);
    return collectFileSymbols(doc.parseResult.value, uri);
}

const roots = (names: string[], indexvars: string[] = []) => ({
    roots: new Set(names), indexvars: new Set(indexvars),
});

describe('root and suffix splitting', () => {
    test('digits, primes and underscores are suffix items', () => {
        const set = roots(['T', 'e']);
        expect(resolveRoot('T', set)).toBe('T');
        expect(resolveRoot('T1', set)).toBe('T');
        expect(resolveRoot("e'", set)).toBe('e');
        expect(resolveRoot("T1'", set)).toBe('T');
        expect(resolveRoot('T_1', set)).toBe('T');
    });

    test('an index variable is a suffix item, and may carry a -1 offset', () => {
        // Without `n` declared as an indexvar, `vn` is not `v` with a suffix at
        // all — this is what took ocaml_light from 94.4% to 98.6% classified.
        expect(resolveRoot('vn', roots(['v']))).toBeUndefined();
        expect(resolveRoot('vn', roots(['v'], ['n']))).toBe('v');
        expect(resolveRoot('ti-1', roots(['t'], ['i']))).toBe('t');
        expect(resolveRoot('fn1', roots(['f'], ['n']))).toBe('f');
    });

    test('`t_body` only splits when `body` is a declared indexvar', () => {
        // docs/reference/syntax-reference.rst claims underscore + any
        // alphanumeric; the suffix grammar in top2.mng §a17 does not.
        expect(resolveRoot('t_body', roots(['t']))).toBeUndefined();
        expect(resolveRoot('t_body', roots(['t'], ['body']))).toBe('t');
    });

    test('an index variable cannot itself be suffixed', () => {
        // Its own root still resolves; `i1` does not, because indexvars take no
        // suffix of their own.
        expect(resolveRoot('i', roots(['i'], ['i']))).toBe('i');
        expect(resolveRoot('i1', roots(['i'], ['i']))).toBe('i');
    });

    test('several readings resolve to the most specific one', () => {
        // `ti` is both the root `ti` and `t` suffixed by the indexvar `i`.
        // Upstream returns OP_Many and lets the GLR parser settle it; a
        // highlighter must answer now, and the longer root consumes more of the
        // word, so it is the more specific reading.
        const set = roots(['t', 'ti'], ['i']);
        expect(splitRoot('ti', set).map(s => s.root)).toEqual(['ti', 't']);
        expect(resolveRoot('ti', set)).toBe('ti');
    });

    test('a word matching no declared root resolves to nothing', () => {
        expect(resolveRoot('wibble', roots(['t', 'e']))).toBeUndefined();
    });

    test('a longer root wins over a shorter one that also fits', () => {
        expect(resolveRoot('expr1', roots(['e', 'expr']))).toBe('expr');
    });
});

describe('per-file collection', () => {
    test('metavars, indexvars, nonterminals and their synonyms', async () => {
        const f = await symbolsOf('a.ott', [
            'metavar termvar, x, y ::=',
            'indexvar index, i, n ::=',
            '',
            'grammar',
            "typ, T :: 'typ_' ::=",
            '  | T1 -> T2 :: :: arrow',
        ].join('\n'));
        const kinds = new Map(f.declarations.map(d => [d.root, d.kind]));
        expect(kinds.get('termvar')).toBe('metavar');
        expect(kinds.get('x')).toBe('metavar');
        expect(kinds.get('i')).toBe('indexvar');
        expect(kinds.get('typ')).toBe('nonterminal');
        expect(kinds.get('T')).toBe('nonterminal');
        // Synonyms share the primary root, so `T` and `typ` are one rule.
        expect(f.declarations.find(d => d.root === 'T')?.primary).toBe('typ');
    });

    test('a `terminals` rule declares terminals, not a nonterminal', async () => {
        const f = await symbolsOf('a.ott', [
            'grammar',
            "terminals :: 'terminals_' ::=",
            '  | |- :: :: turnstile',
            '  | -> :: :: arrow',
        ].join('\n'));
        expect([...f.declaredTerminals]).toEqual(expect.arrayContaining(['|-', '->']));
        expect(f.declarations.some(d => d.root === 'terminals')).toBe(false);
    });

    test('judgement forms and subrule edges', async () => {
        const f = await symbolsOf('a.ott', [
            'subrules',
            '  v <:: e',
            '',
            "defns J :: '' ::=",
            '',
            'defn',
            "value e :: :: value :: '' by",
            '',
            '----- :: ax',
            'value e',
        ].join('\n'));
        expect(f.subrules).toEqual([['v', 'e']]);
        expect(f.declarations.filter(d => d.kind === 'judgement').map(d => d.root)).toEqual(['value']);
    });

    test('the module header is captured', async () => {
        const f = await symbolsOf('a.ott', 'module main\nextends core\nimports b renaming t as b_t\n');
        expect(f.module).toBe('main');
        expect(f.extends.map(e => e.module)).toEqual(['core']);
        expect(f.imports[0].renamings.get('t')).toBe('b_t');
    });
});

describe('project scoping', () => {
    const GRAMMAR = (root: string) => `grammar\n${root} :: '${root}_' ::=\n  | x :: :: v\n`;

    test('with no module anywhere, every file sees every root', async () => {
        const a = await symbolsOf('a.ott', GRAMMAR('t'));
        const b = await symbolsOf('b.ott', GRAMMAR('u'));
        const project = buildProjectSymbols([a, b]);
        expect(project.scopeOf('a.ott').get('u')).toBeDefined();
        expect(project.scopeOf('b.ott').get('t')).toBeDefined();
    });

    test('files of one module share freely', async () => {
        const a = await symbolsOf('a.ott', `module m\n\n${GRAMMAR('t')}`);
        const b = await symbolsOf('b.ott', `module m\n\n${GRAMMAR('u')}`);
        const project = buildProjectSymbols([a, b]);
        expect(project.scopeOf('a.ott').get('u')).toBeDefined();
    });

    test('an unrelated module is not visible', async () => {
        const a = await symbolsOf('a.ott', `module one\n\n${GRAMMAR('t')}`);
        const b = await symbolsOf('b.ott', `module two\n\n${GRAMMAR('u')}`);
        const project = buildProjectSymbols([a, b]);
        expect(project.scopeOf('a.ott').get('u')).toBeUndefined();
        expect(project.scopeOf('b.ott').get('t')).toBeUndefined();
    });

    test('`extends` exposes the base module under its original names', async () => {
        // The examples/1Bsemantics shape: l2 extends l1.
        const l1 = await symbolsOf('l1.ott', `module l1\n\n${GRAMMAR('store')}`);
        const l2 = await symbolsOf('l2.ott', `module l2\nextends l1\n\n${GRAMMAR('e')}`);
        const project = buildProjectSymbols([l1, l2]);
        expect(project.scopeOf('l2.ott').get('store')).toBeDefined();
        // and it is directional
        expect(project.scopeOf('l1.ott').get('e')).toBeUndefined();
    });

    test('`extends` is transitive', async () => {
        const base = await symbolsOf('base.ott', `module base\n\n${GRAMMAR('b')}`);
        const mid = await symbolsOf('mid.ott', `module mid\nextends base\n\n${GRAMMAR('m')}`);
        const top = await symbolsOf('top.ott', `module top\nextends mid\n\n${GRAMMAR('t')}`);
        const project = buildProjectSymbols([base, mid, top]);
        expect(project.scopeOf('top.ott').get('b')).toBeDefined();
    });

    test('`imports` exposes only the renamed name, still denoting the original', async () => {
        const a = await symbolsOf('a.ott', `module a\n\n${GRAMMAR('t')}`);
        const main = await symbolsOf('main.ott', `module main\nimports a renaming t as a_t\n\n${GRAMMAR('u')}`);
        const project = buildProjectSymbols([a, main]);
        const scope = project.scopeOf('main.ott');
        expect(scope.get('a_t')?.internal).toBe('t');
        // The importer writes `a_t`; `t` is not a name it can use.
        expect(scope.get('t')).toBeUndefined();
    });

    test('roots owned by no module are visible from inside one', async () => {
        // Without this a module's defn bodies could not mention `formula`.
        const shared = await symbolsOf('shared.ott', GRAMMAR('formula'));
        const m = await symbolsOf('m.ott', `module m\n\n${GRAMMAR('t')}`);
        const project = buildProjectSymbols([shared, m]);
        expect(project.scopeOf('m.ott').get('formula')).toBeDefined();
    });

    test('a root declared in two files merges into one entry', async () => {
        // `merge` is how tapl composes features, so several declaration sites is
        // the normal case, not an error.
        const a = await symbolsOf('a.ott', `module m\n\n${GRAMMAR('t')}`);
        const b = await symbolsOf('b.ott', `module m\n\n${GRAMMAR('t')}`);
        const project = buildProjectSymbols([a, b]);
        expect(project.scopeOf('a.ott').get('t')?.declarations).toHaveLength(2);
    });
});

describe('terminals and subrules', () => {
    test('terminals are pooled across the build, not scoped to a module', async () => {
        const a = await symbolsOf('a.ott', [
            'module one', '', 'grammar', "terminals :: 'terminals_' ::=", '  | |- :: :: turnstile',
        ].join('\n'));
        const b = await symbolsOf('b.ott', `module two\n\ngrammar\nu :: 'u_' ::=\n  | x :: :: v\n`);
        const project = buildProjectSymbols([a, b]);
        expect(project.terminals.has('|-')).toBe(true);
    });

    test('a production word resolving to no root is an implicit terminal', async () => {
        // Ott's own rule, and why a `terminals` block only lists the ones that
        // need LaTeX.
        const f = await symbolsOf('a.ott', [
            'metavar x ::=',
            'grammar',
            "e :: 'e_' ::=",
            '  | if e1 then e2 else e3 :: :: cond',
        ].join('\n'));
        const project = buildProjectSymbols([f]);
        expect(project.terminals.has('if')).toBe(true);
        expect(project.terminals.has('then')).toBe(true);
        // `e1`/`e2` resolve to the nonterminal `e`, so they are not terminals.
        expect(project.terminals.has('e1')).toBe(false);
    });

    test('the subrule graph is transitively closed', async () => {
        const f = await symbolsOf('a.ott', 'subrules\n  w <:: v\n  v <:: t\n');
        const project = buildProjectSymbols([f]);
        expect([...(project.subrules.get('t') ?? [])].sort()).toEqual(['v', 'w']);
    });
});
