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
    expect(document.parseResult.parserErrors).toHaveLength(0);
    expect(document.parseResult.value).toBeDefined();
    expect(isSourceFile(document.parseResult.value)).toBe(true);
}

describe('Parsing tests', () => {

    test('parse metavar definition', async () => {
        const document = await parse('metavar x, y ::=');
        expectNoErrors(document);
        const model = document.parseResult.value;
        expect(model.items).toHaveLength(1);
    });

    test('parse metavar with homomorphism', async () => {
        const document = await parse(
            'metavar termvar, x {{ tex \\mathit }} ::='
        );
        expectNoErrors(document);
    });

    test('parse indexvar definition', async () => {
        const document = await parse('indexvar i, j, k ::=');
        expectNoErrors(document);
    });

    test('parse grammar block with productions', async () => {
        const document = await parse(
            "grammar\nt :: 'ty_' ::=\n  | a :: :: var\n  | t1 -> t2 :: :: arrow"
        );
        expectNoErrors(document);
    });

    test('parse grammar with multiple names', async () => {
        const document = await parse(
            "grammar\ntype, t :: 'ty_' ::=\n  | base :: :: base"
        );
        expectNoErrors(document);
    });

    test('parse grammar with production modifiers', async () => {
        const document = await parse(
            "grammar\nt :: 'ty_' ::=\n  | ( t ) :: S :: paren"
        );
        expectNoErrors(document);
    });

    test('parse defnclass with inference rule', async () => {
        const document = await parse(
            "defns typing :: 'ty_' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\n" +
            "by\n\n" +
            "x : t in G\n" +
            "---- :: T_Var\n" +
            "G |- x : t"
        );
        expectNoErrors(document);
    });

    test('parse subrules', async () => {
        const document = await parse('subrules\nv <:: e');
        expectNoErrors(document);
    });

    test('parse embed block', async () => {
        const document = await parse(
            'embed {{ tex-preamble some preamble text }}'
        );
        expectNoErrors(document);
    });

    test('parse dots in grammar', async () => {
        const document = await parse(
            "grammar\nt :: 'ty_' ::=\n  | x1 .. xn :: :: sequence"
        );
        expectNoErrors(document);
    });

    test('parse comprehension', async () => {
        const document = await parse(
            "grammar\nt :: 'ty_' ::=\n  | </ ti // i /> :: :: list"
        );
        expectNoErrors(document);
    });

    test('parse comprehension with separator', async () => {
        const document = await parse(
            "grammar\nt :: 'ty_' ::=\n  | </ ti // , // i /> :: :: commalist"
        );
        expectNoErrors(document);
    });

    test('parse comprehension with range', async () => {
        const document = await parse(
            "grammar\nt :: 'ty_' ::=\n  | </ ti // i IN 1 .. n /> :: :: rangelist"
        );
        expectNoErrors(document);
    });

    test('parse comments', async () => {
        const document = await parse(
            "% This is a comment\nmetavar x ::=\n% Another comment"
        );
        expectNoErrors(document);
    });

    test('parse multiple items', async () => {
        const document = await parse(
            "metavar x ::=\n" +
            "indexvar i ::=\n\n" +
            "grammar\nt :: 'ty_' ::=\n  | x :: :: var\n\n" +
            "subrules\nv <:: t"
        );
        expectNoErrors(document);
        const model = document.parseResult.value;
        expect(model.items.length).toBeGreaterThanOrEqual(3);
    });

    test('parse defn rule with multiple premises', async () => {
        const document = await parse(
            "defns typing :: 'ty_' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\n" +
            "by\n\n" +
            "G |- e1 : t1 -> t2\n" +
            "G |- e2 : t1\n" +
            "---- :: T_App\n" +
            "G |- e1 e2 : t2"
        );
        expectNoErrors(document);
    });

    test('parse substitutions block', async () => {
        const document = await parse(
            'substitutions\nsingle t x :: tsubst'
        );
        expectNoErrors(document);
    });

    test('parse freevars block', async () => {
        const document = await parse('freevars\nt x :: fv');
        expectNoErrors(document);
    });

    test('parse parsing directives', async () => {
        const document = await parse('parsing\nt left');
        expectNoErrors(document);
    });

    test('parse namespace prefix unquoted', async () => {
        const document = await parse(
            "grammar\nt :: ty_ ::=\n  | x :: :: var"
        );
        expectNoErrors(document);
    });

    test('parse homomorphism with inner block', async () => {
        const document = await parse(
            'metavar termvar {{ tex [[ termvar ]] }} ::='
        );
        expectNoErrors(document);
    });

    test('parse empty namespace prefix', async () => {
        const document = await parse(
            "grammar\nt :: '' ::=\n  | x :: :: var"
        );
        expectNoErrors(document);
    });

    test('parse multiple defns in a class', async () => {
        const document = await parse(
            "defns typing :: 'ty_' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\n" +
            "by\n\n" +
            "---- :: T_Unit\n" +
            "G |- unit : Unit\n\n" +
            "defn G |- ok :: :: ctx_ok :: 'ctx_'\n" +
            "by\n\n" +
            "---- :: Ctx_Empty\n" +
            "empty |- ok"
        );
        expectNoErrors(document);
    });
});
