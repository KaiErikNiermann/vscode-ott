import type { ValidationAcceptor, ValidationChecks } from 'langium';
import type {
    OttAstType, RuleSeparator, SourceFile, MetavarDefn,
    GrammarBlock, GrammarRule, SubruleEntry, SubstitutionEntry,
    FreevarEntry, ParsingDirective,
} from './generated/ast.js';
import type { OttServices } from './ott-module.js';

export function registerValidationChecks(services: OttServices) {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.OttValidator;
    const checks: ValidationChecks<OttAstType> = {
        RuleSeparator: validator.checkRuleSeparatorHasName,
        SourceFile: validator.checkSourceFile,
        SubruleEntry: validator.checkSubruleEntry,
        SubstitutionEntry: validator.checkSubstitutionEntry,
        FreevarEntry: validator.checkFreevarEntry,
        ParsingDirective: validator.checkParsingDirective,
    };
    registry.register(checks, validator);
}

/** Collect all declared metavar names from the source file. */
function collectMetavarNames(root: SourceFile): Set<string> {
    const names = new Set<string>();
    for (const item of root.items) {
        if (item.$type === 'MetavarDefn') {
            for (const desc of (item as MetavarDefn).names) {
                names.add(desc.name);
            }
        }
    }
    return names;
}

/** Collect all declared nonterminal names from grammar blocks. */
function collectNonterminalNames(root: SourceFile): Set<string> {
    const names = new Set<string>();
    for (const item of root.items) {
        if (item.$type === 'GrammarBlock') {
            for (const rule of (item as GrammarBlock).rules) {
                for (const desc of rule.names) {
                    names.add(desc.name);
                }
            }
        }
    }
    return names;
}

export class OttValidator {

    checkRuleSeparatorHasName(sep: RuleSeparator, accept: ValidationAcceptor): void {
        if (!sep.name) {
            accept('warning', 'Rule separator should have a name.', { node: sep, property: 'name' });
        }
    }

    checkSourceFile(root: SourceFile, accept: ValidationAcceptor): void {
        this.checkDuplicateMetavarNames(root, accept);
        this.checkDuplicateNonterminalNames(root, accept);
    }

    checkSubruleEntry(entry: SubruleEntry, accept: ValidationAcceptor): void {
        const root = this.findRoot(entry);
        if (!root) return;

        const nonterminals = collectNonterminalNames(root);
        if (!nonterminals.has(entry.sub)) {
            accept('warning', `Nonterminal '${entry.sub}' is not defined in any grammar block.`, {
                node: entry, property: 'sub',
            });
        }
        if (!nonterminals.has(entry.super)) {
            accept('warning', `Nonterminal '${entry.super}' is not defined in any grammar block.`, {
                node: entry, property: 'super',
            });
        }
    }

    checkSubstitutionEntry(entry: SubstitutionEntry, accept: ValidationAcceptor): void {
        this.checkNonterminalAndMetavar(entry, accept);
    }

    checkFreevarEntry(entry: FreevarEntry, accept: ValidationAcceptor): void {
        this.checkNonterminalAndMetavar(entry, accept);
    }

    /** Shared check for entries that reference a nonterminal and metavar. */
    private checkNonterminalAndMetavar(
        entry: SubstitutionEntry | FreevarEntry,
        accept: ValidationAcceptor,
    ): void {
        const root = this.findRoot(entry);
        if (!root) return;

        const nonterminals = collectNonterminalNames(root);
        const metavars = collectMetavarNames(root);

        if (!nonterminals.has(entry.nonterminal)) {
            accept('warning', `Nonterminal '${entry.nonterminal}' is not defined in any grammar block.`, {
                node: entry, property: 'nonterminal',
            });
        }
        if (!metavars.has(entry.metavar)) {
            accept('warning', `Metavariable '${entry.metavar}' is not declared.`, {
                node: entry, property: 'metavar',
            });
        }
    }

    checkParsingDirective(directive: ParsingDirective, accept: ValidationAcceptor): void {
        const root = this.findRoot(directive);
        if (!root) return;

        const nonterminals = collectNonterminalNames(root);
        if (!nonterminals.has(directive.nonterminal)) {
            accept('warning', `Nonterminal '${directive.nonterminal}' is not defined in any grammar block.`, {
                node: directive, property: 'nonterminal',
            });
        }
    }

    private checkDuplicateMetavarNames(root: SourceFile, accept: ValidationAcceptor): void {
        const seen = new Map<string, MetavarDefn>();
        for (const item of root.items) {
            if (item.$type !== 'MetavarDefn') continue;
            const defn = item as MetavarDefn;
            for (const desc of defn.names) {
                const existing = seen.get(desc.name);
                if (existing) {
                    accept('warning', `Metavariable '${desc.name}' is already declared.`, {
                        node: desc, property: 'name',
                    });
                } else {
                    seen.set(desc.name, defn);
                }
            }
        }
    }

    private checkDuplicateNonterminalNames(root: SourceFile, accept: ValidationAcceptor): void {
        const seen = new Map<string, GrammarRule>();
        for (const item of root.items) {
            if (item.$type !== 'GrammarBlock') continue;
            for (const rule of (item as GrammarBlock).rules) {
                for (const desc of rule.names) {
                    const existing = seen.get(desc.name);
                    if (existing) {
                        accept('info', `Nonterminal '${desc.name}' defined in multiple grammar blocks (rules accumulate).`, {
                            node: desc, property: 'name',
                        });
                    } else {
                        seen.set(desc.name, rule);
                    }
                }
            }
        }
    }

    private findRoot(node: { $container?: { $container?: unknown } }): SourceFile | undefined {
        let current: unknown = node;
        while (current && typeof current === 'object' && '$container' in current) {
            current = (current as { $container: unknown }).$container;
        }
        if (current && typeof current === 'object' && '$type' in current
            && (current as { $type: string }).$type === 'SourceFile') {
            return current as SourceFile;
        }
        return undefined;
    }
}
