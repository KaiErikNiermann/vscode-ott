import type { AstNode, CstNode, LangiumDocument, MaybePromise } from 'langium';
import { CstUtils } from 'langium';
import type { HoverProvider } from 'langium/lsp';
import type { Hover, HoverParams } from 'vscode-languageserver';
import { match } from 'ts-pattern';
import type {
    Homomorphism, MetavarDefn, SourceFile,
    GrammarBlock, GrammarRule, Production,
    DefnClass, Defn, HomName,
} from './generated/ast.js';

/** Known homomorphism target descriptions. */
const HOM_DESCRIPTIONS: Record<string, string> = {
    'tex': 'LaTeX rendering — controls how this construct appears in typeset output',
    'tex-preamble': 'LaTeX preamble — included before the document body',
    'coq': 'Coq proof assistant — generates Coq definitions',
    'coq-equality': 'Coq equality — generates decidable equality for this type',
    'hol': 'HOL proof assistant — generates HOL definitions',
    'isa': 'Isabelle proof assistant — generates Isabelle theory definitions',
    'ocaml': 'OCaml — generates OCaml type definitions',
    'lex': 'Lexer hint — controls tokenization (e.g., `alphanum`, `numeral`)',
    'com': 'Comment — appears as a comment in generated LaTeX output',
    'ich': 'Isabelle/Coq/HOL — shared backend directive',
    'isasyn': 'Isabelle syntax — Isabelle-specific syntax annotations',
    'phantom': 'Phantom rule — not included in generated code',
};

export class OttHoverProvider implements HoverProvider {

    getHoverContent(
        document: LangiumDocument,
        params: HoverParams,
    ): MaybePromise<Hover | undefined> {
        const root = document.parseResult.value as SourceFile;
        const rootCst = root.$cstNode;
        if (!rootCst) return undefined;

        const offset = document.textDocument.offsetAt(params.position);
        const leaf = CstUtils.findLeafNodeAtOffset(rootCst, offset);
        if (!leaf) return undefined;

        const node = leaf.astNode;
        return this.hoverForNode(node, leaf, root);
    }

    private hoverForNode(
        node: AstNode,
        leaf: CstNode,
        root: SourceFile,
    ): Hover | undefined {
        return match(node)
            .with({ $type: 'HomName' }, n => this.hoverHomName(n as HomName))
            .with({ $type: 'MetavarDefn' }, n => this.hoverMetavarDefn(n as MetavarDefn))
            .with({ $type: 'GrammarRule' }, n => this.hoverGrammarRule(n as GrammarRule))
            .with({ $type: 'Production' }, n => this.hoverProduction(n as Production))
            .with({ $type: 'DefnClass' }, n => this.hoverDefnClass(n as DefnClass))
            .with({ $type: 'Defn' }, n => this.hoverDefn(n as Defn))
            .with({ $type: 'StringDesc' }, () =>
                this.hoverStringDesc(leaf, root))
            .with({ $type: 'ComprehensionBound' }, () => this.hoverComprehension())
            .with({ $type: 'BindSpecToken' }, () => this.hoverBindSpec())
            .with({ $type: 'SubruleEntry' }, () => this.hoverSubruleEntry())
            .otherwise(() => undefined);
    }

    private hoverHomName(node: HomName): Hover | undefined {
        const name = node.value;
        // eslint-disable-next-line security/detect-object-injection -- HOM_DESCRIPTIONS is a const we control
        const desc = HOM_DESCRIPTIONS[name] as string | undefined;
        const content = desc
            ? `**\`{{ ${name} }}\`** — ${desc}`
            : `**\`{{ ${name} }}\`** — Homomorphism target`;
        return this.makeHover(content, node.$cstNode);
    }

    private hoverMetavarDefn(node: MetavarDefn): Hover | undefined {
        const names = node.names.map(n => n.name).join(', ');
        const homs = this.formatHomomorphisms(node.homomorphisms);
        const lines = [`**${node.kind}** \`${names}\``];
        if (homs) lines.push('', '**Backends:**', homs);
        return this.makeHover(lines.join('\n'), node.$cstNode);
    }

    private hoverGrammarRule(node: GrammarRule): Hover | undefined {
        const names = node.names.map(n => n.name).join(', ');
        const ns = node.namespace.value ?? '';
        const prodCount = node.productions.length;
        const lines = [
            `**Grammar rule** \`${names}\` :: \`${ns}\``,
            '',
            `${prodCount} production${prodCount === 1 ? '' : 's'}:`,
            ...node.productions.map(p =>
                `- \`${p.name}\`: ${this.productionElements(p)}`),
        ];
        return this.makeHover(lines.join('\n'), node.$cstNode);
    }

    private hoverProduction(node: Production): Hover | undefined {
        const rule = node.$container;
        const ruleNames = rule.names.map(n => n.name).join(', ');
        const lines = [
            `**Production** \`${node.name}\` of \`${ruleNames}\``,
            '',
            `\`| ${this.productionElements(node)} :: :: ${node.name}\``,
        ];
        if (node.modifiers.length > 0) {
            lines.push(`', 'Modifiers: ${node.modifiers.join(', ')}`);
        }
        if (node.bindspecs.length > 0) {
            lines.push('', `Bind specs: ${node.bindspecs.length}`);
        }
        return this.makeHover(lines.join('\n'), node.$cstNode);
    }

    private hoverDefnClass(node: DefnClass): Hover | undefined {
        const defnCount = node.definitions.length;
        const lines = [
            `**Definition class** \`${node.name}\``,
            '',
            `${defnCount} judgement form${defnCount === 1 ? '' : 's'}:`,
            ...node.definitions.map(d => `- \`${d.name}\``),
        ];
        return this.makeHover(lines.join('\n'), node.$cstNode);
    }

    private hoverDefn(node: Defn): Hover | undefined {
        const ruleCount = node.body.filter(b => b.$type === 'RuleSeparator').length;
        const lines = [
            `**Judgement form** \`${node.name}\``,
            '',
            `${ruleCount} inference rule${ruleCount === 1 ? '' : 's'}`,
        ];
        return this.makeHover(lines.join('\n'), node.$cstNode);
    }

    private hoverStringDesc(
        leaf: CstNode,
        root: SourceFile,
    ): Hover | undefined {
        const text = leaf.text;
        const metavar = this.findMetavarByName(root, text);
        if (metavar) {
            const homs = this.formatHomomorphisms(metavar.homomorphisms);
            const lines = [`**${metavar.kind}** \`${text}\``];
            if (homs) lines.push('', '**Backends:**', homs);
            return this.makeHover(lines.join('\n'), leaf);
        }

        const rule = this.findGrammarRuleByName(root, text);
        if (rule) {
            const prodCount = rule.productions.length;
            return this.makeHover(
                `**Nonterminal** \`${text}\` — ${prodCount} production${prodCount === 1 ? '' : 's'}`,
                leaf,
            );
        }
        return undefined;
    }

    private hoverComprehension(): Hover | undefined {
        return this.makeHover(
            [
                '**Comprehension** — iterates over an indexed family',
                '',
                'Syntax: `</ body // separator // bound />`',
                '',
                '- `</ ti // i />` — iterate `ti` over index `i`',
                '- `</ ti // , // i />` — with comma separator',
                '- `</ ti // i IN 1..n />` — with explicit range',
            ].join('\n'),
        );
    }

    private hoverBindSpec(): Hover | undefined {
        return this.makeHover(
            [
                '**Bind specification** — declares variable binding structure',
                '',
                'Syntax: `(+ bind VAR in BODY +)`',
                '',
                'Tells Ott that `VAR` is bound in `BODY`, generating correct',
                'substitution and free-variable functions for proof assistants.',
            ].join('\n'),
        );
    }

    private hoverSubruleEntry(): Hover | undefined {
        return this.makeHover(
            [
                '**Subrule** — declares a subtyping relationship',
                '',
                'Syntax: `sub <:: super`',
                '',
                'Declares that the nonterminal `sub` is a syntactic',
                'subset of `super` (e.g., values are a subset of terms).',
            ].join('\n'),
        );
    }

    // ── Helpers ─────────────────────────────────────────────

    private findMetavarByName(root: SourceFile, name: string): MetavarDefn | undefined {
        for (const item of root.items) {
            if (item.$type === 'MetavarDefn' && item.names.some(n => n.name === name)) {
                return item;
            }
        }
        return undefined;
    }

    private findGrammarRuleByName(root: SourceFile, name: string): GrammarRule | undefined {
        for (const item of root.items) {
            if (item.$type === 'GrammarBlock') {
                for (const rule of (item as GrammarBlock).rules) {
                    if (rule.names.some(n => n.name === name)) return rule;
                }
            }
        }
        return undefined;
    }

    private productionElements(prod: Production): string {
        return prod.elements
            .map(el => {
                if (el.$type === 'Dots') return el.value;
                if (el.$type === 'Comprehension') return '</ ... />';
                return el.value;
            })
            .join(' ');
    }

    private formatHomomorphisms(homs: Homomorphism[]): string {
        if (homs.length === 0) return '';
        return homs
            .map(h => {
                const desc = HOM_DESCRIPTIONS[h.name.value];
                return desc
                    ? `- \`{{ ${h.name.value} }}\` — ${desc.split('—')[0].trim()}`
                    : `- \`{{ ${h.name.value} }}\``;
            })
            .join('\n');
    }

    private makeHover(content: string, cstNode?: CstNode | null): Hover {
        return {
            contents: { kind: 'markdown', value: content },
            ...(cstNode ? {
                range: {
                    start: { line: cstNode.range.start.line, character: cstNode.range.start.character },
                    end: { line: cstNode.range.end.line, character: cstNode.range.end.character },
                },
            } : {}),
        };
    }
}
