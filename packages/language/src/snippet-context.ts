import { CstUtils } from 'langium';
import type { AstNode, LangiumDocument } from 'langium';
import type { Defn, Fundefn } from './generated/ast.js';
import { headerEnd } from './ott-header.js';
import type { SnippetContext } from './snippets.js';
import { defnBodyStart } from './symbols/spans.js';

/**
 * Which scaffolds belong where the cursor is.
 *
 * The gate that does most of the work is the line start. Ott's lexer decides
 * whether a word is an item keyword by taking the first word of a *line*
 * (`grammar_lexer.mll:436-460`), so `metavar` mid-line is just a name — which
 * is why the top-level scaffolds are only offered at the start of one. That is
 * also what resolves the one genuinely ambiguous position: at the end of a defn
 * body, both the next inference rule and the next top-level item are legal
 * continuations, and Ott decides between them by exactly this rule.
 *
 * Everything else is the enclosing block, read off the AST.
 */

/** Whitespace, then at most the identifier the user is part-way through typing. */
const LINE_START = /^[ \t]*[\w']*$/;

export function snippetContexts(
    document: LangiumDocument, offset: number,
): ReadonlySet<SnippetContext> {
    const contexts = new Set<SnippetContext>();
    const text = document.textDocument.getText();

    // Homomorphisms and bind specs are bracket-led and attach mid-line, so they
    // are not subject to the line-start gate below.
    contexts.add('hom');

    // `<=` rather than `<`: at the offset where the header ends, typing `module`
    // is still what would make it a header.
    if (offset <= headerEnd(text)) contexts.add('header');

    const lineStart = text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1;
    if (!LINE_START.test(text.slice(lineStart, offset))) return contexts;
    contexts.add('item');

    const root = document.parseResult.value.$cstNode;
    if (!root) return contexts;
    // On a blank line between rules there is no leaf at the offset at all, since
    // whitespace is hidden; the preceding token is what says which block we are
    // still inside.
    const leaf = CstUtils.findLeafNodeAtOffset(root, offset)
        ?? CstUtils.findLeafNodeBeforeOffset(root, offset);
    if (!leaf) return contexts;

    for (let node: AstNode | undefined = leaf.astNode; node; node = node.$container) {
        switch (node.$type) {
            case 'GrammarBlock': { contexts.add('grammar'); break; }
            case 'DefnClass': { contexts.add('defns'); break; }
            case 'FunsBlock': { contexts.add('funs'); break; }
            case 'Defn':
            case 'Fundefn': {
                const start = defnBodyStart(node as Defn | Fundefn);
                if (start !== undefined && offset > start) contexts.add('defn-body');
                break;
            }
            default: break;
        }
    }
    return contexts;
}
