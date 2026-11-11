import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import oniguruma from 'vscode-oniguruma';
import textmate from 'vscode-textmate';

/**
 * Tokenises Ott source with the real TextMate engine VS Code uses, so a test
 * can assert on the scopes an editor would show rather than on the regexes in
 * isolation -- which is the only way to check how rules *interact*: which one
 * wins at a position, where an embedded grammar ends, whether `}}` closes a
 * hom whose body another grammar is tokenising.
 */

const OTT_GRAMMAR = new URL('../syntaxes/ott.tmLanguage.json', import.meta.url).pathname;

/** The scopes of one token, and the text it covers. */
export interface Token {
    readonly text: string;
    readonly scopes: readonly string[];
}

let onigReady: Promise<void> | undefined;

function loadOniguruma(): Promise<void> {
    if (onigReady === undefined) {
        const wasm = readFileSync(createRequire(import.meta.url).resolve('vscode-oniguruma/release/onig.wasm'));
        onigReady = oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
    }
    return onigReady;
}

/**
 * Tokenise `source` with the Ott grammar.  `embedded` maps the scope name of
 * each grammar the Ott grammar may include (`source.typst`, `text.tex`, ...)
 * to the path of its JSON file; a scope with no entry is simply absent, as in
 * an editor without that language installed.
 */
export async function tokenize(source: string, embedded: Readonly<Record<string, string>> = {}): Promise<Token[][]> {
    await loadOniguruma();
    const paths: Record<string, string> = { 'source.ott': OTT_GRAMMAR, ...embedded };
    const registry = new textmate.Registry({
        onigLib: Promise.resolve({
            createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
            createOnigString: (s: string) => new oniguruma.OnigString(s),
        }),
        loadGrammar: async (scopeName: string) => {
            const path = paths[scopeName];
            if (path === undefined) return null;
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            return textmate.parseRawGrammar(readFileSync(path, 'utf-8'), path);
        },
    });
    const grammar = await registry.loadGrammar('source.ott');
    if (grammar === null) throw new Error('could not load the Ott grammar');

    let state = textmate.INITIAL;
    return source.split('\n').map(line => {
        const result = grammar.tokenizeLine(line, state);
        state = result.ruleStack;
        return result.tokens.map(t => ({ text: line.slice(t.startIndex, t.endIndex), scopes: t.scopes }));
    });
}

/** The tokens whose text is exactly `text`, across all lines. */
export function tokensOf(lines: readonly Token[][], text: string): Token[] {
    return lines.flat().filter(t => t.text === text);
}

/** Whether some scope of `token` starts with `prefix`. */
export function hasScope(token: Token | undefined, prefix: string): boolean {
    return token !== undefined && token.scopes.some(s => s === prefix || s.startsWith(prefix + '.') || s.startsWith(prefix + ' '));
}

/** The stub grammars under test/grammars, by the scope name they stand in for. */
export const STUB_GRAMMARS = {
    tex: { 'text.tex': new URL('grammars/tex-stub.tmLanguage.json', import.meta.url).pathname },
    typst: { 'source.typst': new URL('grammars/typst-stub.tmLanguage.json', import.meta.url).pathname },
} as const;

/**
 * The first of `candidates` that exists, for tests that also run against a
 * real grammar when this machine has one installed (VS Code's own LaTeX
 * grammar from the e2e download, Tinymist's Typst grammar from the user's
 * extensions).  Undefined when none does: those tests are then skipped, and
 * the stub-grammar tests still cover the Ott side.
 */
export function installedGrammar(candidates: readonly string[]): string | undefined {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return candidates.find(path => existsSync(path));
}

/** Paths under a directory whose name starts with `prefix`, for versioned extension folders. */
export function versionedDirs(parent: string, prefix: string): string[] {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!existsSync(parent)) return [];
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return readdirSync(parent).filter(d => d.startsWith(prefix)).sort().reverse().map(d => join(parent, d));
}
