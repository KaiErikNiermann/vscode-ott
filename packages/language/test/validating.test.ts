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

type Diag = { severity?: number; message: string };

/** Diagnostics helpers: severity 1 = error, 2 = warning, 3 = info */
function errors(doc: { diagnostics?: Diag[] }) {
    return doc.diagnostics?.filter(d => d.severity === 1) ?? [];
}
function warnings(doc: { diagnostics?: Diag[] }) {
    return doc.diagnostics?.filter(d => d.severity === 2) ?? [];
}

describe('Valid files produce no errors', () => {

    test('valid defn rule', async () => {
        const doc = await parse(
            "defns typing :: '' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\n" +
            "by\n\n" +
            "x : t in G\n" +
            "---- :: T_Var\n" +
            "G |- x : t"
        );
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(isSourceFile(doc.parseResult.value)).toBe(true);
        expect(errors(doc)).toHaveLength(0);
    });

    test('valid metavar', async () => {
        const doc = await parse('metavar x, y ::=');
        expect(doc.parseResult.parserErrors).toHaveLength(0);
        expect(errors(doc)).toHaveLength(0);
    });

    test('valid subrules with matching grammar', async () => {
        const doc = await parse(
            "grammar\n" +
            "t :: Tm ::=\n  | x :: :: var\n\n" +
            "v :: Va ::=\n  | x :: :: var\n\n" +
            "subrules\nv <:: t"
        );
        expect(errors(doc)).toHaveLength(0);
        expect(warnings(doc)).toHaveLength(0);
    });

    test('valid substitutions with matching grammar and metavar', async () => {
        const doc = await parse(
            "metavar x ::=\n\n" +
            "grammar\n" +
            "t :: Tm ::=\n  | x :: :: var\n\n" +
            "substitutions\nsingle t x :: tsubst"
        );
        expect(errors(doc)).toHaveLength(0);
        expect(warnings(doc)).toHaveLength(0);
    });
});

describe('Reference validation', () => {

    test('subrule references undefined nonterminal', async () => {
        const doc = await parse("subrules\nv <:: t");
        expect(warnings(doc).length).toBeGreaterThanOrEqual(2);
        const msgs = warnings(doc).map(d => d.message);
        expect(msgs.some(m => m.includes("'v'"))).toBe(true);
        expect(msgs.some(m => m.includes("'t'"))).toBe(true);
    });

    test('substitution references undefined nonterminal and metavar', async () => {
        const doc = await parse("substitutions\nsingle t x :: tsubst");
        const warns = warnings(doc);
        expect(warns.length).toBeGreaterThanOrEqual(2);
        const msgs = warns.map(d => d.message);
        expect(msgs.some(m => m.includes("Nonterminal 't'"))).toBe(true);
        expect(msgs.some(m => m.includes("Metavariable 'x'"))).toBe(true);
    });

    test('freevars references undefined nonterminal and metavar', async () => {
        const doc = await parse("freevars\nt x :: fv");
        const warns = warnings(doc);
        expect(warns.length).toBeGreaterThanOrEqual(2);
    });

    test('parsing directive references undefined nonterminal', async () => {
        const doc = await parse("parsing\nt left");
        const warns = warnings(doc);
        expect(warns.length).toBeGreaterThanOrEqual(1);
        expect(warns[0].message).toContain("'t'");
    });
});

describe('Duplicate detection', () => {

    test('duplicate metavar names produce warning', async () => {
        const doc = await parse("metavar x ::=\nmetavar x ::=");
        const warns = warnings(doc);
        expect(warns.some(w => w.message?.includes("already declared"))).toBe(true);
    });

    test('duplicate nonterminal names produce info', async () => {
        const doc = await parse(
            "grammar\nt :: Tm ::=\n  | x :: :: var\n\n" +
            "grammar\nt :: Tm2 ::=\n  | y :: :: var2"
        );
        const infos = doc.diagnostics?.filter(d => d.severity === 3) ?? [];
        expect(infos.some(i => i.message?.includes("multiple grammar blocks"))).toBe(true);
    });
});
