import type { AstNode } from 'langium';
import { AstUtils, CstUtils, GrammarAST } from 'langium';
import type { Defn, Fundefn, GrammarRule, Production } from '../generated/ast.js';

/**
 * Which source spans hold object language.
 *
 * Shared by highlighting and by navigation so the two cannot disagree about
 * what counts: a token the highlighter coloured must be one hover can explain,
 * and a span it left alone must be one go-to-definition ignores.
 *
 * Spans rather than individual element nodes, because our lexer splits `->`
 * into `-` and `>`; only maximal munch over the whole run reassembles it.
 */

export interface Span {
    readonly offset: number;
    readonly end: number;
}

/** The span covered by a contiguous run of nodes, if they have one. */
function spanOf(nodes: readonly AstNode[]): Span | undefined {
    if (nodes.length === 0) return undefined;
    const first = nodes[0].$cstNode;
    const last = nodes[nodes.length - 1].$cstNode;
    if (!first || !last || last.end <= first.offset) return undefined;
    return { offset: first.offset, end: last.end };
}

/**
 * A defn's judgement form, plus the runs of premises and conclusions after
 * `by`. Rule separators and `{{ com … }}` blocks are Ott syntax, so a run never
 * straddles one.
 */
function defnSpans(defn: Defn | Fundefn): Span[] {
    const spans: Span[] = [];
    const header = spanOf(defn.elements ?? []);
    if (header) spans.push(header);

    let run: AstNode[] = [];
    for (const item of defn.body ?? []) {
        if (item.$type === 'RuleSeparator' || item.$type === 'DefnComment') {
            const span = spanOf(run);
            if (span) spans.push(span);
            run = [];
        } else {
            run.push(item);
        }
    }
    const last = spanOf(run);
    if (last) spans.push(last);
    return spans;
}

/** The right-hand side of each production — where a terminal is introduced. */
function ruleSpans(rule: GrammarRule): Span[] {
    const spans: Span[] = [];
    for (const production of rule.productions ?? []) {
        const span = spanOf((production as Production).elements ?? []);
        if (span) spans.push(span);
    }
    return spans;
}

/**
 * The object-language spans a single node contributes, or an empty list if it
 * contributes none. `EmbedBlock` and homomorphism bodies contribute nothing —
 * that is target-language text Ott does not read — while a `[[ … ]]` splice
 * inside a hom is its own node and does contribute.
 */
export function spansOfNode(node: AstNode): Span[] {
    switch (node.$type) {
        case 'GrammarRule':
            return ruleSpans(node as GrammarRule);
        case 'Defn':
        case 'Fundefn':
            return defnSpans(node as Defn | Fundefn);
        case 'HomInnerBlock': {
            const cst = node.$cstNode;
            return cst ? [{ offset: cst.offset, end: cst.end }] : [];
        }
        default:
            return [];
    }
}

/** True if `node` or an ancestor is one whose contents we never treat as Ott. */
export function isInsideOpaqueText(node: AstNode): boolean {
    return AstUtils.getContainerOfType(node, (n): n is AstNode => n.$type === 'EmbedBlock')
        !== undefined;
}

/**
 * The object-language span containing `offset`, searching from `node` upwards.
 * Returns undefined when the offset is not in object-language text at all —
 * inside a hom body, an embed block, or on Ott's own syntax.
 */
export function spanAt(node: AstNode, offset: number): Span | undefined {
    if (isInsideOpaqueText(node)) return undefined;
    for (let current: AstNode | undefined = node; current; current = current.$container) {
        for (const span of spansOfNode(current)) {
            if (offset >= span.offset && offset < span.end) return span;
        }
    }
    return undefined;
}

/**
 * The offset just past a defn's `by`, which is where its body begins.
 *
 * The grammar puts a defn's header and its rules in one flat node, so "am I in
 * the header or in the body" is not a question the AST answers — only the `by`
 * separates them. Shared by rule formatting and by the completion provider,
 * which must not offer an inference rule where a judgement form goes.
 */
export function defnBodyStart(defn: Defn | Fundefn): number | undefined {
    const cst = defn.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        const source = leaf.grammarSource;
        if (source && GrammarAST.isKeyword(source) && source.value === 'by') return leaf.end;
    }
    return undefined;
}
