import { type Module, inject } from 'langium';
import {
    createDefaultModule, createDefaultSharedModule,
    type DefaultSharedModuleContext, type LangiumServices,
    type LangiumSharedServices, type PartialLangiumServices,
} from 'langium/lsp';
import { OttGeneratedModule, OttGeneratedSharedModule } from './generated/module.js';
import { OttValidator, registerValidationChecks } from './ott-validator.js';
import { OttDocumentSymbolProvider } from './ott-document-symbol-provider.js';
import { OttFormatter } from './ott-formatter.js';
import { OttHoverProvider } from './ott-hover-provider.js';
import { OttTokenBuilder } from './ott-token-builder.js';
import { OttSymbolIndex } from './symbols/index-service.js';
import { OttSemanticTokenProvider } from './ott-semantic-token-provider.js';

/**
 * Declaration of custom services - add your own service classes here.
 */
export type OttAddedServices = {
    validation: {
        OttValidator: OttValidator
    },
    /**
     * Cross-file symbol table. It lives in the language module rather than the
     * shared one because there is exactly one language here, and it reaches
     * `services.shared` for the document plumbing it listens to.
     */
    symbols: {
        SymbolIndex: OttSymbolIndex
    }
}

/**
 * Union of Langium default services and your custom services - use this as constructor parameter
 * of custom service classes.
 */
export type OttServices = LangiumServices & OttAddedServices

/**
 * Dependency injection module that overrides Langium default services and contributes the
 * declared custom services. The Langium defaults can be partially specified to override only
 * selected services, while the custom services must be fully specified.
 */
export const OttModule: Module<OttServices, PartialLangiumServices & OttAddedServices> = {
    validation: {
        OttValidator: () => new OttValidator(),
    },
    symbols: {
        SymbolIndex: services => new OttSymbolIndex(services.shared),
    },
    parser: {
        TokenBuilder: () => new OttTokenBuilder(),
    },
    lsp: {
        DocumentSymbolProvider: () => new OttDocumentSymbolProvider(),
        Formatter: () => new OttFormatter(),
        HoverProvider: () => new OttHoverProvider(),
        SemanticTokenProvider: services => new OttSemanticTokenProvider(services),
    },
};

/**
 * Create the full set of services required by Langium.
 */
export function createOttServices(context: DefaultSharedModuleContext): {
    shared: LangiumSharedServices,
    Ott: OttServices
} {
    const shared = inject(
        createDefaultSharedModule(context),
        OttGeneratedSharedModule,
    );
    const Ott = inject(
        createDefaultModule({ shared }),
        OttGeneratedModule,
        OttModule,
    );
    shared.ServiceRegistry.register(Ott);
    registerValidationChecks(Ott);
    // Langium instantiates services lazily, but the symbol index has to be alive
    // before the first document is built — it registers its document-build
    // listeners in its constructor, and a listener added after the workspace has
    // loaded would miss every file already parsed.
    void Ott.symbols.SymbolIndex;
    if (!context.connection) {
        shared.workspace.ConfigurationProvider.initialized({});
    }
    return { shared, Ott };
}
