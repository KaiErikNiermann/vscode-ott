import { type Module, inject } from 'langium';
import {
    createDefaultModule, createDefaultSharedModule,
    type DefaultSharedModuleContext, type LangiumServices,
    type LangiumSharedServices, type PartialLangiumServices,
} from 'langium/lsp';
import { OttGeneratedModule, OttGeneratedSharedModule } from './generated/module.js';
import { OttValidator, registerValidationChecks } from './ott-validator.js';
import { OttDocumentSymbolProvider } from './ott-document-symbol-provider.js';
import { OttHoverProvider } from './ott-hover-provider.js';

/**
 * Declaration of custom services - add your own service classes here.
 */
export type OttAddedServices = {
    validation: {
        OttValidator: OttValidator
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
    lsp: {
        DocumentSymbolProvider: () => new OttDocumentSymbolProvider(),
        HoverProvider: () => new OttHoverProvider(),
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
    if (!context.connection) {
        shared.workspace.ConfigurationProvider.initialized({});
    }
    return { shared, Ott };
}
