import { CstUtils, type LangiumDocument } from 'langium';
import type { ClassifiedToken } from './classify.js';
import type { Declaration } from './collect.js';
import type { SymbolEntry } from './project.js';
import type { SymbolLookup } from './index-service.js';
import { spanAt } from './spans.js';

/**
 * What the cursor is on.
 *
 * Hover, go-to-definition and find-references all reduce to the same question —
 * which object-language token is at this offset, and what does it denote — so
 * they share this rather than each re-deriving it and drifting apart.
 */

export interface LocatedSymbol {
    readonly token: ClassifiedToken;
    /** The declared symbol it denotes, absent for a terminal or unknown word. */
    readonly entry?: SymbolEntry;
}

/**
 * The object-language token at `offset`, or undefined if the offset is not in
 * object-language text — Ott's own syntax, a hom body, an embed block.
 */
export function locateSymbol(
    document: LangiumDocument, offset: number, lookup: SymbolLookup,
): LocatedSymbol | undefined {
    const leaf = CstUtils.findLeafNodeAtOffset(document.parseResult.value.$cstNode!, offset);
    if (!leaf) return undefined;

    const span = spanAt(leaf.astNode, offset);
    if (!span) return undefined;

    const text = document.textDocument.getText().slice(span.offset, span.end);
    for (const token of lookup.classifier.scan(text, span.offset)) {
        if (offset < token.offset || offset >= token.offset + token.length) continue;
        const entry = token.root === undefined ? undefined : lookup.scope.get(token.root);
        return entry === undefined ? { token } : { token, entry };
    }
    return undefined;
}

/** Every declaration site of the symbol at `offset`. */
export function declarationsAt(
    document: LangiumDocument, offset: number, lookup: SymbolLookup,
): readonly Declaration[] {
    return locateSymbol(document, offset, lookup)?.entry?.declarations ?? [];
}
