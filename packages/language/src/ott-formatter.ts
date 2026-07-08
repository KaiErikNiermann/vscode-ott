import type { AstNode } from 'langium';
import type { NodeFormatter } from 'langium/lsp';
import { AbstractFormatter, Formatting } from 'langium/lsp';
import { match } from 'ts-pattern';
import type {
    Defn, DefnClass, FreevarsBlock, GrammarRule, Homomorphism,
    MetavarDefn, ParsingBlock, Production,
    SourceFile, SubrulesBlock, SubstitutionsBlock,
} from './generated/ast.js';

/**
 * Ott language formatter.
 *
 * Strategy: normalise *structure*, preserve *content*. Ott source is heavily
 * hand-aligned (column-aligned `terminals`, carefully laid-out inference rules)
 * and its object language is embedded as free text, so reflowing token spacing
 * does more harm than good. We therefore only touch structural whitespace:
 * - one blank line between top-level items;
 * - each production / defn on its own indented line;
 * - consistent spacing in *headers* (`metavar x ::=`, `t :: Tm ::=`,
 *   `defn ... :: :: name :: ns by`, `defns ... ::=`).
 *
 * Everything else is left exactly as written: production bodies and their
 * column alignment, defn bodies (the inference rules), homomorphism bodies
 * (multi-line target-language code), comprehensions and bind specs. Langium
 * only edits whitespace we emit an instruction for, so "emit nothing" == "keep".
 */
export class OttFormatter extends AbstractFormatter {

    protected format(node: AstNode): void {
        // Formatting walks a possibly error-recovered AST. A throw here would
        // fail the whole formatting request, so isolate each node.
        try {
            this.formatNode(node);
        } catch (error) {
            console.error('[ott] formatting failed on a node, skipping:', error);
        }
    }

    private formatNode(node: AstNode): void {
        match(node.$type)
            .with('SourceFile', () => this.formatSourceFile(node as SourceFile))
            .with('MetavarDefn', () => this.formatMetavarDefn(node as MetavarDefn))
            .with('GrammarRule', () => this.formatGrammarRule(node as GrammarRule))
            .with('Production', () => this.formatProduction(node as Production))
            .with('DefnClass', () => this.formatDefnClass(node as DefnClass))
            .with('Defn', () => this.formatDefn(node as Defn))
            .with('SubrulesBlock', () => this.formatSubrulesBlock(node as SubrulesBlock))
            .with('SubstitutionsBlock', () => this.formatSubstitutionsBlock(node as SubstitutionsBlock))
            .with('FreevarsBlock', () => this.formatFreevarsBlock(node as FreevarsBlock))
            .with('ParsingBlock', () => this.formatParsingBlock(node as ParsingBlock))
            .otherwise(() => { /* no formatting for other nodes */ });
    }

    // ── Shared helpers ─────────────────────────────────────────

    /**
     * Format a list of homomorphisms on a parent node.
     * - Single hom: pulled inline with one space before it.
     * - Multiple homs: preserved exactly as written. Authors group header homs
     *   deliberately (e.g. backends on one line, `{{ com ... }}` on another), so
     *   reflowing them one-per-line would destroy that intent.
     */
    private formatHoms(
        formatter: NodeFormatter<AstNode>,
        homs: readonly Homomorphism[],
    ): void {
        if (homs.length === 1) {
            formatter.nodes(...homs).prepend(Formatting.oneSpace());
        }
    }

    // ── Top-level structure ──────────────────────────────────

    private formatSourceFile(node: SourceFile): void {
        if (node.items.length === 0) return;
        const formatter = this.getNodeFormatter(node);
        // First item: no leading blank lines
        formatter.node(node.items[0]).prepend(Formatting.noSpace());
        // Subsequent items: blank line between them
        if (node.items.length > 1) {
            formatter.nodes(...node.items.slice(1)).prepend(Formatting.newLines(2));
        }
    }

    // ── Metavar/Indexvar ─────────────────────────────────────

    private formatMetavarDefn(node: MetavarDefn): void {
        const formatter = this.getNodeFormatter(node);
        // Space after metavar/indexvar keyword
        formatter.keyword(node.kind).append(Formatting.oneSpace());
        // Space after commas between names
        formatter.keywords(',').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
        // Space before ::= only — what follows (a single inline hom, a preserved
        // multi-hom block, or nothing) manages its own leading whitespace.
        formatter.keyword('::=').prepend(Formatting.oneSpace());
        this.formatHoms(formatter, node.homomorphisms);
    }

    // ── Grammar ──────────────────────────────────────────────
    // Note: the grammar block itself is not reformatted — the separation
    // between rules (including author blank lines) is preserved.

    private formatGrammarRule(node: GrammarRule): void {
        const formatter = this.getNodeFormatter(node);
        // Normalise the rule header (`t, u :: Tm ::=`) only.
        formatter.keywords(',').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
        formatter.keyword('::').surround(Formatting.oneSpace());
        formatter.keyword('::=').prepend(Formatting.oneSpace());
        // A single header hom stays inline; multiple are preserved as written.
        this.formatHoms(formatter, node.homomorphisms);
        // Each production onto its own indented line (Production formats itself).
    }

    private formatProduction(node: Production): void {
        const formatter = this.getNodeFormatter(node);
        // Pipe at the start of the production, on its own indented line.
        formatter.keyword('|').prepend(Formatting.indent());
        // Everything after `|` is preserved verbatim: Ott productions — and
        // especially `terminals` blocks — are hand-aligned into columns, and
        // object-language elements like `-->` / `|->` are multi-token. Emitting
        // spacing here would collapse the alignment and split those operators,
        // so we deliberately leave the element / `::` / hom layout untouched.
    }

    // ── Definition classes ───────────────────────────────────

    private formatDefnClass(node: DefnClass): void {
        const formatter = this.getNodeFormatter(node);
        // Space after 'defns'
        formatter.keyword('defns').append(Formatting.oneSpace());
        // Space around :: ; space before ::= (a following multi-hom block is preserved).
        formatter.keyword('::').surround(Formatting.oneSpace());
        formatter.keyword('::=').prepend(Formatting.oneSpace());
        this.formatHoms(formatter, node.homomorphisms);
        // Blank line before each defn
        formatter.nodes(...node.definitions).prepend(Formatting.newLines(2));
    }

    private formatDefn(node: Defn): void {
        const formatter = this.getNodeFormatter(node);
        // Normalise only the judgement *header* (`defn ... :: :: name :: ns`):
        formatter.keyword('defn').append(Formatting.oneSpace());
        // The header `::` delimiters are direct keywords of this rule (body `::`
        // live in child nodes), so this only touches `:: :: name :: namespace`.
        formatter.keywords('::').surround(Formatting.oneSpace());
        formatter.keyword('by').prepend(Formatting.oneSpace());
        // Header homomorphism (`{{ com ... }}`) stays inline.
        this.formatHoms(formatter, node.homomorphisms);
        formatter.nodes(...node.bindspecs).prepend(Formatting.oneSpace());
        // The body — the inference rules themselves — is preserved verbatim.
        // Its premise / dashes / conclusion line structure and the blank lines
        // between rules live only in the source whitespace (the grammar flattens
        // the body to a token soup), so any reflow here would destroy it and
        // split object-language operators. We intentionally emit nothing for it.
    }

    // Rule separators (the `----- :: name` lines inside a defn body) and
    // homomorphism bodies are intentionally not reformatted — the body is
    // preserved verbatim, and hom bodies hold multi-line target-language code
    // (`{{ tex-preamble ... }}`, `{{ coq ... }}`) that must keep its own layout.

    // Comprehensions (`</ ... // ... />`) and bind specs (`(+ ... +)`) are not
    // reformatted: they only ever occur inside productions and defn bodies, whose
    // object-language layout (often column-aligned) we preserve verbatim.

    // ── Subrules ─────────────────────────────────────────────

    private formatSubrulesBlock(node: SubrulesBlock): void {
        const formatter = this.getNodeFormatter(node);
        // Each entry on a new line
        formatter.nodes(...node.entries).prepend(Formatting.newLine());
    }

    // ── Substitutions ────────────────────────────────────────

    private formatSubstitutionsBlock(node: SubstitutionsBlock): void {
        const formatter = this.getNodeFormatter(node);
        formatter.nodes(...node.entries).prepend(Formatting.newLine());
    }

    // ── Freevars ─────────────────────────────────────────────

    private formatFreevarsBlock(node: FreevarsBlock): void {
        const formatter = this.getNodeFormatter(node);
        formatter.nodes(...node.entries).prepend(Formatting.newLine());
    }

    // ── Parsing ──────────────────────────────────────────────

    private formatParsingBlock(node: ParsingBlock): void {
        const formatter = this.getNodeFormatter(node);
        formatter.nodes(...node.directives).prepend(Formatting.newLine());
    }
}
