/**
 * Ott's module header (`module` / `extends` / `imports` / `renaming` / `as`).
 *
 * These five words are *contextual* keywords: Ott recognises them only in a
 * file's header, so a production or nonterminal may still be called `module` or
 * `as`, and several in the corpus are (`tests/test-j.ott:8` has `:: :: module`).
 * Reserving them unconditionally would regress those files.
 *
 * Upstream (`src/grammar_lexer.mll:161-176`) implements this with a mutable
 * `in_header` flag that starts true and flips false at the first token *outside*
 *
 *     { MODULE, EXTENDS, IMPORTS, RENAMING, AS, COMMA, STRING,
 *       INTERSTITIAL, BLANKS, COMMENTLINE, BLANKLINE }
 *
 * Chevrotain pattern matchers are position-based rather than stateful, so
 * instead of a flag we compute the offset at which the header ends and gate the
 * keywords on it. The two formulations agree because every Ott item begins with
 * a keyword token of its own: "the first token outside the keep-set" is exactly
 * "the first item keyword, or the first character that cannot start a STRING".
 *
 * Note what the keep-set implies and what a naive reading misses: whitespace,
 * comments AND bare identifiers all keep the header open — `STRING` is in the
 * set because that is how the operands of `module NAME` and `renaming A as B`
 * reach the parser. So the header does not end at the first non-keyword word.
 */

/**
 * Words that introduce a top-level item. Taken from `item:` in
 * `src/grammar_parser.mly:143-161` rather than the docs, which omit
 * `contextrules`, `homs` and the three `coq*` forms entirely.
 */
const ITEM_KEYWORDS: ReadonlySet<string> = new Set([
    'metavar', 'indexvar', 'grammar', 'defns', 'defn', 'funs', 'fun', 'embed',
    'subrules', 'substitutions', 'freevars', 'parsing', 'homs', 'contextrules',
    'begincoqsection', 'endcoqsection', 'coqvariable',
]);

/** The five words that are keywords only inside the header. */
export const HEADER_KEYWORDS: readonly string[] = ['module', 'extends', 'imports', 'renaming', 'as'];

const isIdentStart = (c: string | undefined): boolean =>
    c !== undefined && (/[A-Za-z_]/.test(c));

const isIdentPart = (c: string | undefined): boolean =>
    c !== undefined && (/[\w']/.test(c));

/** True if only spaces/tabs separate `offset` from the start of its line. */
function atLineStart(text: string, offset: number): boolean {
    for (let i = offset - 1; i >= 0; i--) {
        const c = text[i];
        if (c === ' ' || c === '\t') {
            continue;
        }
        return c === '\n' || c === '\r';
    }
    return true;
}

/** Skip a `>> ... <<` block comment, including Ott's `%d>>` mode-guard opener.
 *  Returns the offset just past the closing `<<`, or -1 if this is not one. */
function skipBlockComment(text: string, offset: number): number {
    if (!atLineStart(text, offset)) {
        return -1;
    }
    let openEnd: number;
    if (text[offset] === '>' && text[offset + 1] === '>') {
        openEnd = offset + 2;
    } else if (text[offset] === '%') {
        let eol = offset + 1;
        while (eol < text.length && text[eol] !== '\n' && text[eol] !== '\r') {
            eol++;
        }
        if (text[eol - 1] !== '>' || text[eol - 2] !== '>') {
            return -1;
        }
        openEnd = eol;
    } else {
        return -1;
    }
    const close = text.indexOf('<<', openEnd);
    return close === -1 ? -1 : close + 2;
}

/**
 * The offset at which the header ends — i.e. the first offset at which the five
 * header words are ordinary identifiers again. A file with no header returns 0
 * only if its very first token is structural; leading comments and whitespace
 * still count as header.
 */
export function computeHeaderEnd(text: string): number {
    let i = 0;
    while (i < text.length) {
        const c = text[i];

        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            i++;
            continue;
        }

        const afterBlock = skipBlockComment(text, i);
        if (afterBlock !== -1) {
            i = afterBlock;
            continue;
        }

        if (c === '%') {
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
                i++;
            }
            continue;
        }

        // COMMA keeps the header open (it separates `renaming a as b, c as d`).
        if (c === ',') {
            i++;
            continue;
        }

        // A quoted identifier is a STRING, and is never a header keyword —
        // quoting is how you write a root actually named `module`.
        if (c === "'") {
            const close = text.indexOf("'", i + 1);
            if (close === -1) {
                return i;
            }
            i = close + 1;
            continue;
        }

        if (isIdentStart(c)) {
            const start = i;
            while (isIdentPart(text[i])) {
                i++;
            }
            // An item keyword ends the header *before* itself, so that e.g.
            // `metavar module ::=` leaves `module` outside the header.
            if (ITEM_KEYWORDS.has(text.slice(start, i))) {
                return start;
            }
            continue;
        }

        // Anything else (`::=`, `|`, `{{`, …) is structural.
        return i;
    }
    return text.length;
}

/** `computeHeaderEnd` memoised on the text most recently lexed. The lexer calls
 *  the gated matchers once per candidate occurrence over one document, so a
 *  single-entry cache removes the repeated full-prefix scan. */
let cachedText: string | undefined;
let cachedEnd = 0;

export function headerEnd(text: string): number {
    if (text !== cachedText) {
        cachedText = text;
        cachedEnd = computeHeaderEnd(text);
    }
    return cachedEnd;
}
