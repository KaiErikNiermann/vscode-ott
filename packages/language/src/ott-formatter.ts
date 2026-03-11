import type { AstNode } from 'langium';
import type { NodeFormatter } from 'langium/lsp';
import { AbstractFormatter, Formatting } from 'langium/lsp';
import { match } from 'ts-pattern';
import type {
    BindSpec, Comprehension, Defn, DefnClass, EmbedBlock,
    FreevarsBlock, GrammarBlock, GrammarRule, Homomorphism,
    MetavarDefn, ParsingBlock, Production, RuleSeparator,
    SourceFile, SubrulesBlock, SubstitutionsBlock,
} from './generated/ast.js';

/**
 * Ott language formatter.
 *
 * Formatting strategy (conservative, section-level first):
 * - Blank line between top-level items (metavar, grammar, defns, etc.)
 * - 2-space indentation for productions within grammar rules
 * - 2-space indentation for homomorphism continuations
 * - Consistent spacing around :: and ::= delimiters
 * - Blank line between inference rules within a defn
 * - Blank line between defns within a defnclass
 */
export class OttFormatter extends AbstractFormatter {

    protected format(node: AstNode): void {
        match(node.$type)
            .with('SourceFile', () => this.formatSourceFile(node as SourceFile))
            .with('MetavarDefn', () => this.formatMetavarDefn(node as MetavarDefn))
            .with('GrammarBlock', () => this.formatGrammarBlock(node as GrammarBlock))
            .with('GrammarRule', () => this.formatGrammarRule(node as GrammarRule))
            .with('Production', () => this.formatProduction(node as Production))
            .with('DefnClass', () => this.formatDefnClass(node as DefnClass))
            .with('Defn', () => this.formatDefn(node as Defn))
            .with('RuleSeparator', () => this.formatRuleSeparator(node as RuleSeparator))
            .with('Homomorphism', () => this.formatHomomorphism(node as Homomorphism))
            .with('Comprehension', () => this.formatComprehension(node as Comprehension))
            .with('BindSpec', () => this.formatBindSpec(node as BindSpec))
            .with('EmbedBlock', () => this.formatEmbedBlock(node as EmbedBlock))
            .with('SubrulesBlock', () => this.formatSubrulesBlock(node as SubrulesBlock))
            .with('SubstitutionsBlock', () => this.formatSubstitutionsBlock(node as SubstitutionsBlock))
            .with('FreevarsBlock', () => this.formatFreevarsBlock(node as FreevarsBlock))
            .with('ParsingBlock', () => this.formatParsingBlock(node as ParsingBlock))
            .otherwise(() => { /* no formatting for other nodes */ });
    }

    // ── Shared helpers ─────────────────────────────────────────

    /**
     * Format a list of homomorphisms on a parent node.
     * - Single hom: stays inline (space before)
     * - Multiple homs: each on a new indented line
     * - alwaysIndent: force indentation even for single hom (e.g. on productions)
     */
    private formatHoms(
        formatter: NodeFormatter<AstNode>,
        homs: readonly Homomorphism[],
        alwaysIndent = false,
    ): void {
        if (homs.length === 0) return;
        if (!alwaysIndent && homs.length === 1) {
            formatter.nodes(...homs).prepend(Formatting.oneSpace());
        } else {
            formatter.nodes(...homs).prepend(Formatting.indent());
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
        // Space around ::=
        formatter.keyword('::=').surround(Formatting.oneSpace());
        // Homomorphisms: inline if single, indented if multiple
        this.formatHoms(formatter, node.homomorphisms);
    }

    // ── Grammar ──────────────────────────────────────────────

    private formatGrammarBlock(node: GrammarBlock): void {
        const formatter = this.getNodeFormatter(node);
        // Each grammar rule on a new line after the 'grammar' keyword
        formatter.nodes(...node.rules).prepend(Formatting.newLine());
    }

    private formatGrammarRule(node: GrammarRule): void {
        const formatter = this.getNodeFormatter(node);
        // Commas between names: no space before, space after
        formatter.keywords(',').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
        // Space around :: and ::=
        formatter.keyword('::').surround(Formatting.oneSpace());
        formatter.keyword('::=').surround(Formatting.oneSpace());
        // Homomorphisms: inline if single, indented if multiple
        this.formatHoms(formatter, node.homomorphisms);
        // Productions on new indented lines
        formatter.nodes(...node.productions).prepend(Formatting.newLine());
    }

    private formatProduction(node: Production): void {
        const formatter = this.getNodeFormatter(node);
        // Pipe at start, indented
        formatter.keyword('|').prepend(Formatting.indent());
        // Space after pipe
        formatter.nodes(...node.elements).prepend(Formatting.oneSpace());
        // Space around the two :: delimiters
        // First :: separates elements from modifiers, second :: from name
        formatter.keywords('::').surround(Formatting.oneSpace());
        // Homomorphisms always indented on productions (lines are already long)
        this.formatHoms(formatter, node.homomorphisms, true);
        formatter.nodes(...node.bindspecs).prepend(Formatting.oneSpace());
    }

    // ── Definition classes ───────────────────────────────────

    private formatDefnClass(node: DefnClass): void {
        const formatter = this.getNodeFormatter(node);
        // Space after 'defns'
        formatter.keyword('defns').append(Formatting.oneSpace());
        // Space around :: and ::=
        formatter.keyword('::').surround(Formatting.oneSpace());
        formatter.keyword('::=').surround(Formatting.oneSpace());
        // Homomorphisms: inline if single, indented if multiple
        this.formatHoms(formatter, node.homomorphisms);
        // Blank line before each defn
        formatter.nodes(...node.definitions).prepend(Formatting.newLines(2));
    }

    private formatDefn(node: Defn): void {
        const formatter = this.getNodeFormatter(node);
        // Space after 'defn'
        formatter.keyword('defn').append(Formatting.oneSpace());
        // Elements of the judgement form
        formatter.nodes(...node.elements).prepend(Formatting.oneSpace());
        // Space around :: :: name :: namespace
        formatter.keywords('::').surround(Formatting.oneSpace());
        // Space before 'by'
        formatter.keyword('by').prepend(Formatting.oneSpace());
        // Body items: new line for each
        formatter.nodes(...node.body).prepend(Formatting.newLine());
        // Homomorphisms: inline if single, indented if multiple
        this.formatHoms(formatter, node.homomorphisms);
        formatter.nodes(...node.bindspecs).prepend(Formatting.oneSpace());
    }

    private formatRuleSeparator(node: RuleSeparator): void {
        const formatter = this.getNodeFormatter(node);
        // Blank line before rule separator (separates rules visually)
        formatter.node(node).prepend(Formatting.newLines(2));
        // Space between dash line and :: name
        formatter.keyword('::').prepend(Formatting.oneSpace()).append(Formatting.oneSpace());
    }

    // ── Homomorphisms ────────────────────────────────────────

    private formatHomomorphism(node: Homomorphism): void {
        const formatter = this.getNodeFormatter(node);
        // No space after {{ and before }}
        formatter.keyword('{{').append(Formatting.oneSpace());
        formatter.keyword('}}').prepend(Formatting.oneSpace());
    }

    // ── Comprehensions ───────────────────────────────────────

    private formatComprehension(node: Comprehension): void {
        const formatter = this.getNodeFormatter(node);
        // Spaces inside comprehension delimiters
        formatter.keyword('</').append(Formatting.oneSpace());
        formatter.keyword('/>').prepend(Formatting.oneSpace());
        // Space around //
        formatter.keywords('//').surround(Formatting.oneSpace());
    }

    // ── Bind specs ───────────────────────────────────────────

    private formatBindSpec(node: BindSpec): void {
        const formatter = this.getNodeFormatter(node);
        // Space inside (+ and +)
        formatter.keyword('(+').append(Formatting.oneSpace());
        formatter.keyword('+)').prepend(Formatting.oneSpace());
    }

    // ── Embed ────────────────────────────────────────────────

    private formatEmbedBlock(node: EmbedBlock): void {
        const formatter = this.getNodeFormatter(node);
        // Homomorphisms after embed keyword
        formatter.nodes(...node.homomorphisms).prepend(Formatting.newLine());
    }

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
