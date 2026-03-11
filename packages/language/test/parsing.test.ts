import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem, type LangiumDocument } from "langium";
import { parseHelper } from "langium/test";
import type { SourceFile } from "ott-language";
import { createOttServices, isSourceFile } from "ott-language";

let services: ReturnType<typeof createOttServices>;
let parse: ReturnType<typeof parseHelper<SourceFile>>;

beforeAll(async () => {
    services = createOttServices(EmptyFileSystem);
    parse = parseHelper<SourceFile>(services.Ott);
});

function expectNoErrors(document: LangiumDocument<SourceFile>) {
    const errors = document.parseResult.parserErrors;
    if (errors.length > 0) {
        const msgs = errors.map(e => `${e.message} at ${e.token?.startLine}:${e.token?.startColumn}`);
        expect.fail(`Parser errors:\n  ${msgs.join('\n  ')}`);
    }
    expect(document.parseResult.value).toBeDefined();
    expect(isSourceFile(document.parseResult.value)).toBe(true);
}

describe('Metavar and indexvar', () => {

    test('parse metavar definition', async () => {
        const doc = await parse('metavar x, y ::=');
        expectNoErrors(doc);
        expect(doc.parseResult.value.items).toHaveLength(1);
    });

    test('parse metavar with homomorphism', async () => {
        const doc = await parse(
            'metavar termvar, x {{ tex \\mathsf }} ::='
        );
        expectNoErrors(doc);
    });

    test('parse indexvar definition', async () => {
        const doc = await parse('indexvar i, j, k ::=');
        expectNoErrors(doc);
    });

    test('parse metavar with multiple homomorphisms', async () => {
        const doc = await parse(
            "metavar termvar, x ::=\n" +
            "  {{ isa string }} {{ coq nat }} {{ coq-equality }} {{ hol string }}\n" +
            "  {{ lex alphanum }} {{ tex \\mathsf{[[termvar]]} }}"
        );
        expectNoErrors(doc);
    });
});

describe('Grammar rules', () => {

    test('parse grammar with productions', async () => {
        const doc = await parse(
            "grammar\nt :: 'ty_' ::=\n  | a :: :: var\n  | t1 -> t2 :: :: arrow"
        );
        expectNoErrors(doc);
    });

    test('parse grammar with multiple names', async () => {
        const doc = await parse(
            "grammar\ntype, t :: 'ty_' ::=\n  | base :: :: base"
        );
        expectNoErrors(doc);
    });

    test('parse grammar with production modifiers', async () => {
        const doc = await parse(
            "grammar\nt :: 'ty_' ::=\n  | ( t ) :: S :: paren"
        );
        expectNoErrors(doc);
    });

    test('parse grammar with empty namespace prefix', async () => {
        const doc = await parse(
            "grammar\nt :: '' ::=\n  | x :: :: var"
        );
        expectNoErrors(doc);
    });

    test('parse grammar with unquoted namespace prefix', async () => {
        const doc = await parse(
            "grammar\nt :: Tm ::=\n  | x :: :: var"
        );
        expectNoErrors(doc);
    });

    test('parse multiple grammar rules in one block', async () => {
        const doc = await parse(
            "grammar\n" +
            "t :: Tm ::=\n  | x :: :: Var\n  | \\x.t :: :: Abs\n  | t1 t2 :: :: App\n\n" +
            "v :: Va ::=\n  | \\x.t :: :: Abs"
        );
        expectNoErrors(doc);
    });

    test('parse terminals rule', async () => {
        const doc = await parse(
            "grammar\nterminals :: 'terminals_' ::=\n" +
            "  | --> :: :: longrightarrow {{ tex \\longrightarrow }}\n" +
            "  | -> :: :: rightarrow {{ tex \\rightarrow }}\n" +
            "  | |- :: :: vdash {{ tex \\vdash }}\n" +
            "  | <: :: :: subtype {{ tex <: }}"
        );
        expectNoErrors(doc);
    });

    test('parse formula rule', async () => {
        const doc = await parse(
            "grammar\nformula :: 'formula_' ::=\n" +
            "  | judgement :: :: judgement"
        );
        expectNoErrors(doc);
    });

    test('parse production with bind spec', async () => {
        const doc = await parse(
            "grammar\nt :: Tm ::=\n" +
            "  | \\x.t :: :: Abs (+ bind x in t +) {{ com abstraction }}"
        );
        expectNoErrors(doc);
    });

    test('parse production with multiple bind specs', async () => {
        const doc = await parse(
            "grammar\nt :: Tm ::=\n" +
            "  | case t of inl x1 => t1 | inr x2 => t2 :: :: Case\n" +
            "    (+ bind x1 in t1 +) (+ bind x2 in t2 +) {{ com case }}"
        );
        expectNoErrors(doc);
    });

    test('parse production with pipe in elements', async () => {
        const doc = await parse(
            "grammar\nt :: Tm ::=\n" +
            "  | case t of inl x => t1 | inr y => t2 :: :: Case"
        );
        expectNoErrors(doc);
    });

    test('parse grammar rule with inline homomorphisms', async () => {
        const doc = await parse(
            "grammar\n" +
            "G {{ tex \\Gamma }} :: G_ ::= {{ com contexts: }}\n" +
            "  | empty :: :: empty\n" +
            "  | G , x : T :: :: vn"
        );
        expectNoErrors(doc);
    });
});

describe('Definition classes', () => {

    test('parse defnclass with inference rule', async () => {
        const doc = await parse(
            "defns Jop :: '' ::=\n\n" +
            "defn t --> t' :: :: red :: 'E_'\n" +
            "by\n\n" +
            "---- :: T_Var\n" +
            "G |- x : t"
        );
        expectNoErrors(doc);
    });

    test('parse defn rule with multiple premises', async () => {
        const doc = await parse(
            "defns typing :: '' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\n" +
            "by\n\n" +
            "G |- e1 : t1 -> t2\n" +
            "G |- e2 : t1\n" +
            "---- :: T_App\n" +
            "G |- e1 e2 : t2"
        );
        expectNoErrors(doc);
    });

    test('parse multiple defns in a class', async () => {
        const doc = await parse(
            "defns typing :: '' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\n" +
            "by\n\n" +
            "---- :: T_Unit\n" +
            "G |- unit : Unit\n\n" +
            "defn G |- ok :: :: ctx_ok :: 'ctx_'\n" +
            "by\n\n" +
            "---- :: Ctx_Empty\n" +
            "empty |- ok"
        );
        expectNoErrors(doc);
    });

    test('parse defn body with commas and turnstiles', async () => {
        const doc = await parse(
            "defns typing :: '' ::=\n\n" +
            "defn G |- e : T :: :: typing :: 'T_'\n" +
            "by\n\n" +
            "G, x:T1 |- e : T2\n" +
            "---- :: abs\n" +
            "G |- \\x.e : T1 -> T2"
        );
        expectNoErrors(doc);
    });
});

describe('Comprehensions', () => {

    test('parse simple comprehension', async () => {
        const doc = await parse(
            "grammar\nt :: 'ty_' ::=\n  | </ ti // i /> :: :: list"
        );
        expectNoErrors(doc);
    });

    test('parse comprehension with separator', async () => {
        const doc = await parse(
            "grammar\nt :: 'ty_' ::=\n  | </ ti // , // i /> :: :: commalist"
        );
        expectNoErrors(doc);
    });

    test('parse comprehension with range', async () => {
        const doc = await parse(
            "grammar\nt :: 'ty_' ::=\n  | </ ti // i IN 1 .. n /> :: :: rangelist"
        );
        expectNoErrors(doc);
    });

    test('parse compact comprehension without spaces', async () => {
        const doc = await parse(
            "defns Jop :: '' ::=\n\n" +
            "defn t --> t' :: :: red :: 'E_'\n" +
            "by\n\n" +
            "---- :: ProjRcd\n" +
            "{ </li=vi//i IN 1..n/> }.lj --> vj"
        );
        expectNoErrors(doc);
    });

    test('parse nested comprehensions in defn body', async () => {
        const doc = await parse(
            "defns Jtype :: '' ::=\n\n" +
            "defn T1 <: T2 :: :: subtyping :: 'S_'\n" +
            "by\n\n" +
            "---- :: RcdWidth\n" +
            "{ </li:Ti//i IN 1..m/> , </l'j:T'j//j IN 1..n/> } <: { </li:Ti//i IN 1..m/> }"
        );
        expectNoErrors(doc);
    });
});

describe('Other constructs', () => {

    test('parse subrules', async () => {
        const doc = await parse('subrules\nv <:: t');
        expectNoErrors(doc);
    });

    test('parse embed block', async () => {
        const doc = await parse(
            'embed {{ tex-preamble some preamble text }}'
        );
        expectNoErrors(doc);
    });

    test('parse multi-line embed', async () => {
        const doc = await parse(
            "embed\n{{ coq\nDefinition is_value (e : exp) : Prop :=\n" +
            "  match e with\n  | abs _ => True\n  | _ => False\n  end.\n}}"
        );
        expectNoErrors(doc);
    });

    test('parse substitutions block', async () => {
        const doc = await parse(
            'substitutions\nsingle t x :: tsubst'
        );
        expectNoErrors(doc);
    });

    test('parse freevars block', async () => {
        const doc = await parse('freevars\nt x :: fv');
        expectNoErrors(doc);
    });

    test('parse parsing directives', async () => {
        const doc = await parse('parsing\nt left');
        expectNoErrors(doc);
    });

    test('parse comments', async () => {
        const doc = await parse(
            "% This is a comment\nmetavar x ::=\n% Another comment"
        );
        expectNoErrors(doc);
    });

    test('parse dots in grammar', async () => {
        const doc = await parse(
            "grammar\nt :: 'ty_' ::=\n  | x1 .. xn :: :: sequence"
        );
        expectNoErrors(doc);
    });

    test('parse multiple items', async () => {
        const doc = await parse(
            "metavar x ::=\n" +
            "indexvar i ::=\n\n" +
            "grammar\nt :: 'ty_' ::=\n  | x :: :: var\n\n" +
            "subrules\nv <:: t"
        );
        expectNoErrors(doc);
        expect(doc.parseResult.value.items.length).toBeGreaterThanOrEqual(3);
    });
});
