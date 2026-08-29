import type { Declaration, FileSymbols, SymbolKind } from './collect.js';
import { splitRoot, type RootSet } from './suffix.js';

/**
 * Assembling per-file declarations into the scoped table a build actually sees.
 *
 * The model is `Types.file_scope` (docs/development/module-system.rst): a scope
 * maps the *surface* root a file writes to the *internal* root it means. Uses
 * are resolved in the scope of the file that wrote them — never rewritten —
 * which is why resolution is keyed on the file an identifier appears in.
 *
 * Visibility for a file that declares a module (grammar_typecheck.ml:770-799):
 *
 *   - its own module's roots, under the names its own files write
 *   - `extends N` -> N's roots under their ORIGINAL names
 *   - `imports N` -> N's roots under the name THE IMPORTER gave them
 *   - every root no module owns: files declaring no module, plus the rules Ott
 *     synthesises (`formula`, `judgement`, `user_syntax`)
 *
 * A file that declares no module sees every root under its own name — the flat
 * namespace Ott has always had, and the path that must keep behaving exactly as
 * it did before modules existed.
 */

/** Rules Ott synthesises; they belong to no module and are visible everywhere. */
export const SYNTHESISED_ROOTS: readonly string[] = ['formula', 'judgement', 'user_syntax'];

export interface SymbolEntry {
    /** The name as written in the file doing the looking. */
    readonly surface: string;
    /** The name the build settled on — what reaches generated code. */
    readonly internal: string;
    readonly kind: SymbolKind;
    /** Every site declaring it; `merge` makes several the normal case. */
    readonly declarations: readonly Declaration[];
}

export interface Scope {
    readonly roots: ReadonlySet<string>;
    readonly indexvars: ReadonlySet<string>;
    get(surfaceRoot: string): SymbolEntry | undefined;
}

export interface ProjectSymbols {
    /** The scope a file resolves its identifiers in. */
    scopeOf(uri: string): Scope;
    /** Terminals are pooled across the whole build and never scoped. */
    readonly terminals: ReadonlySet<string>;
    /** `super` -> every root usable in its position, transitively. */
    readonly subrules: ReadonlyMap<string, ReadonlySet<string>>;
    /** Every declaration in the project, for find-references and diagnostics. */
    readonly allDeclarations: readonly Declaration[];
    /** Names a `:name:` annotation may refer to (productions, judgements). */
    readonly annotationNames: ReadonlySet<string>;
}

const EMPTY_SCOPE: Scope = {
    roots: new Set(), indexvars: new Set(), get: () => undefined,
};

/** Group files by the module they declare; module-less files share the key `''`. */
function byModule(files: readonly FileSymbols[]): Map<string, FileSymbols[]> {
    const modules = new Map<string, FileSymbols[]>();
    for (const file of files) {
        const key = file.module ?? '';
        const bucket = modules.get(key);
        if (bucket) bucket.push(file); else modules.set(key, [file]);
    }
    return modules;
}

/** Transitive closure of `extends`, so a chain of extensions still sees the base. */
function reachableModules(start: string, files: readonly FileSymbols[]): Set<string> {
    const edges = new Map<string, Set<string>>();
    for (const file of files) {
        if (file.module === undefined) continue;
        const targets = edges.get(file.module) ?? new Set<string>();
        for (const e of file.extends) targets.add(e.module);
        edges.set(file.module, targets);
    }
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const next of edges.get(current) ?? []) {
            if (!seen.has(next)) {
                seen.add(next);
                stack.push(next);
            }
        }
    }
    return seen;
}

/** Merge declarations of the same surface root into one entry. */
function addEntry(
    into: Map<string, SymbolEntry>, surface: string, internal: string, declaration: Declaration,
): void {
    const existing = into.get(surface);
    if (existing) {
        into.set(surface, { ...existing, declarations: [...existing.declarations, declaration] });
    } else {
        into.set(surface, { surface, internal, kind: declaration.kind, declarations: [declaration] });
    }
}

function makeScope(entries: Map<string, SymbolEntry>): Scope {
    const indexvars = new Set<string>();
    for (const [surface, entry] of entries) {
        if (entry.kind === 'indexvar') indexvars.add(surface);
    }
    return {
        roots: new Set(entries.keys()),
        indexvars,
        get: root => entries.get(root),
    };
}

/** The scope of one file that declares a module (the non-flat case). */
function scopeForModuleFile(
    file: FileSymbols,
    files: readonly FileSymbols[],
    modules: ReadonlyMap<string, FileSymbols[]>,
    unowned: readonly Declaration[],
): Scope {
    const entries = new Map<string, SymbolEntry>();
    const own = (declarations: readonly Declaration[]) => {
        for (const d of declarations) {
            if (isRoot(d)) addEntry(entries, d.root, d.primary, d);
        }
    };

    // Own module: every file of it, under the names those files write.
    for (const sibling of modules.get(file.module as string) ?? []) own(sibling.declarations);
    // Roots no module owns are visible everywhere — without this a module's
    // defn bodies could not mention `formula`.
    own(unowned);
    // `extends N`: N's roots keep their original names, transitively.
    for (const reachable of reachableModules(file.module as string, files)) {
        for (const source of modules.get(reachable) ?? []) own(source.declarations);
    }
    // `imports N renaming a as b`: only the renamed name is visible here, and it
    // still denotes N's internal root.
    for (const imported of file.imports) {
        for (const source of modules.get(imported.module) ?? []) {
            for (const declaration of source.declarations) {
                const local = imported.renamings.get(declaration.root);
                if (local !== undefined && isRoot(declaration)) {
                    addEntry(entries, local, declaration.primary, declaration);
                }
            }
        }
    }
    return makeScope(entries);
}

/**
 * A judgement's *name* (`defn ... :: :: reduce`) is not a root: rule bodies
 * write the judgement's *form* (`t1 --> t2`), never its name. Letting one into
 * the root namespace shadows a real nonterminal that happens to share the
 * spelling — `expr` is both in ocaml_light. They stay in `allDeclarations`,
 * which is what navigation uses.
 */
const isRoot = (declaration: Declaration): boolean => declaration.kind !== 'judgement';

/** Every root in the build, under its own name — the pre-module flat namespace. */
function flatScope(files: readonly FileSymbols[]): Scope {
    const entries = new Map<string, SymbolEntry>();
    for (const file of files) {
        for (const declaration of file.declarations) {
            if (isRoot(declaration)) addEntry(entries, declaration.root, declaration.primary, declaration);
        }
    }
    return makeScope(entries);
}

/**
 * Terminals, pooled across the whole build and never scoped
 * (`Auxl.terminals_of_syntaxdefn`). A production word resolving to no visible
 * root is an implicit terminal — Ott's own rule, and why a `terminals` block
 * only has to list the ones needing LaTeX.
 */
function poolTerminals(
    files: readonly FileSymbols[], scopeOf: (uri: string) => Scope,
): Set<string> {
    const terminals = new Set<string>();
    for (const file of files) {
        for (const t of file.declaredTerminals) terminals.add(t);
    }
    for (const file of files) {
        const scope = scopeOf(file.uri);
        const set: RootSet = { roots: scope.roots, indexvars: scope.indexvars };
        for (const word of file.productionWords) {
            if (/^[A-Za-z_]/.test(word) && splitRoot(word, set).length === 0) terminals.add(word);
        }
    }
    return terminals;
}

/** `v <:: t` makes `v` usable wherever `t` is, and chains (basic-concepts.rst). */
function closeSubrules(files: readonly FileSymbols[]): Map<string, ReadonlySet<string>> {
    const direct = new Map<string, Set<string>>();
    for (const file of files) {
        for (const [sub, sup] of file.subrules) {
            const subs = direct.get(sup) ?? new Set<string>();
            subs.add(sub);
            direct.set(sup, subs);
        }
    }
    const closed = new Map<string, ReadonlySet<string>>();
    for (const sup of direct.keys()) {
        const all = new Set<string>();
        const stack = [...(direct.get(sup) ?? [])];
        while (stack.length > 0) {
            const sub = stack.pop() as string;
            if (all.has(sub)) continue;
            all.add(sub);
            stack.push(...(direct.get(sub) ?? []));
        }
        closed.set(sup, all);
    }
    return closed;
}

/**
 * Build the project-wide symbol table from the files of one resolved source
 * list. `files` must be in build order, though only diagnostics depend on it.
 */
export function buildProjectSymbols(files: readonly FileSymbols[]): ProjectSymbols {
    const modules = byModule(files);
    const anyModuleDeclared = files.some(f => f.module !== undefined);
    const unowned = (modules.get('') ?? []).flatMap(f => [...f.declarations]);

    const scopes = new Map<string, Scope>();
    // Without any module declaration anywhere, the whole build is one flat
    // scope, exactly as before modules existed.
    const flat = anyModuleDeclared ? undefined : flatScope(files);
    for (const file of files) {
        scopes.set(file.uri, file.module === undefined
            ? (flat ?? flatScope(files))
            : scopeForModuleFile(file, files, modules, unowned));
    }
    const scopeOf = (uri: string) => scopes.get(uri) ?? EMPTY_SCOPE;

    const terminals = poolTerminals(files, scopeOf);
    const subrules = closeSubrules(files);

    return {
        scopeOf,
        terminals,
        subrules,
        allDeclarations: files.flatMap(f => [...f.declarations]),
        annotationNames: new Set([
            ...files.flatMap(f => [...f.annotationNames]),
            // Fixed annotations documented in top2.mng §a17.
            'concrete', 'deeper',
        ]),
    };
}
