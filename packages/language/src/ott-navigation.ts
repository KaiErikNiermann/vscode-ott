import { AstUtils, URI, type LangiumDocument, type MaybePromise } from 'langium';
import type { DefinitionProvider, ReferencesProvider } from 'langium/lsp';
import type { LangiumServices } from 'langium/lsp';
import { Location, LocationLink, Range, type DefinitionParams, type ReferenceParams } from 'vscode-languageserver';
import type { Declaration } from './symbols/collect.js';
import type { OttSymbolIndex } from './symbols/index-service.js';
import { locateSymbol } from './symbols/locate.js';
import { spansOfNode } from './symbols/spans.js';

/**
 * Go-to-definition and find-references for object-language identifiers.
 *
 * Both reduce to the same question the highlighter already answers — which
 * token is at this offset and what does it denote — so both go through
 * `locateSymbol` rather than re-deriving it.
 *
 * Several definitions is the normal case, not an error: `merge` is how a
 * language is split into features, so nineteen tapl fragments all add
 * productions to `t`, and l2 and l1 both declare `e`. LSP renders the list.
 */

type ServicesWithIndex = LangiumServices & { symbols: { SymbolIndex: OttSymbolIndex } };

/** A declaration's name range, in the document that declares it. */
function declarationRange(
    services: LangiumServices, declaration: Declaration,
): { uri: URI; name: Range; full: Range } | undefined {
    const uri = URI.file(declaration.uri);
    const document = services.shared.workspace.LangiumDocuments.getDocument(uri);
    if (!document) return undefined;
    const at = (offset: number) => document.textDocument.positionAt(offset);
    return {
        uri,
        name: Range.create(at(declaration.nameOffset), at(declaration.nameEnd)),
        full: Range.create(at(declaration.declOffset), at(declaration.declEnd)),
    };
}

export class OttDefinitionProvider implements DefinitionProvider {
    constructor(private readonly services: ServicesWithIndex) {}

    getDefinition(
        document: LangiumDocument, params: DefinitionParams,
    ): MaybePromise<LocationLink[] | undefined> {
        try {
            return this.definitions(document, params);
        } catch (error) {
            console.error('[ott] go-to-definition failed on a partial AST:', error);
            return undefined;
        }
    }

    private definitions(
        document: LangiumDocument, params: DefinitionParams,
    ): LocationLink[] | undefined {
        const offset = document.textDocument.offsetAt(params.position);
        const lookup = this.services.symbols.SymbolIndex.lookup(document.uri);
        const located = locateSymbol(document, offset, lookup);
        if (!located?.entry) return undefined;

        const source = Range.create(
            document.textDocument.positionAt(located.token.offset),
            document.textDocument.positionAt(located.token.offset + located.token.length),
        );
        const links: LocationLink[] = [];
        for (const declaration of located.entry.declarations) {
            const range = declarationRange(this.services, declaration);
            if (!range) continue;
            links.push(LocationLink.create(
                range.uri.toString(), range.full, range.name, source,
            ));
        }
        return links.length > 0 ? links : undefined;
    }
}

export class OttReferencesProvider implements ReferencesProvider {
    constructor(private readonly services: ServicesWithIndex) {}

    findReferences(
        document: LangiumDocument, params: ReferenceParams,
    ): MaybePromise<Location[]> {
        try {
            return this.references(document, params);
        } catch (error) {
            console.error('[ott] find-references failed on a partial AST:', error);
            return [];
        }
    }

    private references(document: LangiumDocument, params: ReferenceParams): Location[] {
        const offset = document.textDocument.offsetAt(params.position);
        const index = this.services.symbols.SymbolIndex;
        const lookup = index.lookup(document.uri);
        const located = locateSymbol(document, offset, lookup);
        const root = located?.token.root;
        if (root === undefined || !located?.entry) return [];

        const locations: Location[] = [];
        if (params.context?.includeDeclaration) {
            for (const declaration of located.entry.declarations) {
                const range = declarationRange(this.services, declaration);
                if (range) locations.push(Location.create(range.uri.toString(), range.name));
            }
        }

        // Uses are found by re-scanning each project file's object-language
        // spans. There is no reference index to consult: the grammar has no
        // cross-references, so a use is only a use once classified.
        for (const file of index.projectScopeOf(document.uri.fsPath).files) {
            const uri = URI.file(file);
            const other = this.services.shared.workspace.LangiumDocuments.getDocument(uri);
            if (!other) continue;
            const fileLookup = index.lookup(uri);
            const text = other.textDocument.getText();
            for (const span of documentSpans(other)) {
                for (const token of fileLookup.classifier.scan(
                    text.slice(span.offset, span.end), span.offset,
                )) {
                    if (token.root !== root) continue;
                    locations.push(Location.create(uri.toString(), Range.create(
                        other.textDocument.positionAt(token.offset),
                        other.textDocument.positionAt(token.offset + token.length),
                    )));
                }
            }
        }
        return locations;
    }
}

/** Every object-language span in a document. */
function documentSpans(document: LangiumDocument): Array<{ offset: number; end: number }> {
    const spans: Array<{ offset: number; end: number }> = [];
    for (const node of AstUtils.streamAst(document.parseResult.value)) {
        spans.push(...spansOfNode(node));
    }
    return spans;
}
