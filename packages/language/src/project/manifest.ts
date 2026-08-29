import { parse as parseToml } from 'smol-toml';

/**
 * The `Ott.toml` project manifest.
 *
 * Modelled on upstream's `src/project.ml`, which is the only implementation —
 * there is no schema document. Two deliberate differences:
 *
 *  - Upstream `die`s on the first problem. A language server must not, so every
 *    problem is collected into `problems` and the manifest is returned as far as
 *    it could be understood. A file list that is merely incomplete still gives
 *    better highlighting than none.
 *  - Upstream resolves git dependencies by cloning. We never do network I/O
 *    (see `resolve.ts`); an unfetched dependency simply contributes no files.
 */

/** Backends and the output extension each one is selected by (project.ml:57-60). */
export const BACKEND_EXTENSIONS: ReadonlyMap<string, string> = new Map([
    ['tex', 'tex'], ['coq', 'v'], ['isa', 'thy'], ['hol', 'Script.sml'], ['lem', 'lem'],
    ['twf', 'twf'], ['ocaml', 'ml'], ['lean', 'lean'], ['lex', 'mll'], ['menhir', 'mly'],
]);

export interface ManifestProblem {
    readonly message: string;
    /** Dotted path of the offending key, e.g. `target.coq.out`. */
    readonly key: string;
}

export interface TargetSection {
    readonly backend: string;
    readonly out: string;
    readonly filters: ReadonlyArray<{ readonly src: string; readonly dst: string }>;
    /** Raw `flags`, appended verbatim after the derived ones. */
    readonly flags: readonly string[];
    /** Any other key: `k = v` becomes `-<backend>_<k> <v>`. */
    readonly options: Readonly<Record<string, string>>;
}

export interface SpecSection {
    readonly files: readonly string[];
    readonly merge?: boolean;
    readonly strictMerge?: boolean;
    readonly extends: readonly string[];
    readonly flags: readonly string[];
}

export interface ProfileSection {
    readonly name: string;
    /** Absent means "use `[spec] files`". */
    readonly files?: readonly string[];
    readonly merge?: boolean;
    readonly flags?: readonly string[];
    /** Empty means "use the package's targets". */
    readonly targets: readonly TargetSection[];
}

export type Dependency =
    | { readonly name: string; readonly kind: 'path'; readonly path: string }
    | { readonly name: string; readonly kind: 'git'; readonly git: string; readonly ref?: string };

export interface Manifest {
    /** Directory holding this `Ott.toml`; every relative path is against it. */
    readonly dir: string;
    readonly name: string;
    readonly spec: SpecSection;
    readonly targets: readonly TargetSection[];
    readonly profiles: readonly ProfileSection[];
    readonly features: ReadonlyMap<string, readonly string[]>;
    readonly dependencies: readonly Dependency[];
    readonly problems: readonly ManifestProblem[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

/** `string_of_toml` (project.ml:78-88): arrays become comma-joined strings. */
function scalarToString(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) {
        const parts = value.map(scalarToString);
        return parts.every(p => p !== undefined) ? parts.join(',') : undefined;
    }
    return undefined;
}

function stringArray(
    value: unknown, key: string, problems: ManifestProblem[],
): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some(v => typeof v !== 'string')) {
        problems.push({ key, message: `${key} must be an array of strings` });
        return undefined;
    }
    // The docs' profile example writes `files = ["common.ott", "...", ...]`,
    // where the ellipsis is prose that landed inside a quoted string. Nothing in
    // project.ml special-cases it, so ott would try to open a file called `...`.
    const files = value as string[];
    for (const f of files) {
        if (f === '...') {
            problems.push({ key, message: `"..." is not a file name — the documentation example elides entries here, it is not a wildcard` });
        }
    }
    return files;
}

function readTarget(
    backend: string, raw: unknown, problems: ManifestProblem[],
): TargetSection | undefined {
    if (!isRecord(raw)) {
        problems.push({ key: `target.${backend}`, message: `[target.${backend}] must be a table` });
        return undefined;
    }
    const extension = BACKEND_EXTENSIONS.get(backend);
    if (extension === undefined) {
        problems.push({
            key: `target.${backend}`,
            message: `unknown backend "${backend}" — expected one of ${[...BACKEND_EXTENSIONS.keys()].join(', ')}`,
        });
        return undefined;
    }
    const out = raw.out;
    if (typeof out !== 'string') {
        problems.push({ key: `target.${backend}.out`, message: `[target.${backend}] needs an out` });
        return undefined;
    }
    // Ott picks the backend from the output extension, so a mismatch would
    // silently run a different one (project.ml:122).
    if (!out.endsWith(`.${extension}`) && !out.endsWith(extension)) {
        problems.push({
            key: `target.${backend}.out`,
            message: `out "${out}" must end with .${extension} for the ${backend} backend`,
        });
    }

    const { options, flags } = readTargetOptions(backend, raw, problems);
    return { backend, out, filters: readFilters(backend, raw.filter, problems), flags, options };
}

/** `filter = [{ src, dst }]` — the `-<backend>_filter` pairs. */
function readFilters(
    backend: string, raw: unknown, problems: ManifestProblem[],
): Array<{ src: string; dst: string }> {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
        problems.push({ key: `target.${backend}.filter`, message: 'filter must be an array' });
        return [];
    }
    const filters: Array<{ src: string; dst: string }> = [];
    for (const entry of raw) {
        if (isRecord(entry) && typeof entry.src === 'string' && typeof entry.dst === 'string') {
            filters.push({ src: entry.src, dst: entry.dst });
        } else {
            problems.push({ key: `target.${backend}.filter`, message: 'each filter needs a src and a dst' });
        }
    }
    return filters;
}

/**
 * Everything in a `[target.<backend>]` table other than `out` and `filter`:
 * `flags` is verbatim, and any other `k = v` becomes `-<backend>_<k> <v>`.
 */
function readTargetOptions(
    backend: string, raw: Record<string, unknown>, problems: ManifestProblem[],
): { options: Record<string, string>; flags: string[] } {
    let flags: string[] = [];
    const entries: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(raw)) {
        if (key === 'out' || key === 'filter') continue;
        if (key === 'flags') {
            flags = stringArray(value, `target.${backend}.flags`, problems) ?? [];
            continue;
        }
        const text = scalarToString(value);
        if (text === undefined) {
            problems.push({ key: `target.${backend}.${key}`, message: `cannot use ${key} as a flag value` });
            continue;
        }
        entries.push([key, text]);
    }
    return { options: Object.fromEntries(entries), flags };
}

function readTargets(raw: unknown, problems: ManifestProblem[]): TargetSection[] {
    if (raw === undefined) return [];
    if (!isRecord(raw)) {
        problems.push({ key: 'target', message: '[target] must be a table' });
        return [];
    }
    const targets: TargetSection[] = [];
    for (const [backend, section] of Object.entries(raw)) {
        const target = readTarget(backend, section, problems);
        if (target) targets.push(target);
    }
    return targets;
}

function readSpec(raw: unknown, problems: ManifestProblem[]): SpecSection {
    const spec = isRecord(raw) ? raw : undefined;
    const files = stringArray(spec?.files, 'spec.files', problems) ?? [];
    if (spec === undefined) {
        problems.push({ key: 'spec', message: 'the manifest has no [spec] section' });
    } else if (files.length === 0) {
        problems.push({ key: 'spec.files', message: '[spec] files is empty' });
    }
    return {
        files,
        merge: typeof spec?.merge === 'boolean' ? spec.merge : undefined,
        strictMerge: typeof spec?.strict_merge === 'boolean' ? spec.strict_merge : undefined,
        extends: stringArray(spec?.extends, 'spec.extends', problems) ?? [],
        flags: stringArray(spec?.flags, 'spec.flags', problems) ?? [],
    };
}

function readProfiles(raw: unknown, problems: ManifestProblem[]): ProfileSection[] {
    if (raw === undefined) return [];
    if (!isRecord(raw)) {
        problems.push({ key: 'profile', message: '[profile] must be a table' });
        return [];
    }
    const profiles: ProfileSection[] = [];
    for (const [name, section] of Object.entries(raw)) {
        if (!isRecord(section)) {
            problems.push({ key: `profile.${name}`, message: 'a profile must be a table' });
            continue;
        }
        profiles.push({
            name,
            files: stringArray(section.files, `profile.${name}.files`, problems),
            merge: typeof section.merge === 'boolean' ? section.merge : undefined,
            flags: stringArray(section.flags, `profile.${name}.flags`, problems),
            targets: readTargets(section.target, problems),
        });
    }
    return profiles;
}

function readFeatures(raw: unknown, problems: ManifestProblem[]): Map<string, readonly string[]> {
    const features = new Map<string, readonly string[]>();
    if (!isRecord(raw)) return features;
    for (const [name, section] of Object.entries(raw)) {
        if (!isRecord(section)) {
            problems.push({ key: `features.${name}`, message: 'a feature must be a table' });
            continue;
        }
        const files = stringArray(section.files, `features.${name}.files`, problems);
        if (files === undefined) {
            problems.push({ key: `features.${name}`, message: `[features] ${name} needs files = [ ... ]` });
            continue;
        }
        features.set(name, files);
    }
    return features;
}

function readDependencies(raw: unknown, problems: ManifestProblem[]): Dependency[] {
    const dependencies: Dependency[] = [];
    if (!isRecord(raw)) return dependencies;
    for (const [name, section] of Object.entries(raw)) {
        if (!isRecord(section)) {
            problems.push({ key: `dependencies.${name}`, message: 'a dependency must be a table' });
            continue;
        }
        const path = section.path;
        const git = section.git;
        if (typeof path === 'string' && typeof git === 'string') {
            problems.push({ key: `dependencies.${name}`, message: `dependency ${name} gives both path and git` });
        } else if (typeof path === 'string') {
            dependencies.push({ name, kind: 'path', path });
        } else if (typeof git === 'string') {
            // Precedence tag > rev > branch (project.ml:244-248).
            const ref = [section.tag, section.rev, section.branch].find(v => typeof v === 'string');
            dependencies.push({ name, kind: 'git', git, ...(typeof ref === 'string' ? { ref } : {}) });
        } else {
            problems.push({ key: `dependencies.${name}`, message: `dependency ${name} needs a path or a git` });
        }
    }
    return dependencies;
}

/**
 * Parse an `Ott.toml`. `dir` is the directory containing it, used to resolve the
 * relative paths inside. Never throws: a malformed file yields a manifest with
 * no files and a problem describing why.
 */
export function parseManifest(text: string, dir: string): Manifest {
    const problems: ManifestProblem[] = [];
    const empty = (name: string): Manifest => ({
        dir, name,
        spec: { files: [], extends: [], flags: [] },
        targets: [], profiles: [], features: new Map(), dependencies: [], problems,
    });

    let root: unknown;
    try {
        root = parseToml(text);
    } catch (error) {
        problems.push({ key: '', message: `could not parse Ott.toml: ${String(error)}` });
        return empty('');
    }
    if (!isRecord(root)) {
        problems.push({ key: '', message: 'Ott.toml must be a table' });
        return empty('');
    }

    const pkg = isRecord(root.package) ? root.package : undefined;
    const name = typeof pkg?.name === 'string' ? pkg.name : '';
    if (!name) {
        problems.push({ key: 'package.name', message: '[package] needs a name' });
    }
    const spec = readSpec(root.spec, problems);

    return {
        dir, name, spec,
        targets: readTargets(root.target, problems),
        profiles: readProfiles(root.profile, problems),
        features: readFeatures(root.features, problems),
        dependencies: readDependencies(root.dependencies, problems),
        problems,
    };
}
