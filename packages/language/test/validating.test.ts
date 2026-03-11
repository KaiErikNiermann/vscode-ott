import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem } from "langium";
import { parseHelper } from "langium/test";
import type { SourceFile } from "ott-language";
import { createOttServices, isSourceFile } from "ott-language";

let services: ReturnType<typeof createOttServices>;
let parse: ReturnType<typeof parseHelper<SourceFile>>;

beforeAll(async () => {
    services = createOttServices(EmptyFileSystem);
    const doParse = parseHelper<SourceFile>(services.Ott);
    parse = (input: string) => doParse(input, { validation: true });
});

describe('Validating', () => {

    test('valid defn rule produces no errors', async () => {
        const document = await parse(
            "defns typing :: '' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\n" +
            "by\n\n" +
            "x : t in G\n" +
            "---- :: T_Var\n" +
            "G |- x : t"
        );

        expect(document.parseResult.parserErrors).toHaveLength(0);
        expect(isSourceFile(document.parseResult.value)).toBe(true);
        const errors = document.diagnostics?.filter(d => d.severity === 1) ?? [];
        expect(errors).toHaveLength(0);
    });

    test('valid metavar produces no errors', async () => {
        const document = await parse('metavar x, y ::=');

        expect(document.parseResult.parserErrors).toHaveLength(0);
        const errors = document.diagnostics?.filter(d => d.severity === 1) ?? [];
        expect(errors).toHaveLength(0);
    });
});
