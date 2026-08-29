grammar Ott

entry SourceFile:
    header+=HeaderDecl* items+=Item*;

Item:
    MetavarDefn | GrammarBlock | EmbedBlock | SubrulesBlock | DefnClass | FunsBlock
    | SubstitutionsBlock | FreevarsBlock | ParsingBlock | HomsBlock;

// ──────────────────────────────────────
// Module header
// ──────────────────────────────────────

// `module` / `extends` / `imports` / `renaming` / `as` are contextual keywords,
// recognised only before the first item — OttTokenBuilder gates them on the
// header region so that a production named `module` still parses. The header
// items may appear in any order and repeat; upstream rejects a second `module`
// during typechecking rather than in the grammar, and we mirror that.
HeaderDecl:
    ModuleDecl | ExtendsDecl | ImportsDecl;

ModuleDecl:
    'module' name=ModuleName;

// `extends` shares upstream's `import_decl`, so it accepts `renaming` too. That
// is undocumented but it parses, so we accept it rather than diverging.
ExtendsDecl:
    'extends' module=ModuleName renaming=RenamingList?;

ImportsDecl:
    'imports' module=ModuleName renaming=RenamingList?;

RenamingList:
    'renaming' renamings+=Renaming (',' renamings+=Renaming)*;

Renaming:
    from=ModuleName 'as' to=ModuleName;

// A module name is upstream's STRING: a bare or single-quoted identifier.
ModuleName returns string:
    ID | NAMESPACE_PREFIX;

// ──────────────────────────────────────
// Metavariable definitions
// ──────────────────────────────────────

MetavarDefn:
    kind=MetavarKind names+=StringDesc (',' names+=StringDesc)* '::=' homomorphisms+=Homomorphism*;

MetavarKind returns string:
    'metavar' | 'indexvar';

// ──────────────────────────────────────
// Grammar rules
// ──────────────────────────────────────

GrammarBlock:
    'grammar' rules+=GrammarRule*;

GrammarRule:
    names+=StringDesc (',' names+=StringDesc)* '::' namespace=NamespacePrefix '::=' homomorphisms+=Homomorphism* productions+=Production*;

Production:
    '|' elements+=ProductionElement* '::' modifiers+=Name* '::' name=Name
    (homomorphisms+=Homomorphism | bindspecs+=BindSpec)*;

ProductionElement:
    Comprehension | Dots | ProductionStringElement;

// Productions can contain '|' mid-element (e.g., case ... | ...).
ProductionStringElement:
    value=(ID | ELEMENT_STRING | INT | NAMESPACE_PREFIX | '::=' | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}' | 'fun' | '<=');

BindSpec:
    '(+' body+=BindSpecElement* '+)';

BindSpecElement:
    Comprehension | Dots | BindSpecToken;

BindSpecToken:
    value=(ID | ELEMENT_STRING | INT | NAMESPACE_PREFIX | '::=' | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}' | 'fun' | '<=');

// ──────────────────────────────────────
// Definition classes (inference rules)
// ──────────────────────────────────────

DefnClass:
    'defns' name=Name '::' namespace=NamespacePrefix '::=' homomorphisms+=Homomorphism* definitions+=Defn*;

// The body after 'by' is a flat sequence of elements and rule separators,
// because Ott's line-oriented rule structure doesn't map to LL parsing with hidden newlines.
// `defn <elements> :: <categories> :: <name> :: <texwrapper>` — four fields,
// not three: the category list (`E |- ok :: M :: Eok :: Eok_`) is usually empty,
// which is why `:: ::` is the shape most files show.
Defn:
    'defn' elements+=DefnElement* '::' categories+=Name* '::' name=Name '::' namespace=NamespacePrefix
    (homomorphisms+=Homomorphism | bindspecs+=BindSpec)* 'by' body+=DefnBodyItem*;

DefnElement:
    Comprehension | Dots | DefnStringElement;

// Defn elements can also contain '|' and ','.
DefnStringElement:
    value=(ID | ELEMENT_STRING | INT | NAMESPACE_PREFIX | '::=' | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}' | 'fun' | '<=');

DefnBodyItem:
    RuleSeparator | DefnComment | DefnBodyElement;

// A `{{ com ... }}` block between rules in a defn body. Keyed on the `com`
// marker (Ott's DEFNCOM token) so it is not confused with object-language
// record literals like `{{ field = v }` — those fall through to text below.
DefnComment:
    '{{' 'com' body+=HomElement* '}}';

// Defn body elements can contain '|' ',' and 'IN' (which is not a keyword here).
DefnBodyElement:
    Comprehension | Dots | DefnBodyStringElement;

// Defn-body lines are object-language text: they may contain '::' (list cons
// `e0 :: e`) and both object record literals `{{ ... }` and `{{ com ... }}`
// comment blocks, which we consume as flat tokens. A rule separator is still
// unambiguous via its leading DASH_LINE.
// Note: 'fun' is deliberately NOT allowed here — a fundefn body must terminate
// at the next `fun` clause (see Fundefn); standalone `fun` never appears as
// object text inside a defn/fundefn body anyway.
DefnBodyStringElement:
    value=(ID | ELEMENT_STRING | INT | NAMESPACE_PREFIX | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}' | '::' | '::=' | '{{' | '}}' | '<=');

// A rule separator line: dashes, an optional category list, then `:: name`
// (mirrors Ott's `ident_list COLONCOLON STRING homomorphism_list`).
RuleSeparator:
    line=DASH_LINE categories+=Name* '::' name=Name homomorphisms+=Homomorphism*;

// ──────────────────────────────────────
// Function definitions (funs blocks)
// ──────────────────────────────────────

// `funs <name> ::= <homs> <fundefns>` — Ott's fundefnclass.
FunsBlock:
    'funs' name=Name '::=' homomorphisms+=Homomorphism* fundefns+=Fundefn*;

// `fun <elements> :: <result> :: <name> <homs> by <body>` — the body is a
// free-text clause list, consumed as the same flat token soup as a defn body.
Fundefn:
    'fun' elements+=DefnElement* '::' result=Name '::' name=Name
    homomorphisms+=Homomorphism* 'by' body+=DefnBodyItem*;

// ──────────────────────────────────────
// Elements (shared for non-production, non-defn contexts)
// ──────────────────────────────────────

Dots:
    value=DotKind;

DotKind returns string:
    '..' | '...' | '....';

Comprehension:
    '</' elements+=ComprehensionElement* '//' (separator=ComprehensionSep '//')? bound=ComprehensionBound '/>';

// Comprehensions nest: `</ methl' notin </ methk // k /> ... // l />`
// (tex/lj_common.ott:891), and homs splice them as `[[ </ [[ti]] // ',' // i /> ]]`.
ComprehensionElement:
    Comprehension | Dots | ComprehensionStringElement;

ComprehensionStringElement:
    value=(ID | ELEMENT_STRING | INT | NAMESPACE_PREFIX | '::=' | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}' | 'fun' | '<=');

ComprehensionSep:
    value=(ID | ELEMENT_STRING | INT | ',' | '|' | '.' | '/' | 'fun' | '<=');

// 'IN' is not a keyword — we match it as an ID and check structurally.
// ComprehensionBound: var (ID upper)? (.. (ID|INT))?
// This handles: i, i IN n, i IN 1..n
ComprehensionBound:
    variable=ID (in=ID lower=(ID | INT) ('..' upper=(ID | INT) offset=ELEMENT_STRING?)?)?;

// ──────────────────────────────────────
// Homomorphisms
// ──────────────────────────────────────

Homomorphism:
    '{{' name=HomName body+=HomElement* '}}';

// `com` is a keyword (see DefnComment); accept it as a hom name so ordinary
// `{{ com ... }}` homomorphisms outside defn bodies still parse.
HomName:
    value=(ID | ELEMENT_STRING | 'com');

HomElement:
    HomInnerBlock | HomDots | HomString;

// Inside hom bodies, almost any token can appear — including all grammar keywords,
// since target-language code (Coq, HOL, Isabelle, etc.) freely uses words like "by".
HomString:
    value=(ID | ELEMENT_STRING | INT | NAMESPACE_PREFIX | ',' | '|' | '.' | '/' | '<' | '>' | '{' | '}' | '::' | '::=' | '</' | '/>' | '//'
        | '(+' | '+)' | '<::'
        | 'by' | 'grammar' | 'metavar' | 'indexvar' | 'defns' | 'defn' | 'embed' | 'subrules'
        | 'substitutions' | 'freevars' | 'parsing' | 'single' | 'multiple' | 'left' | 'right' | 'nonassoc' | 'prec' | 'com' | 'fun' | 'homs' | '<=');

HomDots:
    value=DotKind;

HomInnerBlock:
    '[[' content+=HomInnerElement* ']]';

HomInnerElement:
    HomInnerComprehension | HomInnerDots | HomInnerString;

HomInnerString:
    value=(ID | ELEMENT_STRING | INT | NAMESPACE_PREFIX | ',' | '|' | '.' | '/' | '<' | '>' | '{' | '}'
        | 'by' | 'grammar' | 'metavar' | 'indexvar' | 'defns' | 'defn' | 'embed' | 'subrules'
        | 'substitutions' | 'freevars' | 'parsing' | 'single' | 'multiple' | 'left' | 'right' | 'nonassoc' | 'prec' | 'com' | 'fun' | 'homs' | '<=');

HomInnerDots:
    value=DotKind;

HomInnerComprehension:
    '</' elements+=HomInnerElement* '//' bound=ComprehensionBound '/>';

// ──────────────────────────────────────
// Subrules
// ──────────────────────────────────────

SubrulesBlock:
    'subrules' entries+=SubruleEntry+;

SubruleEntry:
    sub=Name '<::' super=Name homomorphisms+=Homomorphism*;

// ──────────────────────────────────────
// Homs block
// ──────────────────────────────────────

// `homs <wrapper> ( :: <prodname> <bindspecs> <homs> )*` — attaches homs to
// productions of an already-declared rule from a separate block
// (grammar_parser.mly:564-575).
HomsBlock:
    'homs' wrapper=Name entries+=HomsEntry*;

HomsEntry:
    '::' name=Name (homomorphisms+=Homomorphism | bindspecs+=BindSpec)*;

// ──────────────────────────────────────
// Embed
// ──────────────────────────────────────

EmbedBlock:
    'embed' homomorphisms+=Homomorphism+;

// ──────────────────────────────────────
// Substitutions and free variables
// ──────────────────────────────────────

SubstitutionsBlock:
    'substitutions' entries+=SubstitutionEntry+;

SubstitutionEntry:
    kind=SubstitutionKind nonterminal=Name metavar=Name '::' name=Name;

SubstitutionKind returns string:
    'single' | 'multiple';

FreevarsBlock:
    'freevars' entries+=FreevarEntry+;

FreevarEntry:
    nonterminal=Name metavar=Name '::' name=Name;

// ──────────────────────────────────────
// Parsing directives
// ──────────────────────────────────────

ParsingBlock:
    'parsing' directives+=ParsingDirective+;

ParsingDirective:
    nonterminal=Name (('prec' level=INT) | assoc=AssocKind nonterminal2=Name?);

// `<=` is Ott's precedence-ordering directive (`P_tuple <= P_construct`); it
// shares this production with the associativity keywords.
AssocKind returns string:
    'left' | 'right' | 'nonassoc' | '<=';

// ──────────────────────────────────────
// String with homomorphism description
// ──────────────────────────────────────

StringDesc:
    name=Name homomorphisms+=Homomorphism*;

// ──────────────────────────────────────
// Names
// ──────────────────────────────────────

// Ott's `maybe_quoted_ident` (grammar_lexer.mll:235):
//     pre_ident | "'" pre_ident "'" | "''"
// Every name position accepts all three forms, so a production name may be
// numeric (`:: 1`), quoted (`:: 'fun'` — quoting is how a name colliding with
// Ott's own syntax is written) or the empty name `''`.
Name returns string:
    ID | INT | NAMESPACE_PREFIX;

// ──────────────────────────────────────
// Namespace prefix
// ──────────────────────────────────────

NamespacePrefix:
    {infer NamespacePrefix} (value=NAMESPACE_PREFIX | value=ID);

// ──────────────────────────────────────
// Terminals (order matters: first declared wins for same-length match)
// ──────────────────────────────────────

// COMMENT and BLOCK_COMMENT get context-sensitive custom matchers from
// OttTokenBuilder (see ott-token-builder.ts). The regex bodies here are only
// placeholders / fallbacks; declaration order matters, so BLOCK_COMMENT is first
// (it must win over COMMENT at a `%d>>` opener line).
hidden terminal BLOCK_COMMENT: />>[\s\S]*?<</;
hidden terminal COMMENT: /%[^\n\r]*/;
hidden terminal WS: /[ \t]+/;
hidden terminal NL: /\r?\n/;

terminal DASH_LINE: /----[-]*/;
// Quoted namespace prefix including quotes: 'ty_', '', 'formula_'
terminal NAMESPACE_PREFIX: /'[^'\s]*'/;
// Ott's `pre_ident` (grammar_lexer.mll:234) is
//     [A-Za-z0-9_'][A-Za-z0-9_']*
// i.e. a name may *start with a digit* and may be all digits: `:: 1`, `:: 0`
// and `:: 1C` are all real production names in the corpus. ID is that set.
//
// INT is declared first so a pure-digit run still lexes as INT (comprehension
// bounds and `prec` levels need it); OttTokenBuilder gives INT a LONGER_ALT of
// ID so a digit-led name continuing into letters (`1C`) wins as one ID rather
// than splitting into INT + ID.
terminal INT: /\d+/;
terminal ID: /[a-zA-Z_0-9][\w']*/;
// Matches any non-whitespace run excluding , . / < > { } (so that // </ /> .. {{ }} split correctly).
// These excluded chars are available as keyword tokens in element rules.
// Single '[' and ']' are absorbed (object syntax like `[]`), but a run stops at
// a doubled '[[' or ']]' so those tokenize as the HomInnerBlock delimiters even
// when glued to text (e.g. `[[typevar1 ...]]`).
terminal ELEMENT_STRING: /((?!::)[^\s,.\/<>{}\[\]]|\[(?!\[)|\](?!\]))+/;
