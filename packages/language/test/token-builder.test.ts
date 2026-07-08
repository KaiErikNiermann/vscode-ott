import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem } from "langium";
import type { LexerResult } from "langium";
import { createOttServices } from "ott-language";

// Regression tests for OttTokenBuilder's context-sensitive lexing: `%` line
// comments and `>> .. <<` block comments behave differently depending on
// whether they sit at a line start / read as prose (comment) or are glued into
// object-language text. These are the rules a single-mode regex lexer can't
// express, so they get their own coverage.

let tokenize: (text: string) => LexerResult;

beforeAll(() => {
    const lexer = createOttServices(EmptyFileSystem).Ott.parser.Lexer;
    tokenize = (text: string) => lexer.tokenize(text);
});

/** Visible (non-hidden) token images, in order. */
function images(text: string): string[] {
    return tokenize(text).tokens.map(t => t.image);
}

describe("`%` line comments", () => {
    test("line-start % is a comment (hidden)", () => {
        expect(images("metavar x ::=\n% commented out\nmetavar y ::=")).toEqual([
            "metavar", "x", "::=", "metavar", "y", "::=",
        ]);
    });

    test("indented line-start % is a comment", () => {
        expect(images("metavar x ::=\n   % note\nmetavar y ::=")).toEqual([
            "metavar", "x", "::=", "metavar", "y", "::=",
        ]);
    });

    test("mid-line `% word` (space) is a trailing comment", () => {
        // `{{ lem integer }} % TODO` — the trailing comment is dropped.
        expect(images("metavar x ::= {{ lem integer }} % TODO")).toEqual([
            "metavar", "x", "::=", "{{", "lem", "integer", "}}",
        ]);
    });

    test("mid-line `%%` is a comment", () => {
        expect(images("metavar x ::= a %% note here")).toContain("a");
        expect(images("metavar x ::= a %% note here")).not.toContain("%%");
    });

    test("mid-line `%prim` (glued to a word) is object text, not a comment", () => {
        // The `%prim` must survive as object text so `( %prim x ) :: L :: p` parses.
        const imgs = images("grammar\ne :: e_ ::=\n  | ( %prim x )  :: L :: p");
        expect(imgs.some(i => i.includes("%prim"))).toBe(true);
        expect(imgs).toContain("p"); // the `:: L :: p` tail is not eaten by a comment
    });
});

describe("`>> .. <<` block comments", () => {
    test("bare line-start >> .. << is a block comment (hidden)", () => {
        expect(images("metavar x ::=\n>>\nfree LaTeX <-> prose\n<<\nmetavar y ::=")).toEqual([
            "metavar", "x", "::=", "metavar", "y", "::=",
        ]);
    });

    test("`%d>>` opener (>> at the end of a % line) is a block comment", () => {
        expect(images("metavar x ::=\n%d>>\ndisplay only\n<<\nmetavar y ::=")).toEqual([
            "metavar", "x", "::=", "metavar", "y", "::=",
        ]);
    });

    test("`>> .. %d<<` closer (<< at the end of a % line) is a block comment", () => {
        expect(images("metavar x ::=\n>>\nstuff\n%d<<\nmetavar y ::=")).toEqual([
            "metavar", "x", "::=", "metavar", "y", "::=",
        ]);
    });

    test("object-language `<< .. >>` mid-line is NOT a comment", () => {
        // The substitution operator must survive as `<` `<` .. `>` `>` object tokens.
        const imgs = images("grammar\nt :: t_ ::=\n  | << x >> t :: :: sub");
        expect(imgs.filter(i => i === "<").length).toBe(2);
        expect(imgs.filter(i => i === ">").length).toBe(2);
    });

    test("a plain % comment line containing >> mid-content is not a block opener", () => {
        // `%%WIDTH: >>a4` is a comment, not a `>>` block open (>> is mid-line).
        expect(images("metavar x ::=\n%%WIDTH: >>a4/landscape\nmetavar y ::=")).toEqual([
            "metavar", "x", "::=", "metavar", "y", "::=",
        ]);
    });
});
