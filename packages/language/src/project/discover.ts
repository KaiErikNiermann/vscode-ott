import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { parseManifest, type Manifest } from './manifest.js';
import type { ResolveHost } from './resolve.js';

export const MANIFEST_NAME = 'Ott.toml';

/**
 * Find the project a file belongs to by walking up to the nearest `Ott.toml`.
 *
 * `ott build` only ever looks in the current directory (project.ml:258-260),
 * because it is invoked from the project root. An editor opens a file at an
 * arbitrary depth, so walking up is the right behaviour here — and a file under
 * no manifest keeps working as a standalone document, which is the whole
 * `tests/` corpus.
 */
export function findManifestPath(startDir: string): string | undefined {
    let dir = normalize(startDir);
    for (;;) {
        const candidate = join(dir, MANIFEST_NAME);
        if (existsSync(candidate)) { // eslint-disable-line security/detect-non-literal-fs-filename
            return candidate;
        }
        const parent = dirname(dir);
        if (parent === dir) {
            return undefined;
        }
        dir = parent;
    }
}

/** Read and parse the manifest at `path`, or undefined if it cannot be read. */
export function loadManifest(path: string): Manifest | undefined {
    try {
        const text = readFileSync(path, 'utf8'); // eslint-disable-line security/detect-non-literal-fs-filename
        return parseManifest(text, dirname(path));
    } catch {
        return undefined;
    }
}

/**
 * A `ResolveHost` backed by the real filesystem, memoising each manifest it
 * reads so a diamond dependency is parsed once.
 */
export function createNodeResolveHost(): ResolveHost {
    const cache = new Map<string, Manifest | undefined>();
    return {
        join: (...parts) => normalize(join(...parts)),
        isAbsolute,
        readManifest(dir) {
            const cached = cache.get(dir);
            if (cached !== undefined || cache.has(dir)) {
                return cached;
            }
            const manifest = loadManifest(join(dir, MANIFEST_NAME));
            cache.set(dir, manifest);
            return manifest;
        },
    };
}
