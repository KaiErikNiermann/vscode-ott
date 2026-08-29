import { CstUtils, type LangiumDocument } from 'langium';
import type { LangiumServices } from 'langium/lsp';
import { DefaultCompletionProvider } from 'langium/lsp';
import {
    CompletionItemKind, CompletionList, InsertTextFormat,
    type CompletionItem, type CompletionParams,
} from 'vscode-languageserver';
import type { SymbolEntry } from './symbols/project.js';
import type { OttSymbolIndex } from './symbols/index-service.js';
import { spanAt } from './symbols/spans.js';
import { SNIPPETS } from './snippets.js';
import { snippetContexts } from './snippet-context.js';

/**
 * Completion for object-language identifiers inside rules and productions.
 *
 * This is the part of the plan that was left contingent, on the theory that if
 * the index works then completion falls out of it — the same scope lookup that
 * colours a token also enumerates what may appear. Measured over the fixture
 * corpus before writing it:
 *
 *   - recall 9221/9221 (100%): every identifier an author actually wrote in a
 *     rule body is in the candidate set
 *   - candidates for a whole scope: median 51, at most 168
 *   - after one typed character: median 4, p90 25
 *
 * So the list is short enough to be useful without ranking, and ranking is not
 * where the difficulty was feared to be. What is *not* offered is production
 * shapes — completing `if ` into `if e1 then e2 else e3` — because choosing
 * between shapes is exactly the ambiguity Ott resolves with a GLR parser and
 * `parsing` priorities, and guessing there would be worse than not offering.
 *
 * Ott's own syntax still completes through Langium's grammar-driven default;
 * this only adds items where the cursor is in object-language text.
 *
 * On top of both, scaffolds for Ott's constructs (`snippets.ts`), gated on
 * where the cursor is. They are served from here rather than contributed as VS
 * Code snippets precisely so they *can* be gated: contributed snippets are
 * merged into the completion list client-side, after the server has replied.
 */

type ServicesWithIndex = LangiumServices & { symbols: { SymbolIndex: OttSymbolIndex } };

const KIND: Readonly<Record<string, CompletionItemKind>> = {
    nonterminal: CompletionItemKind.Class,
    metavar: CompletionItemKind.Variable,
    indexvar: CompletionItemKind.TypeParameter,
    judgement: CompletionItemKind.Function,
    terminal: CompletionItemKind.Keyword,
};

export class OttCompletionProvider extends DefaultCompletionProvider {
    private readonly index: OttSymbolIndex;

    constructor(services: ServicesWithIndex) {
        super(services);
        this.index = services.symbols.SymbolIndex;
    }

    override getCompletion(
        document: LangiumDocument, params: CompletionParams,
    ): Promise<CompletionList | undefined> {
        return this.completion(document, params);
    }

    private async completion(
        document: LangiumDocument, params: CompletionParams,
    ): Promise<CompletionList | undefined> {
        const base = await super.getCompletion(document, params);
        const extra: CompletionItem[] = [];
        try {
            extra.push(...this.objectLanguageItems(document, params));
            extra.push(...this.scaffolds(document, params));
        } catch (error) {
            // Never let this fail the request; the grammar-driven items below
            // are still useful on their own.
            console.error('[ott] completion failed on a partial AST:', error);
        }
        if (extra.length === 0) return base;
        return CompletionList.create([...(base?.items ?? []), ...extra], true);
    }

    /**
     * The object-language span the cursor is in or adjacent to, searching back
     * to the start of the line. Bounded so a cursor on a blank line between
     * rules does not reach into the previous one.
     */
    private spanNear(document: LangiumDocument, offset: number) {
        const root = document.parseResult.value.$cstNode;
        if (!root) return undefined;
        const text = document.textDocument.getText();
        const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
        for (let probe = offset; probe >= lineStart; probe--) {
            const leaf = CstUtils.findLeafNodeAtOffset(root, probe);
            if (!leaf) continue;
            const span = spanAt(leaf.astNode, probe);
            if (span) return span;
        }
        return undefined;
    }

    /** Scaffolds legal where the cursor is. Sorted ahead of the identifier
     *  items, since a scaffold is what someone typing `defns` is after. */
    private scaffolds(
        document: LangiumDocument, params: CompletionParams,
    ): CompletionItem[] {
        const offset = document.textDocument.offsetAt(params.position);
        const contexts = snippetContexts(document, offset);
        return SNIPPETS
            .filter(snippet => snippet.contexts.some(context => contexts.has(context)))
            .map(snippet => ({
                label: snippet.prefix,
                kind: CompletionItemKind.Snippet,
                detail: snippet.detail,
                insertText: snippet.body.join('\n'),
                insertTextFormat: InsertTextFormat.Snippet,
                sortText: `0_${snippet.prefix}`,
            }));
    }

    /** Roots and terminals visible where the cursor is, or none if it is not in
     *  object-language text. */
    private objectLanguageItems(
        document: LangiumDocument, params: CompletionParams,
    ): CompletionItem[] {
        const root = document.parseResult.value;
        if (!root.$cstNode) return [];
        const offset = document.textDocument.offsetAt(params.position);

        // Completion fires between tokens, and whitespace is hidden so it has
        // no CST leaf of its own — probing a single offset misses exactly the
        // common case of a cursor sitting after a space. Walk back to the
        // nearest token on this line instead.
        const span = this.spanNear(document, offset);
        if (!span) return [];

        const lookup = this.index.lookup(document.uri);
        const items: CompletionItem[] = [];
        for (const name of lookup.scope.roots) {
            const entry: SymbolEntry | undefined = lookup.scope.get(name);
            if (!entry) continue;
            const where = [...new Set(entry.declarations.map(d => d.uri.split('/').pop()))];
            items.push({
                label: name,
                kind: KIND[entry.kind] ?? CompletionItemKind.Text,
                detail: entry.kind,
                documentation: where.length > 0 ? `Declared in ${where.join(', ')}` : undefined,
            });
        }
        for (const terminal of lookup.project.terminals) {
            // Symbolic terminals are punctuation to type, not words to pick.
            if (!/^[A-Za-z_]/.test(terminal)) continue;
            items.push({
                label: terminal, kind: CompletionItemKind.Keyword, detail: 'terminal',
            });
        }
        return items;
    }
}
