import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem, type LangiumDocument } from "langium";
import { parseHelper } from "langium/test";
import type { SourceFile } from "ott-language";
import { createOttServices } from "ott-language";

// Constructs the grammar used to reject, each one found by parsing the upstream
// corpus and confirming with the real `ott` binary that the file is valid — so
// every case below is a shape Ott accepts, not a guess. The corpus file that
// motivated each is named in the test.

let parse: ReturnType<typeof parseHelper<SourceFile>>;

beforeAll(() => {
    parse = parseHelper<SourceFile>(createOttServices(EmptyFileSystem).Ott);
});

async function expectParses(text: string): Promise<LangiumDocument<SourceFile>> {
    const doc = await parse(text);
    const errors = doc.parseResult.parserErrors;
    if (errors.length > 0) {
        const msgs = errors.map(e => `  L${e.token?.startLine}:${e.token?.startColumn} ${e.message}`);
        expect.fail(`expected a clean parse, got:\n${msgs.join('\n')}`);
    }
    return doc;
}

describe("names (Ott's maybe_quoted_ident)", () => {
    test("a production name may be a number (tests/test12.ott, test15.6.ott)", async () => {
        await expectParses("grammar\nt :: 't_' ::=\n  | 0 :: :: 0\n  | x :: :: 1\n");
    });

    test("a rule-separator name may be a number (tests/test7a.ott:160)", async () => {
        await expectParses(
            "defns J :: '' ::=\n\ndefn\nt1 --> t2 :: :: reduce :: '' by\n\n-------------- :: 1\nt1 --> t2\n");
    });

    test("a name may start with a digit and continue (tests/test18.1.ott `:: 1C`)", async () => {
        // Lexes as one ID rather than INT + ID, via INT's LONGER_ALT.
        await expectParses("grammar\nt :: 't_' ::=\n  | x :: :: 1C\n");
    });

    test("a production name may be quoted (tests/test1.ott `:: 'fun'`)", async () => {
        await expectParses("grammar\nt :: 't_' ::=\n  | function x :: :: 'fun'\n");
    });

    test("a rule root may be quoted (tests/test13.ott `'metavar' :: 'mv_' ::=`)", async () => {
        await expectParses("grammar\n'metavar' :: 'mv_' ::=\n  | x :: :: mv\n");
    });
});

describe("quoted terminals as production elements", () => {
    test("`'::'` as a terminal (ocaml_light/syntax.ott:576)", async () => {
        await expectParses("grammar\npattern :: 'p_' ::=\n  | pattern1 '::' pattern2 :: L :: cons\n");
    });

    test("`'<<'` / `'>>'` as terminals (ocaml_light/syntax.ott:840)", async () => {
        // `>>` also opens a block comment at a line start, so this doubles as a
        // check that the quoted form is not mistaken for one.
        await expectParses("grammar\nd :: 'd_' ::=\n  | '<<' x '>>' d :: M :: substs\n");
    });

    test("`'IN'` as a terminal (test_phantom/test_phantom.ott:10)", async () => {
        await expectParses("grammar\ne :: 'e_' ::=\n  | expr 'IN' set :: :: InSet\n");
    });

    test("`(::=)` as object text (peterson/peterson_caml.ott:61)", async () => {
        await expectParses("grammar\ne :: 'e_' ::=\n  | (::=) :: :: assign\n");
    });
});

describe("defn headers", () => {
    test("a defn header carries a category list (tests/test6.ott:91)", async () => {
        // Four ::-separated fields: elements :: categories :: name :: texwrapper.
        const doc = await expectParses(
            "defns J :: '' ::=\n\ndefn\nE |- ok :: M :: Eok :: Eok_ by\n\n----- :: base\nE |- ok\n");
        const item = doc.parseResult.value.items[0];
        if (item.$type !== 'DefnClass') expect.fail('expected a DefnClass');
        expect(item.definitions[0].categories).toEqual(['M']);
        expect(item.definitions[0].name).toBe('Eok');
    });

    test("the fields may be glued together (tests/test10.ott:31)", async () => {
        // `:: ::reduce::''` — no spaces around the separators.
        const doc = await expectParses(
            "defns J :: '' ::=\n\ndefn\nt1 --> t2 :: ::reduce::'' by\n\n----- :: ax\nt1 --> t2\n");
        const item = doc.parseResult.value.items[0];
        if (item.$type !== 'DefnClass') expect.fail('expected a DefnClass');
        expect(item.definitions[0].name).toBe('reduce');
    });
});

describe("comprehensions", () => {
    test("comprehensions nest (tex/lj_common.ott:891)", async () => {
        await expectParses(
            "grammar\nf :: 'f_' ::=\n  | </ methl notin </ methk // k /> // l /> :: :: nested\n");
    });

    test("a bound may carry an offset (tests/test17.10.ott:99)", async () => {
        await expectParses("grammar\nt :: 't_' ::=\n  | { </ li : Ti // i IN 0 .. n-1 /> } :: :: rec\n");
    });
});

describe("bind specifications", () => {
    test("an empty bindspec (tests/binding.5.ott:42)", async () => {
        await expectParses("grammar\nt :: 't_' ::=\n  | G |- T <: T' :: :: subtype (+ +)\n");
    });

    test("a comprehension inside a bindspec (tests/test17.11.ott:55)", async () => {
        await expectParses(
            "grammar\nt :: 't_' ::=\n  | { </ li = pi // , // i /> } :: :: Rec (+ b = b( </ pi // i /> ) +)\n");
    });
});

describe("homs block", () => {
    test("`homs <wrapper> :: <prodname> ...` (tests/test10_homs.ott:19)", async () => {
        const doc = await expectParses(
            "homs 't_'\n  :: Lam (+ bind x in t +)\n  :: Var {{ com variable }}\n");
        const item = doc.parseResult.value.items[0];
        if (item.$type !== 'HomsBlock') expect.fail('expected a HomsBlock');
        expect(item.wrapper).toBe("'t_'");
        expect(item.entries.map(e => e.name)).toEqual(['Lam', 'Var']);
    });
});
