import type { AstNode, LangiumDocument } from 'langium';
import type { DocumentSymbolProvider } from 'langium/lsp';
import { type DocumentSymbol, SymbolKind } from 'vscode-languageserver';
import { match } from 'ts-pattern';
import type {
    DefnClass, EmbedBlock, FreevarsBlock, GrammarBlock,
    Item, MetavarDefn, ParsingBlock, RuleSeparator, SourceFile,
    SubrulesBlock, SubstitutionsBlock,
} from './generated/ast.js';

export class OttDocumentSymbolProvider implements DocumentSymbolProvider {

    getSymbols(document: LangiumDocument): DocumentSymbol[] {
        const root = document.parseResult.value as SourceFile;
        return root.items.flatMap(item => this.itemToSymbol(item, document));
    }

    private itemToSymbol(item: Item, document: LangiumDocument): DocumentSymbol[] {
        return match(item)
            .with({ $type: 'MetavarDefn' }, node => [this.metavarSymbol(node, document)])
            .with({ $type: 'GrammarBlock' }, node => [this.grammarSymbol(node, document)])
            .with({ $type: 'DefnClass' }, node => [this.defnClassSymbol(node, document)])
            .with({ $type: 'EmbedBlock' }, node => [this.embedSymbol(node, document)])
            .with({ $type: 'SubrulesBlock' }, node => [this.subrulesSymbol(node, document)])
            .with({ $type: 'SubstitutionsBlock' }, node => [this.substitutionsSymbol(node, document)])
            .with({ $type: 'FreevarsBlock' }, node => [this.freevarsSymbol(node, document)])
            .with({ $type: 'ParsingBlock' }, node => [this.parsingSymbol(node, document)])
            .otherwise(() => []);
    }

    private metavarSymbol(node: MetavarDefn, document: LangiumDocument): DocumentSymbol {
        const names = node.names.map(n => n.name).join(', ');
        return this.makeSymbol(
            `${node.kind} ${names}`,
            SymbolKind.Variable,
            node, document,
        );
    }

    private grammarSymbol(node: GrammarBlock, document: LangiumDocument): DocumentSymbol {
        const children = node.rules.map(rule => {
            const ruleNames = rule.names.map(n => n.name).join(', ');
            const productions = rule.productions.map(prod =>
                this.makeSymbol(prod.name, SymbolKind.EnumMember, prod, document),
            );
            return this.makeSymbol(ruleNames, SymbolKind.Class, rule, document, productions);
        });
        return this.makeSymbol('grammar', SymbolKind.Namespace, node, document, children);
    }

    private defnClassSymbol(node: DefnClass, document: LangiumDocument): DocumentSymbol {
        const children = node.definitions.map(defn => {
            const ruleChildren = defn.body
                .filter((b): b is RuleSeparator => b.$type === 'RuleSeparator')
                .map(sep => this.makeSymbol(sep.name, SymbolKind.Event, sep, document));
            return this.makeSymbol(defn.name, SymbolKind.Function, defn, document, ruleChildren);
        });
        return this.makeSymbol(
            `defns ${node.name}`,
            SymbolKind.Module,
            node, document, children,
        );
    }

    private embedSymbol(node: EmbedBlock, document: LangiumDocument): DocumentSymbol {
        const targets = node.homomorphisms.map(h => h.name.value).join(', ');
        return this.makeSymbol(`embed {{ ${targets} }}`, SymbolKind.Object, node, document);
    }

    private subrulesSymbol(node: SubrulesBlock, document: LangiumDocument): DocumentSymbol {
        const children = node.entries.map(entry =>
            this.makeSymbol(`${entry.sub} <:: ${entry.super}`, SymbolKind.TypeParameter, entry, document),
        );
        return this.makeSymbol('subrules', SymbolKind.Namespace, node, document, children);
    }

    private substitutionsSymbol(node: SubstitutionsBlock, document: LangiumDocument): DocumentSymbol {
        const children = node.entries.map(entry =>
            this.makeSymbol(
                `${entry.kind} ${entry.nonterminal} ${entry.metavar}`,
                SymbolKind.Operator,
                entry, document,
            ),
        );
        return this.makeSymbol('substitutions', SymbolKind.Namespace, node, document, children);
    }

    private freevarsSymbol(node: FreevarsBlock, document: LangiumDocument): DocumentSymbol {
        const children = node.entries.map(entry =>
            this.makeSymbol(
                `${entry.nonterminal} ${entry.metavar}`,
                SymbolKind.Operator,
                entry, document,
            ),
        );
        return this.makeSymbol('freevars', SymbolKind.Namespace, node, document, children);
    }

    private parsingSymbol(node: ParsingBlock, document: LangiumDocument): DocumentSymbol {
        return this.makeSymbol('parsing', SymbolKind.Namespace, node, document);
    }

    private makeSymbol(
        name: string,
        kind: SymbolKind,
        node: AstNode,
        document: LangiumDocument,
        children?: DocumentSymbol[],
    ): DocumentSymbol {
        const range = node.$cstNode
            ? {
                start: document.textDocument.positionAt(node.$cstNode.offset),
                end: document.textDocument.positionAt(node.$cstNode.end),
            }
            : { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

        return {
            name,
            kind,
            range,
            selectionRange: range,
            ...(children?.length ? { children } : {}),
        };
    }
}
