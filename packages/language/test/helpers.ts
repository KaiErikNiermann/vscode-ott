import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The corpus copied from the upstream Ott distribution. */
export const FIXTURES_DIR = new URL('fixtures', import.meta.url).pathname;

/**
 * Files that ott itself cannot parse — not real Ott, so neither ott nor our
 * parser should be expected to handle them. Previously duplicated by hand in
 * fixtures.test.ts and formatting.test.ts with a "keep in sync" comment.
 */
export const OTT_UNPARSEABLE: ReadonlySet<string> = new Set([
    'ocaml_light/library.ott',  // starts with a -*-LaTeX-*- modeline
    'tapl/let_alltt.ott',       // LaTeX-rendered Ott, not actual Ott syntax
]);

/**
 * Files that *we* parse but the real `ott` 0.34 rejects, so they cannot be used
 * to cross-check us. Both fail inside `ocaml_light`'s large syntax definition
 * ("Problem parsing: syntax error" at syntax.ott:840, on a production using the
 * quoted terminals `'<<'` / `'>>'`).
 *
 * This is not the `%d`/`%m` line-prefix preprocessing that ocaml_light's
 * Makefile applies — running that sed pass first was verified to leave ott
 * failing, just at a different line. Being more permissive than ott here is
 * fine and wanted: an editor should still light up a file its compiler chokes
 * on. They stay in the Langium parse tests; only the oracle skips them.
 */
export const OTT_REJECTS: ReadonlySet<string> = new Set([
    'ocaml_light/syntax.ott',
    'ocaml_light/caml_plain_syntax.ott',
]);

/** Recursively collect every .ott file under a directory, sorted. */
export function collectOttFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) { // eslint-disable-line security/detect-non-literal-fs-filename
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { // eslint-disable-line security/detect-non-literal-fs-filename
            files.push(...collectOttFiles(full));
        } else if (entry.endsWith('.ott')) {
            files.push(full);
        }
    }
    return files.sort();
}

/**
 * Locate the real `ott` binary, used to cross-check that a fixture we reject is
 * genuinely invalid rather than a gap in our grammar.
 *
 * `which ott` alone is not enough: ott is commonly built in a source checkout
 * and never installed, in which case the whole cross-validation suite silently
 * skipped and the oracle never ran. `OTT_BIN` lets CI and a local checkout point
 * at it explicitly.
 */
export function resolveOttBinary(): string | null {
    const fromEnv = process.env.OTT_BIN;
    if (fromEnv && existsSync(fromEnv)) { // eslint-disable-line security/detect-non-literal-fs-filename
        return fromEnv;
    }
    try {
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        return execFileSync('which', ['ott'], { encoding: 'utf-8' }).trim() || null;
    } catch {
        return null;
    }
}

/**
 * Whether the real `ott` accepts a file, ignoring semantic errors.
 *
 * Only lex/parse failures count: `-i` also runs typechecking, and a fixture may
 * legitimately fail that (an undefined nonterminal, say) while still being
 * syntactically the thing we claim to parse.
 *
 * Takes the source text rather than a path so a *transformed* file — the output
 * of the formatter, say — can be checked without writing it back over a fixture.
 */
export function ottAccepts(ottBin: string, text: string, label: string): boolean {
    const dir = mkdtempSync(join(tmpdir(), 'ott-check-'));
    const file = join(dir, `${label.replace(/[^\w.-]/g, '_')}.ott`);
    try {
        writeFileSync(file, text); // eslint-disable-line security/detect-non-literal-fs-filename
        execFileSync(ottBin, ['-i', file, '-o', join(dir, 'out.tex')], {
            encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000,
        });
        return true;
    } catch (error: unknown) {
        const stderr = (error as { stderr?: string }).stderr ?? '';
        return !/Lexing error|parse error|Syntax error/i.test(stderr);
    } finally {
        rmSync(dir, { recursive: true, force: true }); // eslint-disable-line security/detect-non-literal-fs-filename
    }
}
