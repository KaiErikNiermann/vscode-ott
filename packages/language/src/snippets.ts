/**
 * Scaffolds for Ott's constructs.
 *
 * These are served as LSP completion items rather than contributed through
 * `contributes.snippets`, which is what lets them be gated on context: VS Code
 * merges client-side snippets into the completion list itself, after the server
 * has replied, so a server has no way to suppress one that does not belong
 * where the cursor is. The cost is that they do not appear under the
 * `Insert Snippet` command; the benefit is that `defns` is never offered in the
 * middle of an inference rule.
 *
 * `contextrules` has no scaffold on purpose: `ott.langium` has no rule for it
 * yet, so offering one would hand the user a parse error from a completion we
 * suggested.
 *
 * Each body is written the way Ott actually wants it — the blank line after
 * `by` that `semiraw_rule_list` requires before every rule, the four fields of
 * a `defn` header, the two `::` of a production — because the layout is exactly
 * what a newcomer gets wrong, and a scaffold that has to be corrected is worse
 * than none.
 */

/**
 * Where a scaffold may be offered.
 *
 * `item` is the whole top level. Ott's lexer decides an item keyword by taking
 * the first word of a *line* (`grammar_lexer.mll:436-460`), so every one of
 * these is only ever legal at the start of a line — which is also what resolves
 * the genuine ambiguity at the end of a defn body, where both the next
 * inference rule and the next top-level item are legal continuations.
 */
export type SnippetContext =
    | 'header'      // before the first item, where module/extends/imports lex
    | 'item'        // the start of any line outside the header
    | 'grammar'     // inside a `grammar` block
    | 'defns'       // inside a `defns` block
    | 'defn-body'   // inside a defn or fundefn body, after `by`
    | 'funs'        // inside a `funs` block
    | 'hom'         // after a production's name, where homs and bindspecs go
    | 'element';    // among the elements of a production or a rule body

export interface Snippet {
    /** What the user types. */
    readonly prefix: string;
    /** One line, shown beside the prefix. */
    readonly detail: string;
    /** Snippet-syntax body, `\n`-joined. */
    readonly body: readonly string[];
    readonly contexts: readonly SnippetContext[];
}

/** A bar wide enough to be recognisable; `ott.format.rules.bar` fits it later. */
const BAR = '-'.repeat(32);

export const SNIPPETS: readonly Snippet[] = [
    // ── The module header ────────────────────────────────────
    {
        prefix: 'module', detail: 'declare this file\'s module',
        body: ['module ${1:name}'], contexts: ['header'],
    },
    {
        prefix: 'extends', detail: 'inherit another module\'s roots under their own names',
        body: ['extends ${1:name}'], contexts: ['header'],
    },
    {
        prefix: 'imports', detail: 'inherit another module\'s roots under new names',
        body: ['imports ${1:name} renaming ${2:t} as ${3:a_t}'], contexts: ['header'],
    },

    // ── Top-level items ──────────────────────────────────────
    {
        prefix: 'metavar', detail: 'declare a metavariable',
        body: ['metavar ${1:var}, ${2:x} ::=', '  {{ com ${3:term variables} }}'],
        contexts: ['item'],
    },
    {
        prefix: 'indexvar', detail: 'declare an index variable, for list forms',
        body: ['indexvar ${1:i}, ${2:j} ::='], contexts: ['item'],
    },
    {
        prefix: 'grammar', detail: 'open a grammar block',
        body: [
            'grammar',
            '',
            '${1:t} :: \'${2:t}_\' ::= {{ com ${3:terms} }}',
            '  | ${4:x}   ::   :: ${5:var}',
        ],
        contexts: ['item'],
    },
    {
        prefix: 'terminals', detail: 'a grammar rule for terminals and their LaTeX',
        body: [
            'terminals :: \'terminals_\' ::=',
            '  | ${1:->}   ::   :: ${2:rightarrow}   {{ tex \\\\${3:rightarrow} }}',
        ],
        contexts: ['grammar'],
    },
    {
        prefix: 'subrules', detail: 'declare a syntactic subset',
        body: ['subrules', '  ${1:v} <:: ${2:t}'], contexts: ['item'],
    },
    {
        prefix: 'substitutions', detail: 'ask for a substitution function',
        body: ['substitutions', '  single ${1:t} ${2:x} :: subst'], contexts: ['item'],
    },
    {
        prefix: 'freevars', detail: 'ask for a free-variable function',
        body: ['freevars', '  ${1:t} ${2:x} :: fv'], contexts: ['item'],
    },
    {
        prefix: 'parsing', detail: 'resolve an ambiguity by production priority',
        body: ['parsing', '  ${1:t_app} <= ${2:t_abs}'], contexts: ['item'],
    },
    {
        prefix: 'embed', detail: 'pass text straight through to a backend',
        body: ['embed', '{{ ${1|tex,coq,lean,isa,hol,ocaml|} ${2} }}'], contexts: ['item'],
    },
    {
        prefix: 'homs', detail: 'attach homomorphisms to productions declared elsewhere',
        body: ['homs \'${1:t}_\'', '  :: ${2:Var}   {{ com ${3:variable} }}'],
        contexts: ['item'],
    },
    {
        prefix: 'defns', detail: 'open a block of judgement forms',
        body: [
            'defns',
            '${1:J} :: \'\' ::=',
            '',
            'defn',
            '${2:G |- e : T} :: :: ${3:typing} :: \'${3:typing}_\'',
            '{{ com ${4:typing} }}',
            'by',
            '',
            '${5:premise}',
            `${BAR} :: \${6:rule}`,
            '${7:conclusion}',
        ],
        contexts: ['item'],
    },
    {
        prefix: 'funs', detail: 'open a block of function definitions',
        body: [
            'funs',
            '${1:F} ::=',
            '',
            'fun',
            '${2:f ( x )} :: ${3:t} :: ${4:name} by',
            '',
            '${5:f ( a )} === ${6:b}',
        ],
        contexts: ['item'],
    },

    // ── Inside a block ───────────────────────────────────────
    {
        prefix: 'rule', detail: 'a grammar rule (nonterminal and its productions)',
        body: [
            '${1:t} :: \'${2:t}_\' ::= {{ com ${3:terms} }}',
            '  | ${4:x}   ::   :: ${5:var}',
        ],
        contexts: ['grammar'],
    },
    {
        prefix: 'production', detail: 'one production of a grammar rule',
        body: ['| ${1:elements}   :: ${2|,M,S,I|} :: ${3:name}'],
        contexts: ['grammar'],
    },
    {
        prefix: 'defn', detail: 'a judgement form',
        body: [
            'defn',
            '${1:G |- e : T} :: :: ${2:typing} :: \'${2:typing}_\'',
            '{{ com ${3:typing} }}',
            'by',
            '',
            '${4:premise}',
            `${BAR} :: \${5:rule}`,
            '${6:conclusion}',
        ],
        contexts: ['defns'],
    },
    {
        prefix: 'fun', detail: 'a function definition clause',
        body: ['fun', '${1:f ( x )} :: ${2:t} :: ${3:name} by', '', '${4:f ( a )} === ${5:b}'],
        contexts: ['funs'],
    },

    // ── Inside a defn body ───────────────────────────────────
    {
        prefix: 'inferrule', detail: 'an inference rule: premises, bar, conclusion',
        body: ['${1:premise}', `${BAR} :: \${2:name}`, '${3:conclusion}'],
        contexts: ['defn-body'],
    },
    {
        prefix: 'axiom', detail: 'an inference rule with no premises',
        body: [`${BAR} :: \${1:name}`, '${2:conclusion}'],
        contexts: ['defn-body'],
    },

    // ── Attached mid-line ────────────────────────────────────
    {
        prefix: 'com', detail: 'a comment, rendered into the LaTeX output',
        body: ['{{ com ${1:description} }}'], contexts: ['hom'],
    },
    {
        prefix: 'tex', detail: 'LaTeX rendering for this construct',
        body: ['{{ tex ${1} }}'], contexts: ['hom'],
    },
    {
        prefix: 'bind', detail: 'a binding specification',
        body: ['(+ bind ${1:x} in ${2:e} +)'], contexts: ['hom'],
    },
    {
        prefix: 'comprehension', detail: 'a list form over an index variable',
        body: ['</ ${1:ti} // ${2:,} // ${3:i} />'], contexts: ['element'],
    },
];
