import type { Dependency, Manifest, ManifestProblem } from './manifest.js';

/**
 * Resolving a manifest to the ordered source list Ott would be invoked with.
 *
 * Order is semantic, not cosmetic: Ott requires a definition to precede its
 * uses, so this mirrors `cmd_build` (project.ml:563-568) exactly —
 *
 *     [spec] files
 *       -> profile        (REPLACES the file list, does not extend it)
 *       -> features       (APPENDED, in the order named)
 *       -> dependencies   (PREPENDED, post-order deepest-first)
 *       -> dedup, keeping the FIRST occurrence
 *
 * The asymmetries below are the ones worth knowing, all verified in project.ml:
 *
 *  - A profile's `flags` REPLACE `[spec]`'s rather than merging with them
 *    (project.ml:225), so a profile that sets `merge` silently drops the
 *    package's `strict_merge` and `extends`.
 *  - Only a dependency's `[spec] files` cross the boundary. Its profiles,
 *    features, flags and targets are never applied.
 *  - Cycles are detected by dependency *name*, not by resolved path.
 *  - `Ott.lock` is written by ott but never read back, so nothing here consults
 *    it.
 */

/** How a dependency directory is located, so the resolver stays filesystem-free. */
export interface ResolveHost {
    /** Join and normalise, as `Filename.concat` + `tidy_path` do. */
    join(...parts: string[]): string;
    /** Load the manifest in `dir`, or undefined when there is none. */
    readManifest(dir: string): Manifest | undefined;
    /** Absolute-path test, for a dependency `path` that is already absolute. */
    isAbsolute(path: string): boolean;
}

export interface ResolveOptions {
    /** Name of the profile to apply; absent means the default `[spec]` list. */
    readonly profile?: string;
    /** Feature names to append, in order. */
    readonly features?: readonly string[];
}

export interface ResolvedProject {
    /** The ordered, deduplicated source list, relative to the manifest dir. */
    readonly files: readonly string[];
    readonly problems: readonly ManifestProblem[];
}

/** Keep the first occurrence of each entry (project.ml:442-444). */
function dedup(paths: readonly string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of paths) {
        if (!seen.has(p)) {
            seen.add(p);
            out.push(p);
        }
    }
    return out;
}

function dependencyDir(host: ResolveHost, manifest: Manifest, dep: Dependency): string | undefined {
    if (dep.kind === 'path') {
        return host.isAbsolute(dep.path) ? dep.path : host.join(manifest.dir, dep.path);
    }
    // Upstream clones into `.ott/deps/<name>` on demand. A language server must
    // not do network I/O, so we only read a checkout that is already there; an
    // absent one contributes no files and is reported.
    return host.join(manifest.dir, '.ott', 'deps', dep.name);
}

/**
 * Files contributed by `manifest`'s dependencies, post-order and deepest-first:
 * for each dependency, its own transitive dependencies' files, then its
 * `[spec] files` prefixed with its directory.
 */
function dependencyFiles(
    host: ResolveHost,
    manifest: Manifest,
    seen: readonly string[],
    problems: ManifestProblem[],
): string[] {
    const out: string[] = [];
    for (const dep of manifest.dependencies) {
        if (seen.includes(dep.name)) {
            problems.push({
                key: `dependencies.${dep.name}`,
                message: `dependency cycle through ${dep.name} (${[...seen, dep.name].join(' -> ')})`,
            });
            continue;
        }
        const dir = dependencyDir(host, manifest, dep);
        const depManifest = dir === undefined ? undefined : host.readManifest(dir);
        if (depManifest === undefined) {
            problems.push({
                key: `dependencies.${dep.name}`,
                message: dep.kind === 'git'
                    ? `dependency ${dep.name} is not fetched — run \`ott build\` once to clone it into .ott/deps/${dep.name}`
                    : `dependency ${dep.name}: no Ott.toml in ${dir ?? dep.path}`,
            });
            continue;
        }
        out.push(
            ...dependencyFiles(host, depManifest, [...seen, dep.name], problems),
            ...depManifest.spec.files.map(f => host.join(depManifest.dir, f)),
        );
    }
    return out;
}

/** Resolve a manifest to the ordered source list `ott build` would use. */
export function resolveProject(
    host: ResolveHost,
    manifest: Manifest,
    options: ResolveOptions = {},
): ResolvedProject {
    const problems: ManifestProblem[] = [...manifest.problems];

    // 1. `[spec] files`, or the profile's replacement for them.
    let files: readonly string[] = manifest.spec.files;
    if (options.profile !== undefined) {
        const profile = manifest.profiles.find(p => p.name === options.profile);
        if (profile === undefined) {
            const available = manifest.profiles.map(p => p.name).join(', ');
            const hint = available ? ` — available: ${available}` : '';
            problems.push({
                key: 'profile',
                message: `unknown profile "${options.profile}"${hint}`,
            });
        } else if (profile.files !== undefined) {
            files = profile.files;
        }
    }

    // 2. Feature files appended in the order named, then deduped across the lot.
    const featureFiles: string[] = [];
    for (const feature of options.features ?? []) {
        const declared = manifest.features.get(feature);
        if (declared === undefined) {
            const available = [...manifest.features.keys()].join(', ');
            const hint = available ? ` — available: ${available}` : '';
            problems.push({ key: 'features', message: `unknown feature "${feature}"${hint}` });
            continue;
        }
        featureFiles.push(...declared);
    }
    const own = dedup([...files, ...featureFiles]);

    // 3. Dependency files come first, so a definition precedes its uses.
    const fromDeps = manifest.dependencies.length === 0
        ? []
        : dependencyFiles(host, manifest, [], problems);

    return { files: dedup([...fromDeps, ...own]), problems };
}

/** Every source set a manifest can produce: the default plus each profile. */
export function allSourceSets(manifest: Manifest): ReadonlyMap<string, readonly string[]> {
    const sets = new Map<string, readonly string[]>();
    sets.set('', manifest.spec.files);
    for (const profile of manifest.profiles) {
        sets.set(profile.name, profile.files ?? manifest.spec.files);
    }
    return sets;
}
