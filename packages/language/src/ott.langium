grammar Ott

entry SourceFile:
    items+=Item*;

Item:
    MetavarDefn | GrammarBlock | EmbedBlock | SubrulesBlock | DefnClass | FunsBlock
    | SubstitutionsBlock | FreevarsBlock | ParsingBlock;

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
    '|' elements+=ProductionElement* '::' modifiers+=ID* '::' name=ID
    (homomorphisms+=Homomorphism | bindspecs+=BindSpec)*;

ProductionElement:
    Comprehension | Dots | ProductionStringElement;

// Productions can contain '|' mid-element (e.g., case ... | ...).
ProductionStringElement:
    value=(ID | ELEMENT_STRING | INT | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}' | 'fun' | '<=');

BindSpec:
    '(+' body+=BindSpecElement+ '+)';

BindSpecElement:
    Dots | BindSpecToken;

BindSpecToken:
    value=(ID | ELEMENT_STRING | INT | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}' | 'fun' | '<=');

// ──────────────────────────────────────
// Definition classes (inference rules)
// ──────────────────────────────────────

DefnClass:
    'defns' name=ID '::' namespace=NamespacePrefix '::=' homomorphisms+=Homomorphism* definitions+=Defn*;

// The body after 'by' is a flat sequence of elements and rule separators,
// because Ott's line-oriented rule structure doesn't map to LL parsing with hidden newlines.
Defn:
    'defn' elements+=DefnElement* '::' '::' name=ID '::' namespace=NamespacePrefix
    (homomorphisms+=Homomorphism | bindspecs+=BindSpec)* 'by' body+=DefnBodyItem*;

DefnElement:
    Comprehension | Dots | DefnStringElement;

// Defn elements can also contain '|' and ','.
DefnStringElement:
    value=(ID | ELEMENT_STRING | INT | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}' | 'fun' | '<=');

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
    value=(ID | ELEMENT_STRING | INT | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}' | '::' | '{{' | '}}' | '<=');

// A rule separator line: dashes, an optional category list, then `:: name`
// (mirrors Ott's `ident_list COLONCOLON STRING homomorphism_list`).
RuleSeparator:
    line=DASH_LINE categories+=ID* '::' name=ID homomorphisms+=Homomorphism*;

// ──────────────────────────────────────
// Function definitions (funs blocks)
// ──────────────────────────────────────

// `funs <name> ::= <homs> <fundefns>` — Ott's fundefnclass.
FunsBlock:
    'funs' name=ID '::=' homomorphisms+=Homomorphism* fundefns+=Fundefn*;

// `fun <elements> :: <result> :: <name> <homs> by <body>` — the body is a
// free-text clause list, consumed as the same flat token soup as a defn body.
Fundefn:
    'fun' elements+=DefnElement* '::' result=ID '::' name=ID
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

ComprehensionElement:
    Dots | ComprehensionStringElement;

ComprehensionStringElement:
    value=(ID | ELEMENT_STRING | INT | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}' | 'fun' | '<=');

ComprehensionSep:
    value=(ID | ELEMENT_STRING | INT | ',' | '|' | '.' | '/' | 'fun' | '<=');

// 'IN' is not a keyword — we match it as an ID and check structurally.
// ComprehensionBound: var (ID upper)? (.. (ID|INT))?
// This handles: i, i IN n, i IN 1..n
ComprehensionBound:
    variable=ID (in=ID lower=(ID | INT) ('..' upper=(ID | INT))?)?;

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
        | 'substitutions' | 'freevars' | 'parsing' | 'single' | 'multiple' | 'left' | 'right' | 'nonassoc' | 'prec' | 'com' | 'fun' | '<=');

HomDots:
    value=DotKind;

HomInnerBlock:
    '[[' content+=HomInnerElement* ']]';

HomInnerElement:
    HomInnerComprehension | HomInnerDots | HomInnerString;

HomInnerString:
    value=(ID | ELEMENT_STRING | INT | NAMESPACE_PREFIX | ',' | '|' | '.' | '/' | '<' | '>' | '{' | '}'
        | 'by' | 'grammar' | 'metavar' | 'indexvar' | 'defns' | 'defn' | 'embed' | 'subrules'
        | 'substitutions' | 'freevars' | 'parsing' | 'single' | 'multiple' | 'left' | 'right' | 'nonassoc' | 'prec' | 'com' | 'fun' | '<=');

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
    sub=ID '<::' super=ID homomorphisms+=Homomorphism*;

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
    kind=SubstitutionKind nonterminal=ID metavar=ID '::' name=ID;

SubstitutionKind returns string:
    'single' | 'multiple';

FreevarsBlock:
    'freevars' entries+=FreevarEntry+;

FreevarEntry:
    nonterminal=ID metavar=ID '::' name=ID;

// ──────────────────────────────────────
// Parsing directives
// ──────────────────────────────────────

ParsingBlock:
    'parsing' directives+=ParsingDirective+;

ParsingDirective:
    nonterminal=ID (('prec' level=INT) | assoc=AssocKind nonterminal2=ID?);

// `<=` is Ott's precedence-ordering directive (`P_tuple <= P_construct`); it
// shares this production with the associativity keywords.
AssocKind returns string:
    'left' | 'right' | 'nonassoc' | '<=';

// ──────────────────────────────────────
// String with homomorphism description
// ──────────────────────────────────────

StringDesc:
    name=ID homomorphisms+=Homomorphism*;

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
terminal NAMESPACE_PREFIX: /'[\w-]*'/;
// Identifiers including primes for variables like t', x''
terminal ID: /[a-zA-Z_][\w']*/;
terminal INT: /\d+/;
// Matches any non-whitespace run excluding , . / < > { } (so that // </ /> .. {{ }} split correctly).
// These excluded chars are available as keyword tokens in element rules.
// Single '[' and ']' are absorbed (object syntax like `[]`), but a run stops at
// a doubled '[[' or ']]' so those tokenize as the HomInnerBlock delimiters even
// when glued to text (e.g. `[[typevar1 ...]]`).
terminal ELEMENT_STRING: /([^\s,.\/<>{}\[\]]|\[(?!\[)|\](?!\]))+/;
