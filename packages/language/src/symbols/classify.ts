import type { Scope } from './project.js';
import { resolveRoot } from './suffix.js';

/**
 * Classifying the object-language text inside inference rules and productions.
 *
 * This is the shared core of highlighting, hover and go-to-definition: given a
 * span of source and the scope of the file it was written in, say what each
 * token is. Ott states the rule itself (`doc/top2.mng` §a17): strip the suffix,
 * then an element is a nonterminal if its root is a declared ntr, else a
 * metavariable, else an indexvar, else a terminal.
 *
 * It deliberately re-scans raw text rather than reusing the Langium token
 * stream, because that stream is misaligned with object-language terminals in
 * both directions:
 *
 *     G |- \x:T1.e : T1 -> T2
 *        ELEMENT_STRING  "\x:T1"   <- glued: one lexer token, three object tokens
 *        ELEMENT_STRING  "-"       <- split: `->` spans two lexer tokens
 *        >               ">"
 *
 * Maximal munch over the project's declared terminals fixes both.
 */

export type TokenClass =
    | 'nonterminal' | 'metavar' | 'indexvar' | 'terminal' | 'judgement'
    | 'annotation' | 'punctuation' | 'unknown';

export interface ClassifiedToken {
    /** Absolute offset in the document. */
    readonly offset: number;
    readonly length: number;
    readonly text: string;
    readonly kind: TokenClass;
    /** The declared root this resolves to, when it resolves to one. */
    readonly root?: string;
}

export interface Classifier {
    /** Classify every token in `text`, whose first character sits at `baseOffset`. */
    scan(text: string, baseOffset: number): ClassifiedToken[];
    /** Classify a single word, as hover and go-to-definition need. */
    classifyWord(word: string): { kind: TokenClass; root?: string };
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[\w']/;

/**
 * Ott's own words that appear inside object-language text. `IN` bounds a
 * comprehension (`</ ti // i IN 1 .. n />`) and is a keyword only there, so it
 * is Ott syntax rather than an unresolved symbol.
 */
const OTT_SYNTAX_WORDS: ReadonlySet<string> = new Set(['IN']);

/** A declared symbol's kind, as a token class. */
const KIND_OF: ReadonlyMap<string, TokenClass> = new Map([
    ['metavar', 'metavar'], ['indexvar', 'indexvar'], ['judgement', 'judgement'],
    ['terminal', 'terminal'], ['nonterminal', 'nonterminal'],
]);

/**
 * Build a classifier for one file's scope. `terminals` is the whole build's
 * pool, since terminals are never scoped.
 */
export function createClassifier(
    scope: Scope,
    terminals: ReadonlySet<string>,
    /** Production and judgement names a `:name:` annotation may refer to. */
    annotations: ReadonlySet<string> = new Set(),
): Classifier {
    // Maximal munch needs the longest spelling first, so `-->` beats `->` beats
    // `-`. Only the symbolic ones participate: an alphabetic terminal such as
    // `if` must not match inside `ifx`, so those go through the word path.
    const symbolic = [...terminals]
        .filter(t => t.length > 0 && !IDENT_START.test(t[0]))
        .sort((a, b) => b.length - a.length);

    const set = { roots: scope.roots, indexvars: scope.indexvars };

    function classifyWord(word: string): { kind: TokenClass; root?: string } {
        if (OTT_SYNTAX_WORDS.has(word)) return { kind: 'punctuation' };
        // A declared terminal wins outright — `terminals` may name a word that
        // would otherwise look like a root.
        if (terminals.has(word)) return { kind: 'terminal' };
        const root = resolveRoot(word, set);
        if (root === undefined) return { kind: 'unknown' };
        const entry = scope.get(root);
        if (entry === undefined) return { kind: 'unknown' };
        return { kind: KIND_OF.get(entry.kind) ?? 'nonterminal', root };
    }

    /**
     * `:prodname:` pins which production a term parses as, and `:concrete:` /
     * `:deeper:` switch parsing mode (top2.mng §a17). The name between the
     * colons is a production or judgement name — composed with its rule's
     * namespace prefix, so `t :: Tm ::=` with production `Pair` is written
     * `:TmPair:` — and so is matched against those rather than against roots.
     */
    function matchAnnotation(text: string, at: number): string | undefined {
        if (text.charAt(at) !== ':') return undefined;
        const match = /^:([A-Za-z_][\w']*):/.exec(text.slice(at));
        return match && annotations.has(match[1]) ? match[0] : undefined;
    }

    function wordToken(word: string, offset: number): ClassifiedToken {
        const { kind, root } = classifyWord(word);
        return {
            offset, length: word.length, text: word, kind,
            ...(root === undefined ? {} : { root }),
        };
    }

    function scan(text: string, baseOffset: number): ClassifiedToken[] {
        const out: ClassifiedToken[] = [];
        let i = 0;
        while (i < text.length) {
            const c = text.charAt(i);
            if (/\s/.test(c)) {
                i++;
                continue;
            }

            const annotation = matchAnnotation(text, i);
            if (annotation !== undefined) {
                out.push({
                    offset: baseOffset + i, length: annotation.length,
                    text: annotation, kind: 'annotation',
                });
                i += annotation.length;
                continue;
            }

            const symbol = symbolic.find(t => text.startsWith(t, i));
            if (symbol !== undefined) {
                out.push({ offset: baseOffset + i, length: symbol.length, text: symbol, kind: 'terminal' });
                i += symbol.length;
                continue;
            }

            if (IDENT_START.test(c)) {
                const start = i;
                while (i < text.length && IDENT_PART.test(text.charAt(i))) i++;
                out.push(wordToken(text.slice(start, i), baseOffset + start));
                continue;
            }

            out.push({ offset: baseOffset + i, length: 1, text: c, kind: 'punctuation' });
            i++;
        }
        return out;
    }

    return { scan, classifyWord };
}
