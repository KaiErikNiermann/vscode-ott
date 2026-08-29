import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem, type LangiumDocument } from "langium";
import { parseHelper } from "langium/test";
import type { SourceFile } from "ott-language";
import { createOttServices } from "ott-language";
import { computeHeaderEnd } from "../src/ott-header.js";

// Ott's module header (`module` / `extends` / `imports` / `renaming` / `as`).
// The five words are contextual keywords, recognised only before the first
// item, so that a production or nonterminal may still be called `module` or
// `as` — several in the corpus are. These tests pin both halves: that the
// header parses, and that the words stay ordinary identifiers everywhere else.

let parse: ReturnType<typeof parseHelper<SourceFile>>;

beforeAll(() => {
    parse = parseHelper<SourceFile>(createOttServices(EmptyFileSystem).Ott);
});

function expectNoErrors(document: LangiumDocument<SourceFile>) {
    const errors = document.parseResult.parserErrors;
    if (errors.length > 0) {
        const msgs = errors.map(e => `${e.message} at ${e.token?.startLine}:${e.token?.startColumn}`);
        expect.fail(`Parser errors:\n  ${msgs.join('\n  ')}`);
    }
}

/** `$type` of each header declaration, in order. */
async function header(text: string): Promise<string[]> {
    const doc = await parse(text);
    expectNoErrors(doc);
    return (doc.parseResult.value.header ?? []).map(h => h.$type);
}

const GRAMMAR = `
grammar
t :: 't_' ::=
  | x :: :: var
`;

describe("header declarations", () => {
    test("a bare module declaration", async () => {
        expect(await header(`module tapl\n${GRAMMAR}`)).toEqual(["ModuleDecl"]);
    });

    test("module then extends, after leading comments", async () => {
        // examples/1Bsemantics/l2.ott has exactly this shape.
        expect(await header(`% a comment\n%% another\nmodule l2\nextends l1\n${GRAMMAR}`))
            .toEqual(["ModuleDecl", "ExtendsDecl"]);
    });

    test("several imports, with comma-separated renamings", async () => {
        const doc = await parse(
            `module main\nimports a renaming t as a_t, x as a_x\nimports b renaming t as b_t\n${GRAMMAR}`);
        expectNoErrors(doc);
        const decls = doc.parseResult.value.header;
        expect(decls.map(d => d.$type)).toEqual(["ModuleDecl", "ImportsDecl", "ImportsDecl"]);
        const first = decls[1];
        if (first.$type !== "ImportsDecl") {
            expect.fail("expected an ImportsDecl");
        }
        expect(first.renaming?.renamings.map(r => `${r.from}->${r.to}`)).toEqual(["t->a_t", "x->a_x"]);
    });

    test("extends accepts renaming too", async () => {
        // Undocumented, but `extends` shares upstream's `import_decl`.
        expect(await header(`module u\nextends core renaming t as u_t\n${GRAMMAR}`))
            .toEqual(["ModuleDecl", "ExtendsDecl"]);
    });

    test("a header-only file is legal", async () => {
        expect(await header("module r1\nimports a renaming t as one_t\n"))
            .toEqual(["ModuleDecl", "ImportsDecl"]);
    });

    test("a file with no header still parses", async () => {
        expect(await header(`metavar x ::=\n${GRAMMAR}`)).toEqual([]);
    });
});

describe("the five words stay identifiers outside the header", () => {
    test("a production may be named `module` (tests/test-j.ott)", async () => {
        expect(await header("metavar U ::=\n\ngrammar\nexp , e :: 'Exp_' ::=\n  | U . Term :: :: module\n"))
            .toEqual([]);
    });

    test("a metavar may be named `module`", async () => {
        // The header must end *before* `metavar`, not after it, or `module`
        // here would lex as a keyword.
        expect(await header(`metavar module ::=\n${GRAMMAR}`)).toEqual([]);
    });

    test("`as` may be object-language syntax", async () => {
        expect(await header("metavar x ::=\n\ngrammar\nt :: 't_' ::=\n  | t as T :: :: ascribe\n"))
            .toEqual([]);
    });

    test("`module` inside a homomorphism body is text", async () => {
        expect(await header("module m\n\nembed\n{{ tex \\module{as} \\extends }}\n")).toEqual(["ModuleDecl"]);
    });
});

describe("computeHeaderEnd", () => {
    const at = (text: string, marker: string) => text.indexOf(marker);

    test("ends before the first item keyword", () => {
        const text = "module tapl\n\nmetavar x ::=\n";
        expect(computeHeaderEnd(text)).toBe(at(text, "metavar"));
    });

    test("leading comments and blank lines stay inside the header", () => {
        const text = "% c\n\n%% d\nmodule l2\nextends l1\n\ngrammar\n";
        expect(computeHeaderEnd(text)).toBe(at(text, "grammar"));
    });

    test("bare identifiers do not end the header", () => {
        // STRING is in upstream's keep-set, since that is how `module NAME`
        // operands arrive; the header must survive them.
        const text = "module a\nimports b renaming t as u\ngrammar\n";
        expect(computeHeaderEnd(text)).toBe(at(text, "grammar"));
    });

    test("a structural token ends the header", () => {
        const text = "module a\nt :: 't_' ::=\n";
        expect(computeHeaderEnd(text)).toBe(at(text, "::"));
    });

    test("a file starting with an item has an empty header", () => {
        expect(computeHeaderEnd("metavar x ::=\n")).toBe(0);
    });

    test("a block comment is skipped whole", () => {
        const text = ">>\nmetavar not really\n<<\nmodule m\ngrammar\n";
        expect(computeHeaderEnd(text)).toBe(at(text, "grammar"));
    });
});
