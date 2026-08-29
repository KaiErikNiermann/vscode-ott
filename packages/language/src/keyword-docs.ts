/**
 * Reference documentation for Ott's own keywords.
 *
 * The hover provider already explains the *instance* under the cursor — that
 * this defns block holds three judgement forms — which helps only a reader who
 * already knows what a defns block is. These entries supply the other half: what
 * the construct is, the smallest example of it, and where to read more.
 *
 * The same shape as `HOM_DESCRIPTIONS` in the hover provider, which does this
 * for homomorphism targets, extended with an example because that is the part
 * people actually copy.
 *
 * Two words a reader might expect here are deliberately absent. `terminals` is
 * not a keyword at all — it is an ordinary grammar rule that happens to be
 * named `terminals`, so it is handled where grammar rules are. And `uniq` is
 * not Ott syntax in any form: in `stlc_lean.ott` it names a judgement the spec
 * itself declares, and it already hovers as one.
 */

export interface KeywordDoc {
    /** What the construct is called, in prose. */
    readonly title: string;
    /** One or two sentences. */
    readonly summary: string;
    /** The smallest example that stands on its own. */
    readonly example: readonly string[];
    /** Path under the Ott `docs/` tree, joined onto `ott.docs.baseUrl`. */
    readonly doc?: string;
    /** Link text. */
    readonly docTitle?: string;
}

const SYNTAX = 'guide/syntax-definitions.rst';
const JUDGMENTS = 'guide/judgments.rst';
const MODULES = 'development/module-system.rst';

export const KEYWORD_DOCS: Readonly<Record<string, KeywordDoc>> = {
    metavar: {
        title: 'Metavariable declaration',
        summary: 'Declares the variables of the object language — the things that '
            + 'can be bound and substituted for. Every name listed is a synonym for '
            + 'the same metavariable, and a suffix (`x1`, `x\'`, `x_i`) never makes a new one.',
        example: ['metavar var, x, y ::=', '  {{ com term variables }}', '  {{ lex alphanum }}'],
        doc: SYNTAX, docTitle: 'Syntax definitions',
    },
    indexvar: {
        title: 'Index variable declaration',
        summary: 'Declares a variable that ranges over list positions, for use in '
            + 'comprehensions. Unlike every other root, an index variable cannot itself '
            + 'carry a suffix.',
        example: ['indexvar i, j, n ::='],
        doc: 'guide/list-forms.rst', docTitle: 'List forms',
    },
    grammar: {
        title: 'Grammar block',
        summary: 'Opens a block of grammar rules. Each rule names a nonterminal, the '
            + 'prefix its constructors get in generated code, and the productions that '
            + 'make it up.',
        example: [
            'grammar',
            '',
            'typ, T :: \'typ_\' ::= {{ com types }}',
            '  | bool       ::   :: bool',
            '  | T1 -> T2   ::   :: arrow',
            '  | ( T )      :: S :: paren',
        ],
        doc: SYNTAX, docTitle: 'Syntax definitions',
    },
    defns: {
        title: 'Definition class',
        summary: 'Groups judgement forms that are defined by mutual induction. The '
            + 'name is used for the group in generated output; `\'\'` means no prefix.',
        example: ['defns', 'Jtyping :: \'\' ::=', '', 'defn', '...'],
        doc: JUDGMENTS, docTitle: 'Judgments',
    },
    defn: {
        title: 'Judgement form',
        summary: 'Declares one judgement and the inference rules that define it. The '
            + 'header has four `::`-separated fields — the form itself, an optional '
            + 'category list, the name, and the prefix for rule names. A blank line is '
            + 'required after `by` and before every rule.',
        example: [
            'defn',
            'G |- e : T :: :: typing :: \'typing_\'',
            '{{ com typing }}',
            'by',
            '',
            'G , x : T1 |- e : T2',
            '-------------------------- :: abs',
            'G |- \\x:T1.e : T1 -> T2',
        ],
        doc: JUDGMENTS, docTitle: 'Judgments',
    },
    by: {
        title: 'Start of a rule list',
        summary: 'Separates a judgement form\'s header from its inference rules. '
            + 'Everything after it is read line by line: a blank line before every rule, '
            + 'premises above the dashed bar, the conclusion below.',
        example: ['by', '', 'premise', '------------ :: name', 'conclusion'],
        doc: JUDGMENTS, docTitle: 'Judgments',
    },
    funs: {
        title: 'Function block',
        summary: 'Opens a block of function definitions — auxiliary functions over the '
            + 'object language, defined by equations rather than by inference rules.',
        example: ['funs', 'F ::=', '', 'fun', 'dom ( E ) :: name :: domE by', '', 'dom(x:T) === x'],
    },
    fun: {
        title: 'Function definition',
        summary: 'One function in a `funs` block: its application form, its result '
            + 'nonterminal, its name, and then `===` clauses after `by`.',
        example: ['fun', 'dom ( E ) :: name :: domE by', '', 'dom(x:T) === x'],
    },
    subrules: {
        title: 'Subrule declarations',
        summary: 'Declares that one nonterminal is a syntactic subset of another, so '
            + 'a value may appear wherever a term may. Ott checks the containment and '
            + 'generates the coercions; the relation is transitive.',
        example: ['subrules', '  v <:: t'],
        doc: SYNTAX, docTitle: 'Syntax definitions',
    },
    substitutions: {
        title: 'Substitution declarations',
        summary: 'Asks Ott to generate a substitution function — substituting the '
            + 'second root for the first, named by the trailing identifier.',
        example: ['substitutions', '  single t x :: subst'],
        doc: 'guide/substitutions.rst', docTitle: 'Substitutions',
    },
    freevars: {
        title: 'Free-variable declarations',
        summary: 'Asks Ott to generate a free-variable function over a nonterminal, '
            + 'following the binding structure declared by its bind specifications.',
        example: ['freevars', '  t x :: fv'],
        doc: 'guide/binding-specifications.rst', docTitle: 'Binding specifications',
    },
    parsing: {
        title: 'Parsing priorities',
        summary: 'Resolves ambiguity between productions. `A <= B` says a parse using '
            + 'A is discarded when one using B is also possible — Ott parses the object '
            + 'language with a GLR parser, so several parses really can succeed.',
        example: ['parsing', '  t_app <= t_abs'],
    },
    embed: {
        title: 'Embedded target text',
        summary: 'Passes text straight through to a backend without Ott reading it. '
            + 'Used for preambles, imports and hand-written lemmas.',
        example: ['embed', '{{ tex \\newcommand{\\myrel}[2]{#1 \\to #2} }}'],
        doc: 'reference/homomorphisms.rst', docTitle: 'Homomorphisms',
    },
    homs: {
        title: 'Detached homomorphisms',
        summary: 'Attaches homomorphisms to productions declared elsewhere, named by '
            + 'the rule prefix and the production name. Useful for keeping backend '
            + 'output away from the grammar it describes.',
        example: ['homs \'t_\'', '  :: Var   {{ com variable }}', '  :: Lam   (+ bind x in t +)'],
        doc: 'reference/homomorphisms.rst', docTitle: 'Homomorphisms',
    },

    // ── The module header ────────────────────────────────────
    module: {
        title: 'Module declaration',
        summary: 'Names the module this file contributes to. Header declarations must '
            + 'come before every other item; `module` is a keyword only there, so a '
            + 'production or nonterminal may still be called `module`.',
        example: ['module tapl'],
        doc: MODULES, docTitle: 'The module system',
    },
    extends: {
        title: 'Module extension',
        summary: 'Makes another module\'s roots visible here under their original '
            + 'names, so both files\' declarations of a root refer to the same thing.',
        example: ['module l2', 'extends l1'],
        doc: MODULES, docTitle: 'The module system',
    },
    imports: {
        title: 'Module import',
        summary: 'Makes another module\'s roots visible under names this file chooses. '
            + 'Without a `renaming` the original names are used.',
        example: ['imports arith renaming t as a_t, x as a_x'],
        doc: MODULES, docTitle: 'The module system',
    },
    renaming: {
        title: 'Import renaming',
        summary: 'Gives an imported root a new surface name here. Ott refuses a '
            + 'renaming that would collide with an identifier hand-written in a '
            + 'homomorphism or an `embed` block.',
        example: ['imports arith renaming t as a_t, x as a_x'],
        doc: MODULES, docTitle: 'The module system',
    },
    as: {
        title: 'Import renaming',
        summary: 'Pairs an imported root with the name it takes here. A keyword only '
            + 'in a file header — elsewhere `as` is ordinary object syntax, as in '
            + '`t as T` for a type ascription.',
        example: ['imports arith renaming t as a_t'],
        doc: MODULES, docTitle: 'The module system',
    },

    // ── Inline constructs ────────────────────────────────────
    '<::': {
        title: 'Subrule',
        summary: 'Declares the nonterminal on the left a syntactic subset of the one '
            + 'on the right, so it may appear anywhere the right-hand one may.',
        example: ['subrules', '  v <:: t'],
        doc: SYNTAX, docTitle: 'Syntax definitions',
    },
    '(+': {
        title: 'Binding specification',
        summary: 'Declares what a production binds and where, which is what lets Ott '
            + 'generate correct substitution and free-variable functions.',
        example: ['| \\ x : T . e   ::   :: abs', '  (+ bind x in e +)'],
        doc: 'guide/binding-specifications.rst', docTitle: 'Binding specifications',
    },
    '</': {
        title: 'Comprehension',
        summary: 'A list form: the body, an optional separator, and the index variable '
            + 'it ranges over. Ott expands it into a list in generated code.',
        example: ['</ ti // , // i />', '</ ti // i IN 1 .. n />'],
        doc: 'guide/list-forms.rst', docTitle: 'List forms',
    },
    '[[': {
        title: 'Splice',
        summary: 'Inside a homomorphism, substitutes the generated text for an element '
            + 'of the enclosing production. Splices nest.',
        example: ['| ( e )   :: S :: paren', '  {{ lean ([[e]]) }}'],
        doc: 'reference/homomorphisms.rst', docTitle: 'Homomorphisms',
    },
    '{{': {
        title: 'Homomorphism',
        summary: 'Attaches a translation for one backend to the construct it follows. '
            + 'What the body means depends on the target: `com` is prose, `tex` is '
            + 'LaTeX, `coq`/`lean`/`isa` are that assistant\'s syntax.',
        example: ['{{ com application }}', '{{ tex [[e1]]\;[[e2]] }}'],
        doc: 'reference/homomorphisms.rst', docTitle: 'Homomorphisms',
    },
};

/** `terminals` is a grammar rule, not a keyword, so it is documented separately. */
export const TERMINALS_DOC: KeywordDoc = {
    title: 'Terminals rule',
    summary: 'An ordinary grammar rule, named `terminals` by convention, holding the '
        + 'object language\'s symbols so they can be given LaTeX in one place. Despite '
        + 'what the syntax reference says, it is not a top-level item of its own.',
    example: [
        'terminals :: \'terminals_\' ::=',
        '  | ->     ::   :: rightarrow   {{ tex \\rightarrow }}',
        '  | |-     ::   :: turnstile    {{ tex \\vdash }}',
    ],
    doc: 'guide/latex-output.rst', docTitle: 'LaTeX output',
};

/** The reference block for a keyword, as markdown lines. */
export function renderKeywordDoc(
    keyword: string, entry: KeywordDoc, baseUrl: string,
): string[] {
    const lines = [
        `**${entry.title}** — \`${keyword}\``,
        '',
        entry.summary,
        '',
        '```ott',
        ...entry.example,
        '```',
    ];
    if (entry.doc && baseUrl) {
        const base = baseUrl.replace(/\/+$/, '');
        lines.push('', `[${entry.docTitle ?? 'Documentation'}](${base}/${entry.doc})`);
    }
    return lines;
}
