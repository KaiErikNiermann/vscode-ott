import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { EmptyFileSystem } from 'langium';
import { parseHelper } from 'langium/test';
import type { SourceFile } from 'ott-language';
import { createOttServices } from 'ott-language';
import type { TextEdit } from 'vscode-languageserver';
import {
    FIXTURES_DIR, OTT_REJECTS, OTT_UNPARSEABLE, collectOttFiles, ottAccepts, resolveOttBinary,
} from './helpers.js';

/**
 * Laying out inference rules.
 *
 * Two properties matter here and they are tested differently. The *appearance*
 * is checked by exact-output cases below, because there is no way to assert a
 * layout except by writing it down. The *safety* is checked over the whole
 * fixture corpus, because the risk is not that a bar comes out a column too
 * wide — it is that a rewrite silently changes what a spec means, and only real
 * files exercise the shapes that could do that.
 *
 * The safety argument is structural: no replacement spans a newline, so line
 * count, blank lines and the assignment of content to lines cannot change. The
 * corpus tests assert exactly that, since blank lines are what separate one Ott
 * rule from the next (`grammar_parser.mly:465-468`).
 */

const services = createOttServices(EmptyFileSystem);
const parse = parseHelper<SourceFile>(services.Ott);

interface Settings {
    readonly bar?: 'off' | 'fit';
    readonly alignment?: 'off' | 'left' | 'center' | 'auto';
    readonly barPadding?: number;
    readonly maxBarWidth?: number;
}

function configure(rules: Settings): void {
    services.shared.workspace.ConfigurationProvider.updateConfiguration(
        { settings: { ott: { format: { rules } } } },
    );
}

/** Apply LSP edits to a string, back to front so earlier offsets stay valid. */
function applyEdits(text: string, edits: readonly TextEdit[]): string {
    const lines = text.split('\n');
    const offsetAt = (p: { line: number; character: number }): number =>
        lines.slice(0, p.line).reduce((sum, l) => sum + l.length + 1, 0) + p.character;
    return [...edits]
        .sort((a, b) => offsetAt(b.range.start) - offsetAt(a.range.start))
        .reduce((out, edit) =>
            out.slice(0, offsetAt(edit.range.start))
            + edit.newText
            + out.slice(offsetAt(edit.range.end)), text);
}

async function format(input: string): Promise<string> {
    const document = await parse(input);
    const edits = await services.Ott.lsp.Formatter!.formatDocument(document, {
        textDocument: { uri: document.uri.toString() },
        options: { tabSize: 2, insertSpaces: true },
    }) as TextEdit[];
    return applyEdits(input, edits);
}

/** A defn whose header is already in the formatter's normal form, so the only
 *  edits a case can produce are the rule-layout ones under test. */
function defn(body: string): string {
    return `defns J :: '' ::=\n\ndefn G |- e : T :: :: typing :: 'typing_' by\n${body}`;
}

beforeEach(() => configure({}));

describe('defaults', () => {
    test('leave every inference rule exactly as written', async () => {
        const source = defn([
            '',
            'uniq G',
            'x : T in G',
            '--------------------------------- :: var',
            'G |- x : T',
            '',
        ].join('\n'));
        expect(await format(source)).toBe(source);
    });

    test('are what a client that answers nothing gets', async () => {
        // No `updateConfiguration` at all: an unconfigured client must land on
        // "change nothing", not on some middle behaviour.
        const source = defn('\np\n---------------- :: r\nc\n');
        expect(await format(source)).toBe(source);
    });
});

describe('bar fitting', () => {
    test('fits the bar to the widest line, not the narrower half', async () => {
        // The conclusion is the long side here and the premise the short one;
        // fitting to the premise would produce a bar shorter than the rule.
        configure({ bar: 'fit' });
        expect(await format(defn('\nuniq G\n---- :: var\nG |- x : T\n')))
            .toBe(defn('\nuniq G\n---------- :: var\nG |- x : T\n'));
    });

    test('fits to a premise when that is the longer side', async () => {
        configure({ bar: 'fit' });
        expect(await format(defn('\nG , x : T1 |- e : T2\n---- :: abs\nG |- e : T\n')))
            .toBe(defn('\nG , x : T1 |- e : T2\n-------------------- :: abs\nG |- e : T\n'));
    });

    test('shortens a bar that overshoots', async () => {
        configure({ bar: 'fit' });
        expect(await format(defn('\n------------------------------------ :: true\nG |- true : bool\n')))
            .toBe(defn('\n---------------- :: true\nG |- true : bool\n'));
    });

    test('keeps the categories and name that follow the bar', async () => {
        configure({ bar: 'fit' });
        expect(await format(defn('\n---- S :: paren\nG |- true : bool\n')))
            .toBe(defn('\n---------------- S :: paren\nG |- true : bool\n'));
    });

    test('never falls below the four dashes Ott requires', async () => {
        // `grammar_lexer.mll:434` lexes `"----" "-"*`, so a three-dash bar is
        // not a bar at all -- fitting `e` to its own width would unmake the rule.
        configure({ bar: 'fit' });
        expect(await format(defn('\n-------- :: r\ne\n')))
            .toBe(defn('\n---- :: r\ne\n'));
    });

    test('honours barPadding', async () => {
        configure({ bar: 'fit', barPadding: 3 });
        expect(await format(defn('\n---- :: r\nG |- x : T\n')))
            .toBe(defn('\n------------- :: r\nG |- x : T\n'));
    });

    test('caps a very wide rule at maxBarWidth', async () => {
        configure({ bar: 'fit', maxBarWidth: 12 });
        const wide = 'G |- a very long conclusion indeed : T';
        expect(await format(defn(`\n---- :: r\n${wide}\n`)))
            .toBe(defn(`\n------------ :: r\n${wide}\n`));
    });

    test('leaves the bar uncapped when maxBarWidth is zero', async () => {
        configure({ bar: 'fit', maxBarWidth: 0 });
        const wide = 'G |- a very long conclusion indeed : T';
        expect(await format(defn(`\n---- :: r\n${wide}\n`)))
            .toBe(defn(`\n${'-'.repeat(wide.length)} :: r\n${wide}\n`));
    });

    test('measures each rule in a defn independently', async () => {
        configure({ bar: 'fit' });
        expect(await format(defn('\n---- :: a\ne\n\n---- :: b\nG |- x : T\n')))
            .toBe(defn('\n---- :: a\ne\n\n---------- :: b\nG |- x : T\n'));
    });
});

describe('alignment', () => {
    test('left flushes every line to the block margin', async () => {
        configure({ alignment: 'left' });
        expect(await format(defn('\n    p1\n  p2\n---------- :: r\n      c\n')))
            .toBe(defn('\np1\np2\n---------- :: r\nc\n'));
    });

    test('left keeps a rule that is indented as a whole', async () => {
        // The margin is the rule's own, not column zero, so an indented defn
        // body stays indented.
        configure({ alignment: 'left' });
        expect(await format(defn('\n  p1\n    p2\n  ---------- :: r\n  c\n')))
            .toBe(defn('\n  p1\n  p2\n  ---------- :: r\n  c\n'));
    });

    test('center pads each line over the bar', async () => {
        configure({ alignment: 'center' });
        expect(await format(defn('\nuniq G\n---------- :: r\nG |- x : T\n')))
            .toBe(defn('\n  uniq G\n---------- :: r\nG |- x : T\n'));
    });

    test('center never pulls a line left of the bar', async () => {
        configure({ alignment: 'center' });
        const long = 'G |- a long conclusion : T';
        expect(await format(defn(`\n---- :: r\n${long}\n`)))
            .toBe(defn(`\n---- :: r\n${long}\n`));
    });

    test('auto centres a rule with a single premise', async () => {
        configure({ bar: 'fit', alignment: 'auto' });
        expect(await format(defn('\nuniq G\n---- :: r\nG |- x : T\n')))
            .toBe(defn('\n  uniq G\n---------- :: r\nG |- x : T\n'));
    });

    test('auto centres an axiom, which has no premises at all', async () => {
        configure({ bar: 'fit', alignment: 'auto' });
        expect(await format(defn('\n---- :: true\nG |- true : bool\n')))
            .toBe(defn('\n---------------- :: true\nG |- true : bool\n'));
    });

    test('auto flushes left once premises are stacked', async () => {
        configure({ bar: 'fit', alignment: 'auto' });
        expect(await format(defn('\nuniq G\nx : T in G\n---- :: var\nG |- x : T\n')))
            .toBe(defn('\nuniq G\nx : T in G\n---------- :: var\nG |- x : T\n'));
    });
});

describe('what it declines to touch', () => {
    test('a comment inside a rule is not a premise', async () => {
        // COMMENTLINE is legal inside a rule (`grammar_parser.mly:441-447`) but
        // is not a premise, so it must neither widen the bar nor be centred with
        // the terms around it. Its indentation is compared against the same file
        // formatted with rule layout off, because a `%` line is a hidden node
        // that the structural pass already re-indents on its own.
        const source = defn('\n% a note that is very much longer than any of the terms\nuniq G\n---- :: r\nG |- x : T\n');
        configure({});
        const baseline = (await format(source)).split('\n');
        configure({ bar: 'fit', alignment: 'center' });
        const laid = (await format(source)).split('\n');

        const comment = (lines: string[]): string => lines.find(l => l.includes('% a note'))!;
        expect(comment(laid), 'the comment was aligned as if it were a premise')
            .toBe(comment(baseline));
        expect(laid.find(l => l.startsWith('-')), 'the comment widened the bar')
            .toBe('---------- :: r');
    });

    test('two rules with no blank line between them are left alone', async () => {
        // Ott requires a blank line before every rule, so this is malformed --
        // and the premise and conclusion runs of the two rules would overlap.
        // Claiming neither is what keeps the emitted edits disjoint.
        configure({ bar: 'fit', alignment: 'center' });
        const source = defn('\n---------------- :: a\nc1\np2\n---------------- :: b\nc2\n');
        expect(await format(source)).toBe(source);
    });

    test('a bar with nothing under it is not a rule', async () => {
        configure({ bar: 'fit' });
        const source = defn('\nuniq G\n---------------- :: r\n');
        expect(await format(source)).toBe(source);
    });

    test('a rule containing a tab is left as written', async () => {
        // Column arithmetic against an unknown tab width would be a guess. No
        // rule in the upstream corpus contains one.
        configure({ bar: 'fit', alignment: 'left' });
        const source = defn('\nuniq\tG\n---- :: r\nG |- x : T\n');
        expect(await format(source)).toBe(source);
    });
});

describe('the corpus', () => {
    const files = collectOttFiles(FIXTURES_DIR)
        .filter(f => ![...OTT_UNPARSEABLE].some(u => f.endsWith(u)));

    /** Blank lines separate rules, and bars mark them; if either count moves,
     *  the file no longer says what it said. */
    function shape(text: string): { lines: number; blanks: number; bars: number } {
        const lines = text.split('\n');
        return {
            lines: lines.length,
            blanks: lines.filter(l => /^[ \t]*$/.test(l)).length,
            bars: lines.filter(l => /^[ \t]*----+/.test(l)).length,
        };
    }

    test.each(files)('%s is untouched at default settings', async file => {
        configure({});
        const source = readFileSync(file, 'utf-8');
        const before = await format(source);
        // The structural formatter still runs; what must not change is that
        // running it again with rule formatting off yields the same thing.
        expect(await format(before)).toBe(before);
    });

    test.each(files)('%s survives fit + auto', async file => {
        const source = readFileSync(file, 'utf-8');
        configure({});
        const structural = await format(source);
        configure({ bar: 'fit', alignment: 'auto' });
        const formatted = await format(source);

        const name = relative(FIXTURES_DIR, file);
        expect(shape(formatted), `${name}: rule structure changed`).toEqual(shape(structural));

        const reparsed = await parse(formatted);
        expect(reparsed.parseResult.parserErrors, `${name}: no longer parses`).toHaveLength(0);

        // Idempotent: a second pass has nothing left to do.
        expect(await format(formatted), `${name}: not idempotent`).toBe(formatted);
    });
});

describe('cross-checked against ott itself', () => {
    // Our own parser agreeing that the output still parses only proves we did
    // not break *our* grammar. The claim that matters is that ott still accepts
    // the file, and only ott can settle that.
    const ottPath = resolveOttBinary();
    const files = collectOttFiles(FIXTURES_DIR).filter(f =>
        ![...OTT_UNPARSEABLE, ...OTT_REJECTS].some(u => f.endsWith(u)));

    test.runIf(ottPath !== null).each(files)('ott still accepts %s after fit + auto',
        async file => {
            const name = relative(FIXTURES_DIR, file);
            configure({ bar: 'fit', alignment: 'auto' });
            const formatted = await format(readFileSync(file, 'utf-8'));
            expect(ottAccepts(ottPath as string, formatted, name)).toBe(true);
        });
});
