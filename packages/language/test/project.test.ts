import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
    createNodeResolveHost, findManifestPath, loadManifest, parseManifest, resolveProject,
    type ResolveHost,
} from 'ott-language';
import { FIXTURES_DIR, resolveOttBinary } from './helpers.js';

// The resolver reimplements `ott build`'s source-list computation so the editor
// does not have to shell out on every edit. That is only safe if the two agree,
// so the corpus manifests are checked against the real binary below; the unit
// tests above them pin the orderings that are easy to get subtly wrong.

/** A host with no filesystem, for manifests written inline. */
function fakeHost(manifests: Record<string, string>): ResolveHost {
    return {
        join: (...parts) => parts.join('/').replace(/\/+/g, '/').replace(/^\.\//, ''),
        isAbsolute: p => p.startsWith('/'),
        readManifest(dir) {
            const text = manifests[dir]; // eslint-disable-line security/detect-object-injection
            return text === undefined ? undefined : parseManifest(text, dir);
        },
    };
}

const BASE = `
[package]
name = "t"
[spec]
files = ["a.ott", "b.ott"]
[target.tex]
out = "build/t.tex"
`;

describe('manifest parsing', () => {
    test('reads the ordered source list', () => {
        const m = parseManifest(BASE, '.');
        expect(m.name).toBe('t');
        expect(m.spec.files).toEqual(['a.ott', 'b.ott']);
        expect(m.problems).toEqual([]);
    });

    test('an output extension must match its backend', () => {
        // Ott selects the backend from the extension, so a mismatch would
        // silently run a different one.
        const m = parseManifest(`${BASE}\n[target.coq]\nout = "build/t.tex"\n`, '.');
        expect(m.problems.map(p => p.key)).toContain('target.coq.out');
    });

    test('an unknown backend is reported', () => {
        const m = parseManifest(`${BASE}\n[target.agda]\nout = "x.agda"\n`, '.');
        expect(m.problems.map(p => p.message).join()).toMatch(/unknown backend "agda"/);
    });

    test('a "..." entry is flagged rather than treated as a wildcard', () => {
        // The docs' profile example has an ellipsis inside a quoted string;
        // nothing in project.ml special-cases it, so ott would open a file
        // literally named `...`.
        const m = parseManifest(`[package]\nname="t"\n[spec]\nfiles=["a.ott","...","c.ott"]\n[target.tex]\nout="t.tex"\n`, '.');
        expect(m.problems.map(p => p.message).join()).toMatch(/"\.\.\." is not a file name/);
    });

    test('a dependency may not give both path and git', () => {
        const m = parseManifest(`${BASE}\n[dependencies]\nc = { path = "../c", git = "https://x" }\n`, '.');
        expect(m.problems.map(p => p.message).join()).toMatch(/both path and git/);
    });

    test('a malformed file yields problems, not an exception', () => {
        const m = parseManifest('this is not toml = = =', '.');
        expect(m.problems.length).toBeGreaterThan(0);
        expect(m.spec.files).toEqual([]);
    });
});

describe('source-list resolution', () => {
    const host = fakeHost({});

    test('a profile replaces the file list rather than extending it', () => {
        const m = parseManifest(`${BASE}\n[profile.small]\nfiles = ["a.ott"]\n`, '.');
        expect(resolveProject(host, m, { profile: 'small' }).files).toEqual(['a.ott']);
    });

    test('a profile without files falls back to [spec] files', () => {
        const m = parseManifest(`${BASE}\n[profile.p]\nmerge = true\n`, '.');
        expect(resolveProject(host, m, { profile: 'p' }).files).toEqual(['a.ott', 'b.ott']);
    });

    test('features are appended in the order named, and deduplicated', () => {
        const m = parseManifest(
            `${BASE}\n[features]\nf = { files = ["b.ott", "f.ott"] }\ng = { files = ["g.ott"] }\n`, '.');
        // `b.ott` is already in the list, so its first position is kept.
        expect(resolveProject(host, m, { features: ['f', 'g'] }).files)
            .toEqual(['a.ott', 'b.ott', 'f.ott', 'g.ott']);
    });

    test('an unknown profile is reported and the default list is kept', () => {
        const m = parseManifest(`${BASE}\n[profile.p]\nfiles=["a.ott"]\n`, '.');
        const r = resolveProject(host, m, { profile: 'nope' });
        expect(r.problems.map(p => p.message).join()).toMatch(/unknown profile "nope".*available: p/);
        expect(r.files).toEqual(['a.ott', 'b.ott']);
    });

    test('dependency files come first, deepest-first', () => {
        // main -> core -> base. A definition must precede its uses, so the
        // deepest dependency's files lead.
        const manifests = {
            '../core': `[package]\nname="core"\n[spec]\nfiles=["core.ott"]\n[dependencies]\nbase={path="../base"}\n[target.tex]\nout="c.tex"\n`,
            '../core/../base': `[package]\nname="base"\n[spec]\nfiles=["base.ott"]\n[target.tex]\nout="b.tex"\n`,
        };
        const h = fakeHost(manifests);
        const m = parseManifest(`${BASE}\n[dependencies]\ncore = { path = "../core" }\n`, '.');
        expect(resolveProject(h, m).files)
            .toEqual(['../core/../base/base.ott', '../core/core.ott', 'a.ott', 'b.ott']);
    });

    test('a dependency cycle is reported rather than looped on', () => {
        const h = fakeHost({
            '../c': `[package]\nname="c"\n[spec]\nfiles=["c.ott"]\n[dependencies]\nt={path="../t"}\n[target.tex]\nout="c.tex"\n`,
            '../c/../t': `[package]\nname="t"\n[spec]\nfiles=["t.ott"]\n[dependencies]\nc={path="../c"}\n[target.tex]\nout="t.tex"\n`,
        });
        const m = parseManifest(`${BASE}\n[dependencies]\nc = { path = "../c" }\n`, '.');
        const r = resolveProject(h, m);
        expect(r.problems.map(p => p.message).join()).toMatch(/dependency cycle through c/);
    });

    test('an unfetched git dependency degrades instead of failing', () => {
        const m = parseManifest(`${BASE}\n[dependencies]\nstd = { git = "https://x", tag = "v1" }\n`, '.');
        const r = resolveProject(fakeHost({}), m);
        expect(r.files).toEqual(['a.ott', 'b.ott']);
        expect(r.problems.map(p => p.message).join()).toMatch(/not fetched/);
    });
});

// ── Cross-validation against the real `ott build --print-files` ────────────

function projectDirs(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) { // eslint-disable-line security/detect-non-literal-fs-filename
        const full = join(dir, entry);
        if (!statSync(full).isDirectory()) continue; // eslint-disable-line security/detect-non-literal-fs-filename
        if (readdirSync(full).includes('Ott.toml')) out.push(full); // eslint-disable-line security/detect-non-literal-fs-filename
        out.push(...projectDirs(full));
    }
    return out.sort();
}

describe('resolver agrees with `ott build --print-files`', () => {
    const ottPath = resolveOttBinary();

    for (const dir of projectDirs(FIXTURES_DIR)) {
        const manifest = loadManifest(join(dir, 'Ott.toml'));
        if (!manifest) continue;
        const name = relative(FIXTURES_DIR, dir);
        // The default source set, plus every profile the manifest declares.
        const sets: Array<string | undefined> = [undefined, ...manifest.profiles.map(p => p.name)];

        for (const profile of sets) {
            const label = profile === undefined ? 'default' : `--profile ${profile}`;
            test.runIf(ottPath !== null)(`${name}: ${label}`, () => {
                const args = ['build', ...(profile === undefined ? [] : ['--profile', profile]), '--print-files'];
                const printed = execFileSync(ottPath as string, args, {
                    cwd: dir, encoding: 'utf-8', timeout: 30_000,
                }).trim().split(/\s+/).filter(Boolean);

                const ours = resolveProject(
                    createNodeResolveHost(), manifest,
                    profile === undefined ? {} : { profile },
                );
                expect(ours.files).toEqual(printed);
            });
        }
    }

    test('every fixture manifest parses without problems', () => {
        for (const dir of projectDirs(FIXTURES_DIR)) {
            const text = readFileSync(join(dir, 'Ott.toml'), 'utf-8'); // eslint-disable-line security/detect-non-literal-fs-filename
            const m = parseManifest(text, dir);
            expect(m.problems, `${relative(FIXTURES_DIR, dir)}/Ott.toml`).toEqual([]);
        }
    });
});

describe('manifest discovery', () => {
    test('walks up from a source file to the nearest Ott.toml', () => {
        // `ott build` only looks in the current directory because it is run from
        // the project root; an editor opens a file at arbitrary depth.
        const found = findManifestPath(join(FIXTURES_DIR, 'tapl'));
        expect(found).toBe(join(FIXTURES_DIR, 'tapl', 'Ott.toml'));
    });

    test('a directory under no manifest resolves to nothing', () => {
        // 1Bsemantics has no Ott.toml, and neither does any parent inside the
        // repo — such files keep working as standalone documents.
        const found = findManifestPath(join(FIXTURES_DIR, '1Bsemantics'));
        expect(found === undefined || !found.startsWith(FIXTURES_DIR)).toBe(true);
    });

    test('the discovered manifest resolves to a usable file list', () => {
        const path = findManifestPath(join(FIXTURES_DIR, 'stlc_lean'));
        const manifest = loadManifest(path as string);
        expect(resolveProject(createNodeResolveHost(), manifest!).files).toEqual(['stlc_lean.ott']);
    });
});
