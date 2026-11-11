import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
