import { AstUtils, CstUtils, GrammarAST } from 'langium';
import type { AstNode } from 'langium';
import type { Defn, Fundefn } from '../generated/ast.js';
import type { Alignment, RuleFormatSettings } from './settings.js';

/**
 * Laying out inference rules.
 *
 * Ott's rule syntax is line-oriented in a way its item syntax is not
 * (`grammar_parser.mly:465-468`):
 *
 *     semiraw_rule_list ::= neblanklinelist semiraw_rule semiraw_rule_list | ...
 *     semiraw_rule      ::= linelist lineline linelist   -- premises, bar, conclusions
 *                         | nelinelist                   -- lineless: conclusion only
 *
 * and the lexer (`grammar_lexer.mll:425-435`) makes a whitespace-only line a
 * BLANKLINE, which is what separates one rule from the next — and is mandatory
 * before every one of them.
 *
 * Two things in that layout carry no meaning, which is what makes this safe:
 * the bar is lexed as `"----" "-"*` and its length is never read, and both LINE
 * and LINELINE allow a `non_newline_whitespace*` prefix, so indentation is free.
 * Everything else does carry meaning.
 *
 * Hence the invariant every replacement here obeys: **none of them spans a
 * newline.** Line count, blank lines and the assignment of content to lines are
 * therefore unchanged by construction rather than by care — which is the only
 * reason rewriting a hand-laid-out spec is defensible at all.
 *
 * Our own grammar hides newlines (`hidden terminal NL`) and flattens a defn
 * body to a token soup of `DefnBodyItem`, so none of this can come from the AST.
 * The AST supplies only the anchors — where each body starts and ends, and where
 * each bar is — and the layout itself is read off the raw text.
 */

/** A defn or fundefn body, located in the source. */
export interface RuleBody {
    /** Offset just past the `by` keyword. */
    readonly start: number;
    /** Offset just past the body's last token. */
    readonly end: number;
    /** Offset of the first `-` of each rule separator. */
    readonly barOffsets: readonly number[];
}

/** An offset-addressed text replacement. Never spans a newline. */
export interface Replacement {
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

/** Ott's minimum bar, from `"----" "-"*` — also our own `terminal DASH_LINE`. */
const MIN_BAR = 4;

const BLANK = /^[ \t]*$/;
const COMMENT = /^[ \t]*%/;

/**
 * Random access to the lines of a document.
 *
 * Everything below addresses lines by number, so the raw index arithmetic is
 * confined here rather than spread across the layout logic.
 */
class LineIndex {
    private readonly starts: readonly number[];

    constructor(private readonly text: string) {
        const starts = [0];
        for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
            starts.push(i + 1);
        }
        this.starts = starts;
    }

    /** Start offset of a line. */
    startOf(line: number): number {
        // eslint-disable-next-line security/detect-object-injection -- numeric index into an array this class built
        return line >= 0 && line < this.starts.length ? this.starts[line] : this.text.length;
    }

    /** The line holding `offset`, by binary search. */
    lineAt(offset: number): number {
        let low = 0;
        let high = this.starts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (this.startOf(mid) <= offset) low = mid;
            else high = mid - 1;
        }
        return low;
    }

    /** One line's text, without its terminator. */
    textOf(line: number): string {
        const start = this.startOf(line);
        const end = line + 1 < this.starts.length ? this.startOf(line + 1) : this.text.length;
        return this.text.slice(start, end).replace(/\r?\n$/, '');
    }
}

/** How many leading spaces/tabs a line has. */
function indentWidth(line: string): number {
    return line.length - line.trimStart().length;
}

/** The lines of one rule: premises above the bar, conclusions below. */
interface RuleLines {
    readonly premises: readonly number[];
    readonly conclusions: readonly number[];
}

/**
 * The rule around `bar`, or undefined if it is not one we should touch.
 *
 * A walk that stops on another bar rather than on a blank line means two rules
 * were written without the blank line Ott requires between them. Their premise
 * and conclusion runs would then overlap, so neither rule is claimed — which is
 * also what keeps the replacements this module emits disjoint.
 */
function ruleLines(
    lines: LineIndex, bars: ReadonlySet<number>,
    bar: number, firstLine: number, lastLine: number,
): RuleLines | undefined {
    const premises: number[] = [];
    for (let i = bar - 1; i >= firstLine && !BLANK.test(lines.textOf(i)); i--) {
        if (bars.has(i)) return undefined;
        premises.push(i);
    }
    premises.reverse();

    const conclusions: number[] = [];
    for (let j = bar + 1; j <= lastLine && !BLANK.test(lines.textOf(j)); j++) {
        if (bars.has(j)) return undefined;
        conclusions.push(j);
    }
    // A bar with nothing under it is not a rule Ott would accept either.
    return conclusions.length === 0 ? undefined : { premises, conclusions };
}

/** Where the run of dashes starting at `offset` ends. */
function dashEnd(text: string, offset: number): number {
    let end = offset;
    while (text.charAt(end) === '-') end++;
    return end;
}

/** `auto` resolved against the shape of this particular rule. */
function resolveAlignment(alignment: Alignment, premiseCount: number): Alignment {
    if (alignment !== 'auto') return alignment;
    return premiseCount <= 1 ? 'center' : 'left';
}

/** The bar width this rule should end up with. */
function barWidth(
    settings: RuleFormatSettings, contentWidth: number, current: number,
): number {
    if (settings.bar !== 'fit') return current;
    const wanted = contentWidth + settings.barPadding;
    const capped = settings.maxBarWidth > 0 ? Math.min(wanted, settings.maxBarWidth) : wanted;
    return Math.max(MIN_BAR, capped);
}

/**
 * Indentation for the lines of one rule.
 *
 * The margin is measured over the rule as written, so a rule that is indented as
 * a whole keeps its indentation. Centring only ever pushes content right of the
 * bar, and the bar itself always sits on the margin, so the measured minimum is
 * stable and a second pass is a no-op.
 */
function alignmentReplacements(
    lines: LineIndex, texts: ReadonlyMap<number, string>,
    all: readonly number[], bar: number, mode: Alignment, target: number,
): Replacement[] {
    const laid = all.filter(line => !COMMENT.test(texts.get(line) ?? ''));
    const margin = Math.min(...laid.map(line => indentWidth(texts.get(line) ?? '')));

    const out: Replacement[] = [];
    for (const line of laid) {
        const source = texts.get(line) ?? '';
        const offset = mode === 'center' && line !== bar
            ? Math.max(0, Math.floor((target - source.trim().length) / 2))
            : 0;
        const existing = indentWidth(source);
        if (existing !== margin + offset) {
            out.push({
                start: lines.startOf(line),
                end: lines.startOf(line) + existing,
                text: ' '.repeat(margin + offset),
            });
        }
    }
    return out;
}

/** The replacements for a single rule, or none if it should be left alone. */
function ruleAt(
    text: string, lines: LineIndex, bars: ReadonlySet<number>, barOffset: number,
    bar: number, firstLine: number, lastLine: number, settings: RuleFormatSettings,
): Replacement[] {
    const found = ruleLines(lines, bars, bar, firstLine, lastLine);
    if (!found) return [];
    const { premises, conclusions } = found;

    const all = [...premises, bar, ...conclusions];
    const texts = new Map(all.map(line => [line, lines.textOf(line)]));
    // Tabs would make every column below a guess. No rule in the upstream corpus
    // has one; rather than expand them against a tab width the author may not
    // share, leave such a rule exactly as written.
    if ([...texts.values()].some(line => line.includes('\t'))) return [];

    const isTerm = (line: number): boolean => !COMMENT.test(texts.get(line) ?? '');
    const content = [...premises, ...conclusions].filter(isTerm);
    if (content.length === 0) return [];

    const width = Math.max(...content.map(line => (texts.get(line) ?? '').trim().length));
    const current = dashEnd(text, barOffset) - barOffset;
    const target = barWidth(settings, width, current);

    const mode = resolveAlignment(settings.alignment, premises.filter(isTerm).length);
    const out = mode === 'off'
        ? []
        : alignmentReplacements(lines, texts, all, bar, mode, target);

    if (target !== current) {
        out.push({ start: barOffset, end: barOffset + current, text: '-'.repeat(target) });
    }
    return out;
}

/**
 * Replacements that lay out every inference rule in `bodies`.
 *
 * Pure over text and offsets, so it can be tested without a language server and
 * the "never spans a newline" invariant is checkable directly.
 */
export function ruleReplacements(
    text: string, bodies: readonly RuleBody[], settings: RuleFormatSettings,
): Replacement[] {
    const lines = new LineIndex(text);
    const out: Replacement[] = [];

    for (const body of bodies) {
        // Ott requires a blank line after `by`, so rule content always begins on
        // a later line; bounding the upward walk here keeps a malformed
        // `by <premise>` out of the measurement rather than mis-measuring it.
        const firstLine = lines.lineAt(body.start) + 1;
        const lastLine = lines.lineAt(body.end);
        if (firstLine > lastLine) continue;

        const barByLine = new Map(body.barOffsets.map(o => [lines.lineAt(o), o]));
        const barLines: ReadonlySet<number> = new Set(barByLine.keys());
        for (const [bar, offset] of barByLine) {
            if (bar < firstLine || bar > lastLine) continue;
            out.push(...ruleAt(
                text, lines, barLines, offset, bar, firstLine, lastLine, settings,
            ));
        }
    }

    out.sort((a, b) => a.start - b.start);
    return out;
}

/** The offset just past a defn's `by`, which is where its body begins. */
function bodyStart(defn: Defn | Fundefn): number | undefined {
    const cst = defn.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        const source = leaf.grammarSource;
        if (source && GrammarAST.isKeyword(source) && source.value === 'by') return leaf.end;
    }
    return undefined;
}

/** Every defn and fundefn body in a parsed document, with its rule bars. */
export function collectRuleBodies(root: AstNode): RuleBody[] {
    const bodies: RuleBody[] = [];
    for (const node of AstUtils.streamAst(root)) {
        if (node.$type !== 'Defn' && node.$type !== 'Fundefn') continue;
        const defn = node as Defn | Fundefn;
        const items = defn.body ?? [];
        const last = items.length > 0 ? items[items.length - 1].$cstNode : undefined;
        const start = bodyStart(defn);
        if (start === undefined || !last) continue;

        const barOffsets = items
            .filter(item => item.$type === 'RuleSeparator' && item.$cstNode)
            .map(item => item.$cstNode!.offset);
        if (barOffsets.length > 0) bodies.push({ start, end: last.end, barOffsets });
    }
    return bodies;
}
