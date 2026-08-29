import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/**
 * The TextMate grammar colours Ott's *own* syntax; semantic tokens handle the
 * object language on top of it. The module header is the one place the two have
 * to agree about a contextual keyword, and getting it wrong is invisible until
 * someone opens a file — `module tapl` simply appears uncoloured, or worse, a
 * production named `module` lights up as one.
 *
 * These check the patterns' behaviour with JS regexes rather than through a
 * TextMate engine. That is not a full tokenisation test, but the patterns here
 * are simple enough that the two agree, and it catches the regression that
 * matters: the header keywords being anchored wrongly.
 */

const GRAMMAR_PATH = new URL('../syntaxes/ott.tmLanguage.json', import.meta.url).pathname;
// eslint-disable-next-line security/detect-non-literal-fs-filename
const grammar = JSON.parse(readFileSync(GRAMMAR_PATH, 'utf-8')) as {
    patterns: Array<{ include?: string }>;
    repository: Record<string, {
        begin?: string; end?: string; match?: string;
        patterns?: Array<{ match: string; name: string }>;
    }>;
};

describe('module header', () => {
    const header = grammar.repository['module-header'];

    test('is included in the top-level patterns', () => {
        expect(grammar.patterns.map(p => p.include)).toContain('#module-header');
    });

    test('matches a header declaration at the start of a line', () => {
        const begin = new RegExp(header.begin as string);
        for (const line of ['module tapl', 'extends l1', '  module l2',
            'imports a renaming t as a_t, x as a_x']) {
            expect(begin.test(line), line).toBe(true);
        }
    });

    test('does not match the same words used as ordinary names', () => {
        const begin = new RegExp(header.begin as string);
        // tests/test-j.ott:8 has a production named `module`, and a metavar may
        // be called one too. Both appear mid-line, never at the start.
        for (const line of ['  | U . Term :: :: module', 'metavar module ::=',
            '  | t as T :: :: ascribe', '  | e1 e2 :: :: app']) {
            expect(begin.test(line), line).toBe(false);
        }
    });

    test('scopes `renaming` and `as` to the header line only', () => {
        // They live in the block's inner patterns, so they cannot match on a
        // line where the block never began — `t as T` in tapl/ascribe.ott.
        const inner = header.patterns?.[0];
        expect(inner?.match).toBeDefined();
        expect(new RegExp(inner!.match, 'g').exec('imports a renaming t as a_t')?.[0])
            .toBe('renaming');
        expect(header.end).toBe('$');
    });
});

describe('item keywords', () => {
    const block = new RegExp(grammar.repository['keyword-block'].match as string);
    const decl = new RegExp(grammar.repository['keyword-decl'].match as string);

    test('cover every item Ott has', () => {
        // From `item:` in `grammar_parser.mly:143-161`. Missing entries are
        // invisible -- the word simply stays uncoloured next to its neighbours,
        // which is how `contextrules`, `funs`, `fun` and `homs` went unnoticed.
        for (const keyword of ['grammar', 'defns', 'defn', 'funs', 'fun', 'embed', 'homs',
            'subrules', 'contextrules', 'substitutions', 'freevars', 'parsing',
            'begincoqsection', 'endcoqsection', 'coqvariable']) {
            expect(block.test(keyword), keyword).toBe(true);
        }
        for (const keyword of ['metavar', 'indexvar']) {
            expect(decl.test(keyword), keyword).toBe(true);
        }
    });

    test('only match as the first word of a line', () => {
        // Ott decides an item keyword by the first word of a line
        // (`grammar_lexer.mll:436-460`), so these are object-language text.
        for (const line of ['  | fun x -> e :: :: fun', '  | e1 e2 :: :: grammar',
            'G |- embed : T', '  | t as T :: :: ascribe']) {
            expect(block.test(line), line).toBe(false);
        }
        expect(decl.test('  | metavar x :: :: mv'), 'metavar mid-line').toBe(false);
    });

    test('still match when the line is indented', () => {
        expect(block.test('  defn')).toBe(true);
    });

    test('`terminals` is not among them', () => {
        // It is an ordinary grammar rule whose name happens to be `terminals`,
        // despite what `docs/reference/syntax-reference.rst` says.
        expect(block.test('terminals :: \'terminals_\' ::=')).toBe(false);
    });
});
