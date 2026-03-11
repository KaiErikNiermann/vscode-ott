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

// In Ott source, productions start with '|' but since '|' can also
// appear in element text (like '|-'), we treat it as part of the elements.
Production:
    elements+=Element+ '::' modifiers+=ID* '::' name=ID homomorphisms+=Homomorphism*;

// ──────────────────────────────────────
// Definition classes (inference rules)
// ──────────────────────────────────────

DefnClass:
    'defns' name=ID '::' namespace=NamespacePrefix '::=' homomorphisms+=Homomorphism* definitions+=Defn*;

// The body after 'by' is a flat sequence of elements and rule separators,
// because Ott's line-oriented rule structure doesn't map to LL parsing with hidden newlines.
Defn:
    'defn' elements+=Element* '::' '::' name=ID '::' namespace=NamespacePrefix homomorphisms+=Homomorphism* 'by' body+=DefnBodyItem*;

DefnBodyItem:
    RuleSeparator | Element;

RuleSeparator:
    line=DASH_LINE '::' name=ID;

// ──────────────────────────────────────
// Elements (shared building blocks)
// ──────────────────────────────────────

Element:
    Comprehension | Dots | StringElement;

StringElement:
    value=(ID | ELEMENT_STRING);

// Dot forms are keywords so they take priority over ELEMENT_STRING.
Dots:
    value=DotKind;

DotKind returns string:
    '..' | '...' | '....';

Comprehension:
    '</' elements+=Element* '//' (separator=(ID | ELEMENT_STRING | ',') '//')? bound=ComprehensionBound '/>';

ComprehensionBound:
    variable=ID ('IN' lower=(ID | INT) ('..' upper=(ID | INT))?)?;

// ──────────────────────────────────────
// Homomorphisms
// ──────────────────────────────────────

Homomorphism:
    '{{' name=HomName body+=HomElement* '}}';

HomName:
    value=ID;

HomElement:
    HomInnerBlock | HomDots | HomString;

HomString:
    value=(ID | ELEMENT_STRING);

HomDots:
    value=DotKind;

HomInnerBlock:
    '[[' content+=HomInnerElement* ']]';

HomInnerElement:
    HomInnerComprehension | HomInnerDots | HomInnerString;

HomInnerString:
    value=(ID | ELEMENT_STRING);

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
    nonterminal=ID (('prec' level=INT) | assoc=AssocKind);

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
    {infer NamespacePrefix} ("'" value=ID? "'" | value=ID | value=ELEMENT_STRING);

// ──────────────────────────────────────
// Terminals (order matters: first declared wins for same-length match)
// ──────────────────────────────────────

hidden terminal WS: /[ \t]+/;
hidden terminal NL: /\r?\n/;
hidden terminal COMMENT: /%[^\n\r]*/;

terminal DASH_LINE: /----[-]*/;
terminal ID: /[a-zA-Z_]\w*/;
terminal INT returns number: /\d+/;
// Matches non-whitespace runs excluding chars used in keywords/delimiters: , ' { } [ ] < > /
// Notably includes | : - ( ) . so that |- |= : () etc. work as single tokens.
// Keywords like '::' '::=' '..' '...' '....' take priority over this for exact matches.
terminal ELEMENT_STRING: /[^\s,'{}[\]<>/][^\s,'{}[\]<>/]*/;
