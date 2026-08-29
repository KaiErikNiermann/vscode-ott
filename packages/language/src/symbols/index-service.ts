import { DocumentState, URI, type LangiumDocument } from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import { dirname } from 'node:path';
import type { SourceFile } from '../generated/ast.js';
import { createNodeResolveHost, findManifestPath, loadManifest } from '../project/discover.js';
import { allSourceSets, resolveProject } from '../project/resolve.js';
import { collectFileSymbols, type FileSymbols } from './collect.js';
import { buildProjectSymbols, type ProjectSymbols, type Scope } from './project.js';
import { createClassifier, type Classifier } from './classify.js';

/**
 * The workspace-wide symbol index.
 *
 * Ott's grammar declares no Langium cross-references — every "reference" is a
 * bare identifier in object-language text — so the linker, `ScopeProvider` and
 * `IndexManager` have nothing to act on and this is a bespoke index rather than
 * a use of Langium's linking. What Langium *does* provide is the plumbing:
 * `.ott` discovery comes free from the generated `fileExtensions`, and the
 * server already watches the workspace, so we only have to listen.
 *
 * Two caches, both keyed the way invalidation wants them:
 *
 *  - per document, what it declares (cheap, recomputed on every parse)
 *  - per project, the assembled scoped table (rebuilt when any member changes)
 *
 * Parsing is all that is needed, so the hook is `DocumentState.Parsed` rather
 * than a later phase; and deletions are picked up from `onUpdate`, because phase
 * listeners never fire for a document that no longer exists.
 */

/** Which files resolve a given file's symbols. */
export interface ProjectScope {
    /** Cache key: the manifest path, or the directory when there is none. */
    readonly key: string;
    /** Absolute paths of every file in the project, including the file itself. */
    readonly files: readonly string[];
}

export interface SymbolLookup {
    readonly project: ProjectSymbols;
    readonly scope: Scope;
    readonly classifier: Classifier;
}

export interface ProjectSelection {
    /** Active `Ott.toml` profile, from `ott.project.profile`. */
    profile?: string;
    /** Active features, from `ott.project.features`. */
    features?: readonly string[];
}

const toPath = (uri: URI | string): string =>
    (typeof uri === 'string' ? URI.parse(uri) : uri).fsPath;

export class OttSymbolIndex {
    private readonly fileSymbols = new Map<string, FileSymbols>();
    private readonly projects = new Map<string, ProjectSymbols>();
    private selection: ProjectSelection = {};

    constructor(private readonly shared: LangiumSharedServices) {
        const builder = shared.workspace.DocumentBuilder;
        builder.onDocumentPhase(DocumentState.Parsed, document => {
            this.reindex(document as LangiumDocument<SourceFile>);
        });
        builder.onUpdate((_changed, deleted) => {
            for (const uri of deleted) {
                this.fileSymbols.delete(toPath(uri));
            }
            // A change anywhere can alter what a sibling resolves to, so the
            // assembled tables are dropped wholesale; rebuilding one is a few
            // milliseconds, and staleness here would be silent.
            this.projects.clear();
        });
    }

    /** Apply the user's profile/feature selection, invalidating what it changes. */
    setSelection(selection: ProjectSelection): void {
        this.selection = selection;
        this.projects.clear();
    }

    private reindex(document: LangiumDocument<SourceFile>): void {
        this.collect(toPath(document.uri), document);
        this.projects.clear();
    }

    /** Cache what one document declares. Returns undefined if it cannot be read. */
    private collect(path: string, document: LangiumDocument): FileSymbols | undefined {
        try {
            const symbols = collectFileSymbols(
                document.parseResult.value as SourceFile, path,
            );
            this.fileSymbols.set(path, symbols);
            return symbols;
        } catch (error) {
            console.error('[ott] symbol collection failed on a partial AST:', error);
            this.fileSymbols.delete(path);
            return undefined;
        }
    }

    /**
     * What `file` declares, collecting it now if the build-phase listener has
     * not already. The listener alone is not enough: a document parsed before
     * the build starts — which is what `getOrCreateDocument` does — is already
     * past `Parsed` when the builder runs, so its phase never fires. Pulling on
     * demand makes the index independent of that timing.
     */
    private symbolsOf(path: string): FileSymbols | undefined {
        const cached = this.fileSymbols.get(path);
        if (cached !== undefined) return cached;
        const document = this.shared.workspace.LangiumDocuments.getDocument(URI.file(path));
        return document === undefined ? undefined : this.collect(path, document);
    }

    /**
     * The files whose declarations a given file resolves against.
     *
     * With a manifest, the active profile's source list — plus, when the file is
     * not in it, the union of every source set that does contain it, so a file
     * reachable only through another profile is never left with no symbols.
     * Without a manifest, the containing directory: `ocaml_light` and `tex` are
     * real multi-file developments carrying only a Makefile, and scoping each
     * file alone leaves its rules with no grammar to resolve against.
     */
    projectScopeOf(file: string): ProjectScope {
        const manifestPath = findManifestPath(dirname(file));
        const manifest = manifestPath === undefined ? undefined : loadManifest(manifestPath);
        if (manifest === undefined || manifestPath === undefined) {
            return { key: dirname(file), files: this.ottFilesIn(dirname(file)) };
        }
        const host = createNodeResolveHost();
        const active = resolveProject(host, manifest, {
            ...(this.selection.profile ? { profile: this.selection.profile } : {}),
            ...(this.selection.features ? { features: this.selection.features } : {}),
        }).files.map(f => host.join(manifest.dir, f));

        if (active.includes(file)) {
            return { key: `${manifestPath}#${this.selection.profile ?? ''}`, files: active };
        }
        // Union fallback: every set that mentions this file.
        const union = new Set<string>([file]);
        for (const [, files] of allSourceSets(manifest)) {
            const absolute = files.map(f => host.join(manifest.dir, f));
            if (absolute.includes(file)) {
                for (const f of absolute) union.add(f);
            }
        }
        return { key: `${manifestPath}#union:${file}`, files: [...union] };
    }

    private ottFilesIn(dir: string): string[] {
        const prefix = dir.endsWith('/') ? dir : `${dir}/`;
        const files: string[] = [];
        for (const document of this.shared.workspace.LangiumDocuments.all) {
            const path = toPath(document.uri);
            if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
                files.push(path);
            }
        }
        return files.sort();
    }

    /**
     * Symbols visible to `uri`. Files the workspace has not parsed yet simply do
     * not contribute — the table sharpens as the workspace loads rather than
     * blocking on it.
     */
    lookup(uri: URI | string): SymbolLookup {
        const path = toPath(uri);
        const { key, files } = this.projectScopeOf(path);

        let project = this.projects.get(key);
        if (project === undefined) {
            const symbols: FileSymbols[] = [];
            for (const file of files) {
                const known = this.symbolsOf(file);
                if (known) symbols.push(known);
            }
            project = buildProjectSymbols(symbols);
            this.projects.set(key, project);
        }
        const scope = project.scopeOf(path);
        return {
            project, scope,
            classifier: createClassifier(scope, project.terminals, project.annotationNames),
        };
    }
}
