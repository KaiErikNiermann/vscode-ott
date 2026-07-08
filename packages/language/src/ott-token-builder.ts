import { DefaultTokenBuilder, GrammarAST } from 'langium';
import type { Grammar } from 'langium';
import type { TokenBuilderOptions } from 'langium';
import type { CustomPatternMatcherFunc, TokenType, TokenVocabulary } from 'chevrotain';

/**
 * Ott's real lexer is stateful (metalang / elements / hom / defnlang modes), so
 * `%` and `>> ... <<` mean different things depending on context. Langium uses a
 * single-mode Chevrotain lexer, so we reproduce the two context-sensitive rules
 * that a plain regex terminal cannot express, via custom pattern matchers:
 *
 *  - `%` starts a line comment only at the start of a line; a mid-line `%`
 *    (e.g. `( %prim ... )`) is object-language text.
 *  - `>> ... <<` is a block comment whose opening `>>` sits at a line start —
 *    either bare, or at the end of a `%`-prefixed line (Ott's `%d>>` mode-guard).
 *    This never matches the object-language `<< ... >>` substitution operator,
 *    whose `>>` is always mid-line.
 */

/** True if `offset` is at the start of a line (only spaces/tabs precede it back
 *  to a newline or the beginning of input). */
function atLineStart(text: string, offset: number): boolean {
    let i = offset - 1;
    while (i >= 0) {
        const c = text[i];
        if (c === ' ' || c === '\t') {
            i--;
            continue;
        }
        return c === '\n' || c === '\r';
    }
    return true;
}

/**
 * `%` line comment. Ott treats `%` as a comment at a line start, or mid-line
 * when it reads as prose (`... % TODO`, `... %% note`) — i.e. followed by
 * whitespace, another `%`, or end of line. A mid-line `%` glued to a word
 * (`( %prim ... )`, `%Z`) is object-language text, not a comment.
 */
const lineComment: CustomPatternMatcherFunc = (text, offset) => {
    if (text[offset] !== '%') {
        return null;
    }
    const next = text[offset + 1];
    const isComment = atLineStart(text, offset)
        || next === undefined || next === ' ' || next === '\t'
        || next === '\r' || next === '\n' || next === '%';
    if (!isComment) {
        return null;
    }
    let end = offset + 1;
    while (end < text.length && text[end] !== '\n' && text[end] !== '\r') {
        end++;
    }
    return [text.substring(offset, end)];
};

/** `>> ... <<` block comment: opens at a line-start `>>`, or at the terminating
 *  `>>` of a `%`-prefixed line; closes at the next `<<`. */
const blockComment: CustomPatternMatcherFunc = (text, offset) => {
    if (!atLineStart(text, offset)) {
        return null;
    }
    let openEnd: number;
    if (text[offset] === '>' && text[offset + 1] === '>') {
        openEnd = offset + 2;
    } else if (text[offset] === '%') {
        // A `%` line counts as an opener only if its last non-newline chars are `>>`.
        let eol = offset + 1;
        while (eol < text.length && text[eol] !== '\n' && text[eol] !== '\r') {
            eol++;
        }
        if (text[eol - 1] !== '>' || text[eol - 2] !== '>') {
            return null;
        }
        openEnd = eol;
    } else {
        return null;
    }
    for (let j = openEnd; j < text.length - 1; j++) {
        if (text[j] === '<' && text[j + 1] === '<') {
            return [text.substring(offset, j + 2)];
        }
    }
    return null; // unterminated: fall back to the plain `%` / `>` handling
};

/** Token builder that swaps the COMMENT and BLOCK_COMMENT patterns for the
 *  context-sensitive matchers above. */
export class OttTokenBuilder extends DefaultTokenBuilder {
    override buildTokens(grammar: Grammar, options?: TokenBuilderOptions): TokenVocabulary {
        const vocabulary = super.buildTokens(grammar, options);
        // Langium lists keyword tokens before terminals, so the single-char `>`
        // keyword would win over BLOCK_COMMENT (a custom terminal). Chevrotain
        // matches in array order, so hoist BLOCK_COMMENT to the front; its matcher
        // returns null unless it is genuinely at a `>> ... <<` opener.
        if (Array.isArray(vocabulary)) {
            const idx = vocabulary.findIndex(t => t.name === 'BLOCK_COMMENT');
            if (idx > 0) {
                vocabulary.unshift(vocabulary.splice(idx, 1)[0]);
            }
        }
        return vocabulary;
    }

    protected override buildTerminalToken(terminal: GrammarAST.TerminalRule): TokenType {
        const token = super.buildTerminalToken(terminal);
        if (terminal.name === 'COMMENT') {
            token.PATTERN = lineComment;
            token.LINE_BREAKS = false;
            token.START_CHARS_HINT = ['%'];
        } else if (terminal.name === 'BLOCK_COMMENT') {
            token.PATTERN = blockComment;
            token.LINE_BREAKS = true;
            token.START_CHARS_HINT = ['>', '%'];
        }
        return token;
    }
}
