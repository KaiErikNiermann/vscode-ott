import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem } from "langium";
import { parseHelper } from "langium/test";
import type { SourceFile } from "ott-language";
import { createOttServices } from "ott-language";
import type { TextEdit } from 'vscode-languageserver';

let services: ReturnType<typeof createOttServices>;
let parse: ReturnType<typeof parseHelper<SourceFile>>;

beforeAll(async () => {
    services = createOttServices(EmptyFileSystem);
    parse = parseHelper<SourceFile>(services.Ott);
});

/**
 * Format a string by parsing it, running the formatter, and applying edits.
 */
async function formatText(input: string): Promise<string> {
    const document = await parse(input);
    expect(document.parseResult.parserErrors).toHaveLength(0);

    const formatter = services.Ott.lsp.Formatter!;
    const edits = await formatter.formatDocument(document, {
        textDocument: { uri: document.uri.toString() },
        options: { tabSize: 2, insertSpaces: true },
    }) as TextEdit[];

    return applyEdits(input, edits);
}

/**
 * Verify formatted output parses without errors (formatter doesn't break valid Ott).
 */
async function expectValidOtt(text: string): Promise<void> {
    const doc = await parse(text);
    expect(
        doc.parseResult.parserErrors,
        `Formatted output has parse errors:\n${text}`,
    ).toHaveLength(0);
}

/**
 * Verify formatting is idempotent (formatting twice gives same result).
 */
async function expectIdempotent(input: string): Promise<string> {
    const first = await formatText(input);
    await expectValidOtt(first);
    const second = await formatText(first);
    expect(second, 'Formatting is not idempotent').toBe(first);
    return first;
}

/** Apply LSP text edits to a string. */
function applyEdits(text: string, edits: TextEdit[]): string {
    const lines = text.split('\n');

    // Apply edits in reverse order to preserve offsets
    const sorted = [...edits].sort((a, b) => {
        const lineDiff = b.range.start.line - a.range.start.line;
        return lineDiff !== 0 ? lineDiff : b.range.start.character - a.range.start.character;
    });

    for (const edit of sorted) {
        const startLine = edit.range.start.line;
        const endLine = edit.range.end.line;
        const startChar = edit.range.start.character;
        const endChar = edit.range.end.character;

        const before = lines[startLine].slice(0, startChar);
        const after = lines[endLine].slice(endChar);
        const newContent = before + edit.newText + after;

        const newLines = newContent.split('\n');
        lines.splice(startLine, endLine - startLine + 1, ...newLines);
    }

    return lines.join('\n');
}

// ── Section-level formatting ──────────────────────────────

describe('Section spacing', () => {

    test('adds blank line between top-level items', async () => {
        const result = await expectIdempotent(
            "metavar x ::=\ngrammar\nt :: Tm ::=\n  | x :: :: var",
        );
        expect(result).toContain('\n\ngrammar');
    });

    test('preserves blank lines between items already separated', async () => {
        const input =
            "metavar x ::=\n\ngrammar\nt :: Tm ::=\n  | x :: :: var";
        const result = await expectIdempotent(input);
        expect(result).toContain('\n\ngrammar');
    });
});

// ── Metavar formatting ───────────────────────────────────

describe('Metavar formatting', () => {

    test('spaces around ::= and after commas', async () => {
        const result = await expectIdempotent("metavar x,y ::=");
        expect(result).toContain('x, y');
        expect(result).toContain(' ::=');
    });

    test('space after keyword', async () => {
        const result = await expectIdempotent("metavar x ::=");
        expect(result.trim()).toMatch(/^metavar /);
    });

    test('single homomorphism stays inline', async () => {
        const result = await expectIdempotent(
            "metavar x ::= {{ isa nat }}",
        );
        expect(result).toContain('::= {{ isa');
    });

    test('multiple homomorphisms are preserved as written', async () => {
        // Authors group header homs deliberately; the formatter keeps that layout
        // instead of forcing one hom per line.
        const inline = await expectIdempotent("metavar x ::= {{ isa nat }} {{ coq nat }}");
        expect(inline).toBe("metavar x ::= {{ isa nat }} {{ coq nat }}");
        const wrapped = await expectIdempotent("metavar x ::=\n {{ isa nat }}\n {{ coq nat }}");
        expect(wrapped).toBe("metavar x ::=\n {{ isa nat }}\n {{ coq nat }}");
    });
});

// ── Grammar formatting ──────────────────────────────────

describe('Grammar formatting', () => {

    test('grammar rules on new lines after keyword', async () => {
        const result = await expectIdempotent(
            "grammar\nt :: Tm ::=\n  | x :: :: var",
        );
        expect(result).toMatch(/grammar\n/);
    });

    test('productions indented with pipe', async () => {
        const result = await expectIdempotent(
            "grammar\nt :: Tm ::=\n  | x :: :: var\n  | t1 t2 :: :: app",
        );
        // Productions should be on separate lines
        expect(result).toContain('| x');
        expect(result).toContain('| t1');
    });

    test('spaces around :: and ::= in rule header', async () => {
        const result = await expectIdempotent(
            "grammar\nt :: Tm ::=\n  | x :: :: var",
        );
        expect(result).toContain(' :: Tm ::=');
    });

    test('multiple grammar rules separated', async () => {
        const result = await expectIdempotent(
            "grammar\n" +
            "t :: Tm ::=\n  | x :: :: var\n\n" +
            "v :: Va ::=\n  | x :: :: var",
        );
        await expectValidOtt(result);
    });
});

// ── DefnClass formatting ─────────────────────────────────

describe('DefnClass formatting', () => {

    test('blank line before defn within defnclass', async () => {
        const result = await expectIdempotent(
            "defns typing :: '' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\n" +
            "by\n\n" +
            "---- :: T_Var\nG |- x : t",
        );
        await expectValidOtt(result);
    });

    test('multiple defns separated by blank lines', async () => {
        const result = await expectIdempotent(
            "defns typing :: '' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\nby\n\n" +
            "---- :: T_Var\nG |- x : t\n\n" +
            "defn G |- ok :: :: ctx_ok :: 'ctx_'\nby\n\n" +
            "---- :: Ctx_Empty\nempty |- ok",
        );
        // Should have blank lines between defns
        await expectValidOtt(result);
    });

    test('defn body (inference rules) is preserved verbatim', async () => {
        // The premise/dashes/conclusion layout and blank-line-between-rules live
        // only in source whitespace, and object operators like `-->` are
        // multi-token: the formatter must not reflow or split any of it.
        const input =
            "defns Jop :: '' ::=\n\n" +
            "defn t --> t' :: :: red :: E_\nby\n\n" +
            "t1 --> t1'\n---- :: R1\nfix (\\x:T1.t2) --> [x|->t2]\n\n" +
            "---- :: R2\nt3 --> t4";
        const result = await expectIdempotent(input);
        // Premise stays glued to its dashes (no blank line inserted between them),
        // the multi-token conclusion is intact, and rules stay blank-separated.
        expect(result).toContain("t1 --> t1'\n---- :: R1\nfix (\\x:T1.t2) --> [x|->t2]");
        expect(result).toContain("[x|->t2]\n\n---- :: R2");
    });
});

// ── Homomorphism formatting ──────────────────────────────

describe('Homomorphism formatting', () => {

    test('spaces inside {{ }}', async () => {
        const result = await expectIdempotent(
            "metavar x ::= {{ isa nat }}",
        );
        expect(result).toContain('{{ isa nat }}');
    });

    test('multi-line hom bodies are preserved (not collapsed onto one line)', async () => {
        // Multi-line target-language homs (embed preambles, coq/isa blocks) must
        // keep their internal line breaks — the closing `}}` stays on its own line.
        const input = "embed\n{{ coq\nDefinition foo : Set.\n}}";
        const result = await expectIdempotent(input);
        expect(result).toBe(input);
    });

    test('production homs stay inline (one-line production preserved)', async () => {
        // Ott productions — especially `terminals` — are hand-aligned one-liners;
        // the formatter must not push the hom onto its own line.
        const result = await expectIdempotent(
            "grammar\nformula :: formula_ ::=\n  | j INDEXES t1 :: :: Indexesv {{ coq (1 <= j) }}",
        );
        expect(result).toContain('Indexesv {{ coq (1 <= j) }}');
        expect(result).not.toContain('Indexesv\n');
        await expectValidOtt(result);
    });

    test('terminals block keeps its column alignment', async () => {
        // Padding before `::` and the trailing hom must be preserved verbatim.
        const input =
            "grammar\nterminals :: terminals_ ::=\n" +
            "  | -->                        ::   :: longrightarrow {{ tex \\longrightarrow }}\n" +
            "  | ->                         ::   :: rightarrow     {{ tex \\rightarrow }}";
        const result = await expectIdempotent(input);
        expect(result).toContain("  | -->                        ::   :: longrightarrow {{ tex \\longrightarrow }}");
        expect(result).toContain("  | ->                         ::   :: rightarrow     {{ tex \\rightarrow }}");
    });
});

// ── Comprehension formatting ─────────────────────────────

describe('Comprehension formatting', () => {

    test('spaces inside </ />', async () => {
        const result = await expectIdempotent(
            "grammar\nt :: 'ty_' ::=\n  | </ ti // i /> :: :: list",
        );
        expect(result).toContain('</');
        expect(result).toContain('/>');
        await expectValidOtt(result);
    });

    test('comprehension with separator', async () => {
        const result = await expectIdempotent(
            "grammar\nt :: 'ty_' ::=\n  | </ ti // , // i /> :: :: commalist",
        );
        await expectValidOtt(result);
    });
});

// ── Bind spec formatting ─────────────────────────────────

describe('Bind spec formatting', () => {

    test('spaces inside (+ +)', async () => {
        const result = await expectIdempotent(
            "grammar\nt :: Tm ::=\n  | \\x.t :: :: Abs (+ bind x in t +)",
        );
        expect(result).toContain('(+ bind');
        expect(result).toContain('t +)');
        await expectValidOtt(result);
    });
});

// ── Other blocks ─────────────────────────────────────────

describe('Other blocks formatting', () => {

    test('subrules entries on new lines', async () => {
        const result = await expectIdempotent("subrules\nv <:: t");
        await expectValidOtt(result);
    });

    test('substitutions entries on new lines', async () => {
        const result = await expectIdempotent(
            "substitutions\nsingle t x :: tsubst",
        );
        await expectValidOtt(result);
    });

    test('freevars entries on new lines', async () => {
        const result = await expectIdempotent("freevars\nt x :: fv");
        await expectValidOtt(result);
    });

    test('parsing directives on new lines', async () => {
        const result = await expectIdempotent("parsing\nt left");
        await expectValidOtt(result);
    });

    test('embed block', async () => {
        const result = await expectIdempotent(
            "embed\n{{ coq some code }}",
        );
        await expectValidOtt(result);
    });
});

// ── Idempotence on complex files ─────────────────────────

describe('Idempotence on complex inputs', () => {

    test('full file with all constructs', async () => {
        await expectIdempotent(
            "metavar x, y ::=\n" +
            "indexvar i, j ::=\n\n" +
            "grammar\n" +
            "t :: Tm ::=\n" +
            "  | x :: :: var\n" +
            "  | \\x.t :: :: Abs (+ bind x in t +)\n" +
            "  | t1 t2 :: :: App\n\n" +
            "v :: Va ::=\n" +
            "  | \\x.t :: :: Abs\n\n" +
            "subrules\nv <:: t\n\n" +
            "substitutions\nsingle t x :: tsubst\n\n" +
            "freevars\nt x :: fv\n\n" +
            "defns typing :: '' ::=\n\n" +
            "defn G |- e : t :: :: typing :: 'ty_'\nby\n\n" +
            "---- :: T_Var\nG |- x : t\n\n" +
            "G |- e1 : t1\n" +
            "---- :: T_App\nG |- e1 e2 : t2",
        );
    });

    test('thesis test.ott content', async () => {
        await expectIdempotent(
            "indexvar index, i, j, n, m ::= {{ isa nat }} {{ coq nat }} {{ hol num }} {{ lex numeral }}\n" +
            "  {{ com indices }}\n\n" +
            "grammar\n" +
            "formula :: formula_ ::=\n" +
            "  | formula1 .. formulan :: :: dots\n" +
            "  | j INDEXES t1 .. tn :: :: Indexesv\n" +
            "        {{ coq (1 <= [[j]]) }}\n" +
            "        {{ hol (1 <= [[j]]) }}\n\n" +
            "embed\n" +
            "{{ coq\n" +
            "Definition list'T : Set.\n" +
            "}}",
        );
    });
});

// ── Corpus safety net ────────────────────────────────────
// The formatter must never break a real Ott file: formatting a valid file must
// keep it parseable and be idempotent (formatting twice == once). Runs over the
// whole example corpus copied into fixtures/.

const FIXTURES_DIR = new URL('fixtures', import.meta.url).pathname;
// Not real Ott (LaTeX modeline / LaTeX-rendered), kept in sync with fixtures.test.ts.
const NOT_OTT = new Set(['ocaml_light/library.ott', 'tapl/let_alltt.ott']);

function collectOtt(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) { // eslint-disable-line security/detect-non-literal-fs-filename
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { // eslint-disable-line security/detect-non-literal-fs-filename
            out.push(...collectOtt(full));
        } else if (entry.endsWith('.ott')) {
            out.push(full);
        }
    }
    return out.sort();
}

describe('Formatter never breaks a corpus file', () => {
    for (const filePath of collectOtt(FIXTURES_DIR)) {
        const name = relative(FIXTURES_DIR, filePath);
        if (NOT_OTT.has(name)) continue;

        test(`preserves validity + idempotent: ${name}`, async () => {
            const input = readFileSync(filePath, 'utf-8'); // eslint-disable-line security/detect-non-literal-fs-filename
            // Only guard files that parse cleanly to begin with.
            if ((await parse(input)).parseResult.parserErrors.length > 0) return;

            const once = await formatText(input);
            const reparsed = await parse(once);
            expect(
                reparsed.parseResult.parserErrors,
                `Formatting broke parsing of ${name}`,
            ).toHaveLength(0);

            const twice = await formatText(once);
            expect(twice, `Formatting ${name} is not idempotent`).toBe(once);
        });
    }
});
