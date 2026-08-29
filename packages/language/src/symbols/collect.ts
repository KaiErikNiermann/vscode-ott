import type { AstNode } from 'langium';
import type {
    Defn, GrammarRule, MetavarDefn, SourceFile, StringDesc,
} from '../generated/ast.js';

/**
 * What one `.ott` file declares.
 *
 * Collection is per file and purely syntactic: which roots a file introduces,
 * which module it belongs to, what it extends or imports. Everything that needs
 * the whole build — inferring implicit terminals, closing the subrule graph,
 * resolving module scope — happens in `project.ts`, because none of it is
 * decidable from a single file.
 *
 * Ott synthesises `formula`, `judgement` and `user_syntax` when a file does not
 * declare them, and they belong to no module (grammar_typecheck.ml:793-799), so
 * they are visible everywhere and usually have no textual definition site.
 */

export type SymbolKind = 'metavar' | 'indexvar' | 'nonterminal' | 'terminal' | 'judgement';

export interface Declaration {
    /** The root as written here; a rename may give it a different internal name. */
    readonly root: string;
    /** First root of its declaration group — its synonyms all share this. */
    readonly primary: string;
    readonly kind: SymbolKind;
    readonly uri: string;
    /** Offsets of the name itself, for a precise go-to-definition target. */
    readonly nameOffset: number;
    readonly nameEnd: number;
    /** Offsets of the whole declaration, for hover context. */
    readonly declOffset: number;
    readonly declEnd: number;
}

export interface ImportDecl {
    readonly module: string;
    /** Surface root in the imported module -> the name this file gives it. */
    readonly renamings: ReadonlyMap<string, string>;
}

export interface FileSymbols {
    readonly uri: string;
    /** The module this file declares, if any. Absent means the flat namespace. */
    readonly module?: string;
    readonly extends: readonly ImportDecl[];
    readonly imports: readonly ImportDecl[];
    readonly declarations: readonly Declaration[];
    /** Terminals written in a `terminals` rule. */
    readonly declaredTerminals: ReadonlySet<string>;
    /** Every word appearing in a production body, for terminal inference. */
    readonly productionWords: readonly string[];
    /** `sub <:: super` edges. */
    readonly subrules: ReadonlyArray<readonly [string, string]>;
    /** Production and judgement names, which `:name:` annotations refer to. */
    readonly annotationNames: readonly string[];
}

/** Ott strips the quotes of a quoted identifier (`dequote`, grammar_lexer.mll:200). */
export function dequote(name: string): string {
    return name.length >= 2 && name.startsWith("'") && name.endsWith("'")
        ? name.slice(1, -1)
        : name;
}

const offsets = (node: AstNode | undefined) => ({
    offset: node?.$cstNode?.offset ?? 0,
    end: node?.$cstNode?.end ?? 0,
});

function declarationsOf(
    names: readonly StringDesc[], kind: SymbolKind, uri: string, owner: AstNode,
): Declaration[] {
    const primary = dequote(names[0]?.name ?? '');
    const decl = offsets(owner);
    return names.map(desc => {
        const name = offsets(desc);
        return {
            root: dequote(desc.name), primary, kind, uri,
            nameOffset: name.offset, nameEnd: name.end,
            declOffset: decl.offset, declEnd: decl.end,
        };
    });
}

/**
 * The terminal a `terminals` production declares.
 *
 * Ott sees one element here, but our lexer can split it: `->` arrives as
 * ELEMENT_STRING(`-`) followed by the `>` keyword, since `>` is excluded from
 * ELEMENT_STRING's character class. Rejoining the elements' source text
 * reconstructs the spelling, and a terminal never contains whitespace so there
 * is nothing to put back between them.
 */
function terminalSpelling(elements: readonly AstNode[]): string {
    return dequote(elements.map(e => e.$cstNode?.text ?? '').join(''));
}

/** Words a production contributes, used to infer implicit terminals. */
function productionWords(rule: GrammarRule): string[] {
    const words: string[] = [];
    for (const production of rule.productions ?? []) {
        for (const element of production.elements ?? []) {
            if (element.$type === 'ProductionStringElement' && typeof element.value === 'string') {
                words.push(dequote(element.value));
            }
        }
    }
    return words;
}

/** The judgement form a `defn` header declares (`t1 --> t2`, `G |- e : T`). */
function judgementWords(defn: Defn): string[] {
    const words: string[] = [];
    for (const element of defn.elements ?? []) {
        if (element.$type === 'DefnStringElement' && typeof element.value === 'string') {
            words.push(dequote(element.value));
        }
    }
    return words;
}

function importsOf(
    decls: SourceFile['header'], type: 'ExtendsDecl' | 'ImportsDecl',
): ImportDecl[] {
    const out: ImportDecl[] = [];
    for (const decl of decls ?? []) {
        if (decl.$type !== type) continue;
        const renamings = new Map<string, string>();
        for (const r of decl.renaming?.renamings ?? []) {
            renamings.set(dequote(r.from), dequote(r.to));
        }
        out.push({ module: dequote(decl.module), renamings });
    }
    return out;
}

/**
 * Collect what `root` declares. Runs on error-recovered ASTs, where fields the
 * generated types mark as required can be undefined, so every access is guarded.
 */
/** Accumulator threaded through the per-item handlers. */
interface Collected {
    readonly declarations: Declaration[];
    readonly declaredTerminals: Set<string>;
    readonly words: string[];
    readonly subrules: Array<readonly [string, string]>;
    readonly annotationNames: string[];
}

/** `terminals` is not a keyword — it is an ordinary rule whose root happens to
 *  be `terminals`, and its productions declare spellings rather than syntax. */
function isTerminalsRule(rule: GrammarRule): boolean {
    return (rule.names ?? []).some(n => dequote(n.name) === 'terminals');
}

function collectGrammarRule(rule: GrammarRule, uri: string, into: Collected): void {
    if (isTerminalsRule(rule)) {
        for (const production of rule.productions ?? []) {
            const spelling = terminalSpelling(production.elements ?? []);
            if (spelling) into.declaredTerminals.add(spelling);
        }
        return;
    }
    into.declarations.push(...declarationsOf(rule.names ?? [], 'nonterminal', uri, rule));
    into.words.push(...productionWords(rule));
    // A production's full name composes its rule's namespace prefix with its own
    // name — rule `t :: Tm ::=` plus production `Pair` is `TmPair`, and
    // `formula :: 'formula_'` plus `xali` is `formula_xali`. Annotations are
    // written with the composed name, so record both.
    const prefix = dequote(rule.namespace?.value ?? '');
    for (const production of rule.productions ?? []) {
        if (!production.name) continue;
        const name = dequote(production.name);
        into.annotationNames.push(name);
        if (prefix) into.annotationNames.push(prefix + name);
    }
}

function collectMetavar(metavar: MetavarDefn, uri: string, into: Collected): void {
    const kind: SymbolKind = metavar.kind === 'indexvar' ? 'indexvar' : 'metavar';
    into.declarations.push(...declarationsOf(metavar.names ?? [], kind, uri, metavar));
}

function collectDefn(defn: Defn, uri: string, into: Collected): void {
    const at = offsets(defn);
    const name = dequote(defn.name ?? '');
    into.declarations.push({
        root: name, primary: name, kind: 'judgement', uri,
        nameOffset: at.offset, nameEnd: at.end, declOffset: at.offset, declEnd: at.end,
    });
    into.words.push(...judgementWords(defn));
    if (name) {
        into.annotationNames.push(name);
        const prefix = dequote(defn.namespace?.value ?? '');
        if (prefix) into.annotationNames.push(prefix + name);
    }
}

/**
 * Collect what `root` declares. Runs on error-recovered ASTs, where fields the
 * generated types mark as required can be undefined, so every access is guarded.
 */
export function collectFileSymbols(root: SourceFile, uri: string): FileSymbols {
    const into: Collected = {
        declarations: [], declaredTerminals: new Set(), words: [], subrules: [],
        annotationNames: [],
    };
    const moduleDecl = (root.header ?? []).find(h => h.$type === 'ModuleDecl');

    for (const item of root.items ?? []) {
        switch (item.$type) {
            case 'MetavarDefn':
                collectMetavar(item as MetavarDefn, uri, into);
                break;
            case 'GrammarBlock':
                for (const rule of item.rules ?? []) collectGrammarRule(rule, uri, into);
                break;
            case 'DefnClass':
                for (const defn of item.definitions ?? []) collectDefn(defn, uri, into);
                break;
            case 'SubrulesBlock':
                for (const entry of item.entries ?? []) {
                    into.subrules.push([dequote(entry.sub ?? ''), dequote(entry.super ?? '')]);
                }
                break;
            default:
                break;
        }
    }

    return {
        uri,
        ...(moduleDecl ? { module: dequote(moduleDecl.name) } : {}),
        extends: importsOf(root.header, 'ExtendsDecl'),
        imports: importsOf(root.header, 'ImportsDecl'),
        declarations: into.declarations,
        declaredTerminals: into.declaredTerminals,
        productionWords: into.words,
        subrules: into.subrules,
        annotationNames: into.annotationNames,
    };
}
