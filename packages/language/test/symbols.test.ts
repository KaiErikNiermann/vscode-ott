import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem } from "langium";
import { parseHelper } from "langium/test";
import type { SourceFile } from "ott-language";
import { createOttServices } from "ott-language";
import { OttDocumentSymbolProvider } from "../src/ott-document-symbol-provider.js";

let services: ReturnType<typeof createOttServices>;
let parse: ReturnType<typeof parseHelper<SourceFile>>;
let symbolProvider: OttDocumentSymbolProvider;

beforeAll(async () => {
    services = createOttServices(EmptyFileSystem);
    parse = parseHelper<SourceFile>(services.Ott);
    symbolProvider = new OttDocumentSymbolProvider();
});

describe('Document symbols', () => {

    test('metavar produces a symbol', async () => {
        const doc = await parse('metavar x, y ::=');
        const symbols = symbolProvider.getSymbols(doc);
        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toBe('metavar x, y');
    });

    test('grammar block produces nested symbols', async () => {
        const doc = await parse(
            "grammar\nt :: Tm ::=\n  | x :: :: var\n  | t1 t2 :: :: app"
        );
        const symbols = symbolProvider.getSymbols(doc);
        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toBe('grammar');
        expect(symbols[0].children).toHaveLength(1);
        expect(symbols[0].children![0].name).toBe('t');
        expect(symbols[0].children![0].children).toHaveLength(2);
    });

    test('defn class produces nested symbols with rules', async () => {
        const doc = await parse(
            "defns typing :: '' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\n" +
            "by\n\n" +
            "---- :: T_Var\nG |- x : t\n\n" +
            "---- :: T_App\nG |- e1 e2 : t"
        );
        const symbols = symbolProvider.getSymbols(doc);
        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toBe('defns typing');
        expect(symbols[0].children).toHaveLength(1);
        expect(symbols[0].children![0].name).toBe('typing');
        expect(symbols[0].children![0].children).toHaveLength(2);
        expect(symbols[0].children![0].children![0].name).toBe('T_Var');
    });

    test('multiple items produce correct symbol count', async () => {
        const doc = await parse(
            "metavar x ::=\n" +
            "indexvar i ::=\n\n" +
            "grammar\nt :: Tm ::=\n  | x :: :: var\n\n" +
            "subrules\nv <:: t"
        );
        const symbols = symbolProvider.getSymbols(doc);
        expect(symbols).toHaveLength(4);
    });

    test('embed shows hom targets', async () => {
        const doc = await parse(
            "embed {{ coq some code }} {{ tex some latex }}"
        );
        const symbols = symbolProvider.getSymbols(doc);
        expect(symbols).toHaveLength(1);
        expect(symbols[0].name).toContain('coq');
        expect(symbols[0].name).toContain('tex');
    });
});
