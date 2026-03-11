import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { EmptyFileSystem, type LangiumDocument } from "langium";
import { clearDocuments, parseHelper } from "langium/test";
import type { SourceFile } from "ott-language";
import { createOttServices, isSourceFile } from "ott-language";

let services: ReturnType<typeof createOttServices>;
let parse: ReturnType<typeof parseHelper<SourceFile>>;
let document: LangiumDocument<SourceFile> | undefined;

beforeAll(async () => {
    services = createOttServices(EmptyFileSystem);
    parse = parseHelper<SourceFile>(services.Ott);
});

afterEach(async () => {
    document && clearDocuments(services.shared, [ document ]);
});

describe('Linking tests', () => {

    test('parse without linking errors', async () => {
        document = await parse(
            "metavar x ::=\n\n" +
            "grammar\nt :: 'ty_' ::=\n  | x :: :: var"
        );

        expect(document.parseResult.parserErrors).toHaveLength(0);
        expect(isSourceFile(document.parseResult.value)).toBe(true);
    });
});
