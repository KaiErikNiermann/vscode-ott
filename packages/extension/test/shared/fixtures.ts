import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Paths and text helpers shared by the stdio LSP suite (vitest, run from
 * source) and the VS Code suite (bundled to CJS by esbuild, run inside the
 * extension host). Neither runner may assume the other's module system, so
 * the directory is located from whichever of `import.meta.url` / `__dirname`
 * the bundle provides.
 */

declare const __dirname: string | undefined;

function here(): string {
    // esbuild's CJS output leaves `import.meta` empty but defines __dirname.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof __dirname === 'string') return __dirname;
    return dirname(fileURLToPath(import.meta.url));
}

/** packages/extension, found by walking up to the directory holding esbuild.mjs. */
function extensionRoot(): string {
    let dir = here();
    for (let i = 0; i < 6; i++) {
        if (existsSync(join(dir, 'esbuild.mjs'))) return dir; // eslint-disable-line security/detect-non-literal-fs-filename
        dir = dirname(dir);
    }
    throw new Error(`could not find packages/extension above ${here()}`);
}

export const EXTENSION_ROOT = extensionRoot();
export const REPO_ROOT = resolve(EXTENSION_ROOT, '..', '..');
export const WORKSPACE = join(EXTENSION_ROOT, 'test', 'fixtures', 'workspace');

export const fixture = (...parts: string[]): string => join(WORKSPACE, ...parts);

export const readFixture = (...parts: string[]): string =>
    readFileSync(fixture(...parts), 'utf-8'); // eslint-disable-line security/detect-non-literal-fs-filename

export interface Position {
    readonly line: number;
    readonly character: number;
}

/** Zero-based position of the `nth` occurrence of `needle`, plus `offset` characters. */
export function positionIn(text: string, needle: string, nth = 0, offset = 0): Position {
    let index = -1;
    for (let i = 0; i <= nth; i++) {
        index = text.indexOf(needle, index + 1);
        if (index < 0) throw new Error(`"${needle}" #${nth} not found`);
    }
    const before = text.slice(0, index + offset).split('\n');
    return { line: before.length - 1, character: before[before.length - 1]?.length ?? 0 };
}

/** The typing rule `proj` uses `l`, which only labels.ott declares. */
export const LABEL_USE = { file: 'typing.ott', needle: 'e . l : T', offset: 4 } as const;

export const RULE_SEPARATOR_WARNING = 'Rule separator should have a name.';

export interface Edit {
    readonly range: { readonly start: Position; readonly end: Position };
    readonly newText: string;
}

/**
 * Apply formatter edits to `text`. VS Code minimises a provider's edits before
 * handing them out, so the suites compare resulting text rather than edits.
 */
export function applyEdits(text: string, edits: readonly Edit[]): string {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    const offsetAt = (p: Position) => (starts[p.line] ?? text.length) + p.character;
    return [...edits]
        .sort((a, b) => offsetAt(b.range.start) - offsetAt(a.range.start))
        .reduce((out, e) => out.slice(0, offsetAt(e.range.start)) + e.newText + out.slice(offsetAt(e.range.end)), text);
}

/**
 * Dashes in the typing rule `var`'s bar. The fixture has 13 over premises and
 * a conclusion 10 columns wide, so `ott.format.rules.bar = fit` makes it 10.
 */
export function varBarWidth(text: string): number {
    return /^(-+)\s*::\s*var\s*$/m.exec(text)?.[1]?.length ?? -1;
}
