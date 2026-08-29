/**
 * Splitting an identifier into a root and a suffix.
 *
 * This is the reimplementation of `Term_parser.make_ident_lexer`, and the
 * grammar it implements is stated in `doc/top2.mng` §a17 ("The language of
 * symbolic terms") — not in `docs/`, whose "underscore + alphanumeric" account
 * (`t_body`) is wider than what Ott actually accepts:
 *
 *     suffix      ::= suffix_item*
 *     suffix_item ::= (0|1|..|9)+        (longest match)
 *                   | _
 *                   | '
 *                   | indexvar
 *                   | indexvar-1
 *
 * So `t_body` only splits when `body` is a declared *indexvar*; otherwise it is
 * not `t` with a suffix at all.
 *
 * The load-bearing consequence for an index is in the same section: resolving a
 * nonterminal "does not depend on what suffix was used". `T`, `T1`, `T'` and
 * `T_i` all denote the same rule, so an index is keyed on the root and the
 * suffix is only ever display detail. There is no "definition of `T1`".
 *
 * Upstream's splitter is nondeterministic — it returns `OP_None | OP_Some |
 * OP_Many` — so ambiguity is a real outcome rather than a bug to design away,
 * and callers have to decide what to do with it.
 */

/** Roots visible to a split, by kind. Index variables are matched inside suffixes. */
export interface RootSet {
    /** Every root that may head an identifier, longest-first is not required. */
    readonly roots: ReadonlySet<string>;
    /** Declared indexvar roots, which may appear *within* a suffix. */
    readonly indexvars: ReadonlySet<string>;
}

export interface RootSplit {
    readonly root: string;
    readonly suffix: string;
}

/**
 * Whether `text` is a well-formed suffix. Index variables are matched
 * longest-first so that `nm` prefers a declared `nm` over `n` followed by `m`.
 */
function isSuffix(text: string, indexvars: ReadonlySet<string>): boolean {
    const byLength = [...indexvars].sort((a, b) => b.length - a.length);
    let i = 0;
    while (i < text.length) {
        const rest = text.slice(i);

        const digits = /^\d+/.exec(rest);
        if (digits) {
            i += digits[0].length;
            continue;
        }
        if (rest.startsWith('_') || rest.startsWith("'")) {
            i += 1;
            continue;
        }
        const indexvar = byLength.find(v => rest.startsWith(v));
        if (indexvar !== undefined) {
            i += indexvar.length;
            // An index variable may carry an offset, and only `-1`.
            if (text.startsWith('-1', i)) {
                i += 2;
            }
            continue;
        }
        return false;
    }
    return true;
}

/**
 * Every way `word` splits into a declared root plus a valid suffix.
 *
 * More than one result is Ott's `OP_Many`: genuinely ambiguous, which happens
 * when one root is a prefix of another and both leave a valid suffix.
 */
export function splitRoot(word: string, { roots, indexvars }: RootSet): RootSplit[] {
    const splits: RootSplit[] = [];
    for (const root of roots) {
        if (!word.startsWith(root)) continue;
        const suffix = word.slice(root.length);
        if (isSuffix(suffix, indexvars)) {
            splits.push({ root, suffix });
        }
    }
    // Longest root first: the most specific reading is the one to show when a
    // caller only wants one.
    return splits.sort((a, b) => b.root.length - a.root.length);
}

/**
 * The root `word` denotes, or undefined when no declared root fits.
 *
 * Where several roots fit, the longest wins. That is not arbitrary: a longer
 * root consumes more of the word, so it is the more specific reading, and the
 * limiting case — an exact match with an empty suffix — is a word that simply
 * *is* a declared root. Ott's own splitter is nondeterministic here (it returns
 * `OP_Many` and lets the GLR parser settle it downstream), but a highlighter has
 * no downstream to defer to and must answer per token.
 *
 * Note there is no tie to break: two *distinct* roots of the same length cannot
 * both be a prefix of one word, so the candidates always differ in length.
 */
export function resolveRoot(word: string, set: RootSet): string | undefined {
    // splitRoot sorts longest-root-first.
    return splitRoot(word, set)[0]?.root;
}
