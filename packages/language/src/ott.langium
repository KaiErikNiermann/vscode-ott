grammar Ott

entry SourceFile:
    items+=Item*;

Item:
    MetavarDefn | GrammarBlock | EmbedBlock | SubrulesBlock | DefnClass
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
    value=(ID | ELEMENT_STRING | INT | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}');

BindSpec:
    '(+' body+=BindSpecToken+ '+)';

BindSpecToken:
    value=(ID | ELEMENT_STRING | INT | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}');

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
    value=(ID | ELEMENT_STRING | INT | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}');

DefnBodyItem:
    RuleSeparator | DefnBodyElement;

// Defn body elements can contain '|' ',' and 'IN' (which is not a keyword here).
DefnBodyElement:
    Comprehension | Dots | DefnBodyStringElement;

DefnBodyStringElement:
    value=(ID | ELEMENT_STRING | INT | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}');

RuleSeparator:
    line=DASH_LINE '::' name=ID;

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
    value=(ID | ELEMENT_STRING | INT | '|' | ',' | '.' | '/' | '<' | '>' | '{' | '}');

ComprehensionSep:
    value=(ID | ELEMENT_STRING | INT | ',' | '|' | '.' | '/');

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

HomName:
    value=(ID | ELEMENT_STRING);

HomElement:
    HomInnerBlock | HomDots | HomString;

// Inside hom bodies, almost any token can appear — including all grammar keywords,
// since target-language code (Coq, HOL, Isabelle, etc.) freely uses words like "by".
HomString:
    value=(ID | ELEMENT_STRING | INT | ',' | '|' | '.' | '/' | '<' | '>' | '{' | '}' | '::' | '::=' | '</' | '/>' | '//'
        | '(+' | '+)' | '<::'
        | 'by' | 'grammar' | 'metavar' | 'indexvar' | 'defns' | 'defn' | 'embed' | 'subrules'
        | 'substitutions' | 'freevars' | 'parsing' | 'single' | 'multiple' | 'left' | 'right' | 'nonassoc' | 'prec');

HomDots:
    value=DotKind;

HomInnerBlock:
    '[[' content+=HomInnerElement* ']]';

HomInnerElement:
    HomInnerComprehension | HomInnerDots | HomInnerString;

HomInnerString:
    value=(ID | ELEMENT_STRING | INT | ',' | '|' | '.' | '/' | '<' | '>' | '{' | '}'
        | 'by' | 'grammar' | 'metavar' | 'indexvar' | 'defns' | 'defn' | 'embed' | 'subrules'
        | 'substitutions' | 'freevars' | 'parsing' | 'single' | 'multiple' | 'left' | 'right' | 'nonassoc' | 'prec');

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

AssocKind returns string:
    'left' | 'right' | 'nonassoc';

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

hidden terminal WS: /[ \t]+/;
hidden terminal NL: /\r?\n/;
hidden terminal COMMENT: /%[^\n\r]*/;

terminal DASH_LINE: /----[-]*/;
// Quoted namespace prefix including quotes: 'ty_', '', 'formula_'
terminal NAMESPACE_PREFIX: /'[\w-]*'/;
// Identifiers including primes for variables like t', x''
terminal ID: /[a-zA-Z_][\w']*/;
terminal INT: /\d+/;
// Matches any non-whitespace run excluding , . / < > { } (so that // </ /> .. {{ }} split correctly).
// These excluded chars are available as keyword tokens in element rules.
terminal ELEMENT_STRING: /[^\s,./<>{}][^\s,./<>{}]*/;
