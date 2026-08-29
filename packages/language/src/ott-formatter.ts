import type { AstNode, LangiumDocument } from 'langium';
import type { LangiumServices, NodeFormatter } from 'langium/lsp';
import { AbstractFormatter, Formatting } from 'langium/lsp';
import type {
    DocumentFormattingParams, DocumentRangeFormattingParams, FormattingOptions,
    Range, TextEdit,
} from 'vscode-languageserver';
import { match } from 'ts-pattern';
import type { RuleFormatSettings } from './format/settings.js';
import { DEFAULT_RULE_SETTINGS, isNoOp, readRuleSettings } from './format/settings.js';
import { collectRuleBodies, ruleReplacements } from './format/rules.js';
import type {
    Defn, DefnClass, ExtendsDecl, FreevarsBlock, GrammarRule, Homomorphism,
    ImportsDecl, MetavarDefn, ModuleDecl, ParsingBlock, Production,
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
 *
 * Inference-rule layout is the one exception, and it is opt-in: with
 * `ott.format.rules.*` at its defaults this formatter produces byte-identical
 * output to the structure-only behaviour above. Switched on, a second pass
 * (`format/rules.ts`) fits each dashed bar to the rule's widest line and
 * optionally indents it. That pass cannot use the Langium formatting API at all
 * — rewriting a token's text is not something `NodeFormatter` can express, and
 * the body is a flat token soup with newlines hidden — so it works on raw text
 * offsets and its edits are merged in below.
 */
export class OttFormatter extends AbstractFormatter {

    /** Set before `doDocumentFormat` runs; see `formatDocument`. */
    private settings: RuleFormatSettings = DEFAULT_RULE_SETTINGS;
    private cached?: RuleFormatSettings;
    private listening = false;

    /** Absent in a bare service container; rule formatting then stays at its
     *  defaults, which is "do nothing". */
    constructor(private readonly services?: LangiumServices) {
        super();
    }

    /**
     * Rule layout is configured through `workspace/configuration`, which is
     * async, while `format` and `doDocumentFormat` are not. The three LSP entry
     * points are the only async seam, so the fetch happens here and the result
     * is handed down in a field.
     */
    override async formatDocument(
        document: LangiumDocument, params: DocumentFormattingParams,
    ): Promise<TextEdit[]> {
        this.settings = await this.loadSettings();
        return super.formatDocument(document, params);
    }

    override async formatDocumentRange(
        document: LangiumDocument, params: DocumentRangeFormattingParams,
    ): Promise<TextEdit[]> {
        this.settings = await this.loadSettings();
        return super.formatDocumentRange(document, params);
    }

    private async loadSettings(): Promise<RuleFormatSettings> {
        const configuration = this.services?.shared.workspace.ConfigurationProvider;
        if (!configuration) return DEFAULT_RULE_SETTINGS;
        if (this.cached) return this.cached;
        if (!this.listening) {
            this.listening = true;
            configuration.onConfigurationSectionUpdate(() => { this.cached = undefined; });
        }
        try {
            this.cached = readRuleSettings(await configuration.getConfiguration('ott', 'format'));
        } catch (error) {
            // A client that never answers `workspace/configuration` must not
            // leave the document unformattable.
            console.error('[ott] could not read format settings, using defaults:', error);
            this.cached = DEFAULT_RULE_SETTINGS;
        }
        return this.cached;
    }

    /**
     * Structural formatting, then inference-rule layout on top.
     *
     * Overriding here rather than in `formatDocument` covers range formatting
     * too. `avoidOverlappingEdits` compares each edit only against the last one
     * it accepted, so the merged list has to be in ascending document order —
     * hence the sort. The two sets should not overlap in any case: the
     * structural pass emits nothing between `by` and a body's last token, and
     * the rule pass emits nothing outside that span.
     */
    protected override doDocumentFormat(
        document: LangiumDocument, options: FormattingOptions, range?: Range,
    ): TextEdit[] {
        const structural = super.doDocumentFormat(document, options, range);
        if (isNoOp(this.settings)) return structural;

        let rules: TextEdit[];
        try {
            rules = this.ruleEdits(document, range);
        } catch (error) {
            console.error('[ott] inference-rule formatting failed, skipping:', error);
            return structural;
        }
        if (rules.length === 0) return structural;

        return this.avoidOverlappingEdits(
            document.textDocument,
            [...structural, ...rules].sort((a, b) =>
                document.textDocument.offsetAt(a.range.start)
                - document.textDocument.offsetAt(b.range.start)),
        );
    }

    private ruleEdits(document: LangiumDocument, range?: Range): TextEdit[] {
        const text = document.textDocument.getText();
        const bodies = collectRuleBodies(document.parseResult.value);
        const limit = range === undefined ? undefined : {
            start: document.textDocument.offsetAt(range.start),
            end: document.textDocument.offsetAt(range.end),
        };
        return ruleReplacements(text, bodies, this.settings)
            .filter(r => limit === undefined || (r.start >= limit.start && r.end <= limit.end))
            .map(r => ({
                range: {
                    start: document.textDocument.positionAt(r.start),
                    end: document.textDocument.positionAt(r.end),
                },
                newText: r.text,
            }));
    }

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
            .with('ModuleDecl', 'ExtendsDecl', 'ImportsDecl',
                () => this.formatHeaderDecl(node as ModuleDecl | ExtendsDecl | ImportsDecl))
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
        const header = node.header ?? [];
        if (node.items.length === 0 && header.length === 0) return;
        const formatter = this.getNodeFormatter(node);

        // Module header: one declaration per line, no blank line between them
        // (`module l2` / `extends l1` are consecutive lines upstream), then a
        // blank line before the first item.
        if (header.length > 0) {
            formatter.node(header[0]).prepend(Formatting.noSpace());
            if (header.length > 1) {
                formatter.nodes(...header.slice(1)).prepend(Formatting.newLine());
            }
        }

        if (node.items.length > 0) {
            // Without a header the first item starts the file; with one it must
            // keep the line break, or `module tapl` and `metavar` would be
            // joined into `module taplmetavar`.
            formatter.node(node.items[0]).prepend(
                header.length > 0 ? Formatting.newLines(2) : Formatting.noSpace(),
            );
        }
        // Subsequent items: blank line between them
        if (node.items.length > 1) {
            formatter.nodes(...node.items.slice(1)).prepend(Formatting.newLines(2));
        }
    }

    // ── Module header ────────────────────────────────────────

    /** `module N`, `extends N renaming a as b, c as d`, `imports N ...`. */
    private formatHeaderDecl(node: ModuleDecl | ExtendsDecl | ImportsDecl): void {
        const formatter = this.getNodeFormatter(node);
        for (const kw of ['module', 'extends', 'imports', 'renaming', 'as']) {
            formatter.keyword(kw).append(Formatting.oneSpace());
        }
        formatter.keywords('renaming').prepend(Formatting.oneSpace());
        formatter.keywords('as').prepend(Formatting.oneSpace());
        formatter.keywords(',').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
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
