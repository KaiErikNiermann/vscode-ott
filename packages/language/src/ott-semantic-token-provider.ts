import type { AstNode } from 'langium';
import type { LangiumServices } from 'langium/lsp';
import { AbstractSemanticTokenProvider, type SemanticTokenAcceptor } from 'langium/lsp';
import { SemanticTokenTypes } from 'vscode-languageserver';
import type { Classifier, ClassifiedToken, TokenClass } from './symbols/classify.js';
import type { OttSymbolIndex } from './symbols/index-service.js';
import { spansOfNode } from './symbols/spans.js';

/**
 * Semantic highlighting for the object language inside Ott specifications.
 *
 * TextMate can colour Ott's own syntax — `grammar`, `{{ … }}`, the dashed rule
 * separator — but everything inside an inference rule belongs to the language
 * the file itself defines, and a static grammar cannot know what that is. The
 * symbol index does, so this provider re-scans those spans and emits a token per
 * classified word.
 *
 * Two things shape the implementation:
 *
 *  - It scans *spans*, not individual AST element nodes. Our lexer splits `->`
 *    into two elements (`>` is excluded from ELEMENT_STRING's character class),
 *    so emitting per element would colour it as two tokens; maximal munch over
 *    the whole span reassembles it.
 *  - It never emits inside a homomorphism body. That text is target-language
 *    code Ott does not read — only the `[[ … ]]` splices within it are object
 *    language, and those are their own AST node.
 */

/**
 * Ott's categories mapped onto the standard LSP token types, so a theme colours
 * them sensibly with no Ott-specific configuration. `contributes.semanticTokenScopes`
 * in the extension manifest gives themes without semantic rules a TextMate
 * fallback for the same set.
 */
const TOKEN_TYPE: Readonly<Record<Exclude<TokenClass, 'punctuation' | 'unknown'>, string>> = {
    // A nonterminal names a syntactic category — the closest standard analogue.
    nonterminal: SemanticTokenTypes.type,
    metavar: SemanticTokenTypes.variable,
    indexvar: SemanticTokenTypes.parameter,
    // Split below: a word-shaped terminal reads as a keyword (`if`, `then`),
    // a symbolic one as an operator (`|-`, `-->`).
    terminal: SemanticTokenTypes.operator,
    judgement: SemanticTokenTypes.function,
    annotation: SemanticTokenTypes.decorator,
};

const isWordLike = (text: string): boolean => /^[A-Za-z_]/.test(text);

export class OttSemanticTokenProvider extends AbstractSemanticTokenProvider {
    private readonly index: OttSymbolIndex;

    constructor(services: LangiumServices & { symbols: { SymbolIndex: OttSymbolIndex } }) {
        super(services);
        this.index = services.symbols.SymbolIndex;
    }

    protected override highlightElement(
        node: AstNode, acceptor: SemanticTokenAcceptor,
    ): void | undefined | 'prune' {
        // Highlighting runs on error-recovered ASTs, where fields the generated
        // types mark as required can be undefined. A throw here would fail the
        // whole request, so isolate it — the same contract the other providers
        // keep, and one provider-robustness.test.ts enforces.
        try {
            return this.highlight(node, acceptor);
        } catch (error) {
            console.error('[ott] semantic highlighting failed on a partial AST:', error);
            return undefined;
        }
    }

    private highlight(
        node: AstNode, acceptor: SemanticTokenAcceptor,
    ): void | undefined | 'prune' {
        // Verbatim target-language text with nothing Ott reads.
        if (node.$type === 'EmbedBlock') return 'prune';
        for (const span of spansOfNode(node)) {
            this.scanRange(span.offset, span.end, acceptor);
        }
        return undefined;
    }

    private classifier(): Classifier | undefined {
        const document = this.currentDocument;
        return document === undefined ? undefined : this.index.lookup(document.uri).classifier;
    }

    private scanRange(offset: number, end: number, acceptor: SemanticTokenAcceptor): void {
        const document = this.currentDocument;
        const classifier = this.classifier();
        if (document === undefined || classifier === undefined || end <= offset) return;

        const text = document.textDocument.getText().slice(offset, end);
        for (const token of classifier.scan(text, offset)) {
            const type = typeOf(token);
            if (type === undefined) continue;
            const position = document.textDocument.positionAt(token.offset);
            acceptor({
                line: position.line, char: position.character, length: token.length, type,
            });
        }
    }
}

/** The LSP token type for a classified token, or undefined to leave it alone. */
function typeOf(token: ClassifiedToken): string | undefined {
    if (token.kind === 'punctuation' || token.kind === 'unknown') {
        // Unclassified text keeps whatever TextMate gave it. Guessing here is
        // what produces a wrong colour, which is worse than no colour.
        return undefined;
    }
    if (token.kind === 'terminal') {
        return isWordLike(token.text) ? SemanticTokenTypes.keyword : SemanticTokenTypes.operator;
    }
    return TOKEN_TYPE[token.kind];
}
