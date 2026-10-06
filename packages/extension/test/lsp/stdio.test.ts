import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
    CompletionRequest, DefinitionRequest, DiagnosticSeverity, DidChangeTextDocumentNotification,
    DocumentFormattingRequest, DocumentSymbolRequest, HoverRequest, ReferencesRequest,
    SemanticTokensRequest,
    type CompletionItem, type CompletionList, type DocumentSymbol, type Hover, type InitializeResult,
    type Location, type LocationLink, type TextEdit,
} from 'vscode-languageserver-protocol/node';
import {
    LABEL_USE, RULE_SEPARATOR_WARNING, positionIn, readFixture, type Position,
} from '../shared/fixtures.js';
import { LspSession, uriOf } from './session.js';

/**
 * The language server as an editor other than VS Code sees it: a process
 * started from `bin/ott-language-server --stdio`, spoken to only over
 * JSON-RPC. The unit suites in packages/language call the providers directly;
 * these check that the same behaviour survives bundling, process start-up,
 * workspace indexing and `workspace/configuration`.
 */

let session: LspSession;
let capabilities: InitializeResult;

beforeAll(async () => {
    ({ session, capabilities } = await LspSession.start());
}, 20_000);

afterAll(async () => {
    session.kill();
});

const at = (file: string, needle: string, nth = 0, offset = 0): Position =>
    positionIn(readFixture(file), needle, nth, offset);

const targetsOf = (result: Location | Location[] | LocationLink[] | null): string[] => {
    if (result === null) return [];
    const list = Array.isArray(result) ? result : [result];
    return list.map(l => ('targetUri' in l ? l.targetUri : l.uri));
};

async function definitionOfLabelUse(): Promise<string[]> {
    const uri = await session.open(LABEL_USE.file);
    const result = await session.within(10_000, 'definition', session.connection.sendRequest(DefinitionRequest.type, {
        textDocument: { uri },
        position: at(LABEL_USE.file, LABEL_USE.needle, 0, LABEL_USE.offset),
    }));
    return targetsOf(result);
}

const hoverText = (hover: Hover | null): string => JSON.stringify(hover?.contents ?? '');

describe('start-up', () => {
    test('advertises every feature the extension relies on', () => {
        const caps = capabilities.capabilities;
        expect(caps.hoverProvider).toBeTruthy();
        expect(caps.definitionProvider).toBeTruthy();
        expect(caps.referencesProvider).toBeTruthy();
        expect(caps.completionProvider).toBeTruthy();
        expect(caps.documentFormattingProvider).toBeTruthy();
        expect(caps.documentSymbolProvider).toBeTruthy();
        expect(caps.semanticTokensProvider?.legend.tokenTypes.length ?? 0).toBeGreaterThan(0);
    });
});

describe('diagnostics', () => {
    test('a well-formed project file gets no errors', async () => {
        const uri = await session.open('typing.ott');
        const diagnostics = await session.diagnosticsFor(uri);
        expect(diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)).toEqual([]);
    });

    test('a parse error is reported as an error', async () => {
        const uri = await session.open('diagnostics', 'broken.ott');
        const diagnostics = await session.diagnosticsFor(uri, d => d.length > 0);
        expect(diagnostics.some(d => d.severity === DiagnosticSeverity.Error)).toBe(true);
    });

    test('a validator warning reaches the client', async () => {
        const uri = await session.open('diagnostics', 'unnamed.ott');
        const diagnostics = await session.diagnosticsFor(uri, d => d.length > 0);
        expect(diagnostics.map(d => d.message)).toContain(RULE_SEPARATOR_WARNING);
    });

    test('an edit that breaks the file is reported, and fixing it clears it', async () => {
        const uri = await session.open('syntax.ott');
        const text = readFixture('syntax.ott');
        const edit = async (version: number, content: string) =>
            session.connection.sendNotification(DidChangeTextDocumentNotification.type, {
                textDocument: { uri, version },
                contentChanges: [{ text: content }],
            });

        await edit(2, text.replace('| bool        ::   :: bool', '| bool        ::'));
        const broken = await session.diagnosticsFor(uri, d => d.some(x => x.severity === DiagnosticSeverity.Error));
        expect(broken.length).toBeGreaterThan(0);

        await edit(3, text);
        const fixed = await session.diagnosticsFor(uri, d => !d.some(x => x.severity === DiagnosticSeverity.Error));
        expect(fixed.filter(d => d.severity === DiagnosticSeverity.Error)).toEqual([]);
    });
});

describe('navigation', () => {
    test('go to definition crosses into the file that declares the root', async () => {
        expect(await definitionOfLabelUse()).toContain(uriOf('labels.ott'));
    });

    test('find references reaches every file that uses a root', async () => {
        const uri = await session.open('syntax.ott');
        const result = await session.connection.sendRequest(ReferencesRequest.type, {
            textDocument: { uri },
            position: at('syntax.ott', 'typ, T', 0, 'typ, '.length),
            context: { includeDeclaration: true },
        });
        const files = new Set((result ?? []).map(l => l.uri));
        expect(files).toContain(uriOf('typing.ott'));
    });

    test('hover on a use names the file that declares it', async () => {
        const uri = await session.open(LABEL_USE.file);
        const hover = await session.connection.sendRequest(HoverRequest.type, {
            textDocument: { uri },
            position: at(LABEL_USE.file, LABEL_USE.needle, 0, LABEL_USE.offset),
        });
        expect(hoverText(hover)).toContain('labels.ott');
    });

    test('completion inside a rule offers roots from sibling files', async () => {
        const uri = await session.open('typing.ott');
        const result = await session.connection.sendRequest(CompletionRequest.type, {
            textDocument: { uri },
            position: at('typing.ott', 'G |- e1 e2 : ', 0, 'G |- e1 e2 : '.length),
        });
        const items: CompletionItem[] = Array.isArray(result) ? result : (result as CompletionList | null)?.items ?? [];
        const labels = items.map(i => i.label);
        expect(labels).toContain('T');
        expect(labels).toContain('l');
    });

    test('document symbols list the grammar', async () => {
        const uri = await session.open('syntax.ott');
        const result = await session.connection.sendRequest(DocumentSymbolRequest.type, { textDocument: { uri } });
        const names = JSON.stringify((result ?? []) as DocumentSymbol[]);
        expect(names).toContain('typ');
        expect(names).toContain('exp');
    });

    test('semantic tokens cover the document', async () => {
        const uri = await session.open('typing.ott');
        const tokens = await session.connection.sendRequest(SemanticTokensRequest.type, { textDocument: { uri } });
        expect(tokens?.data.length ?? 0).toBeGreaterThan(0);
    });
});

describe('settings', () => {
    const isBar = (text: string) => /^-{3,}/.test(text.trim());

    async function format(): Promise<TextEdit[]> {
        const uri = await session.open('typing.ott');
        return (await session.connection.sendRequest(DocumentFormattingRequest.type, {
            textDocument: { uri },
            options: { tabSize: 2, insertSpaces: true },
        })) ?? [];
    }

    test('ott.format.rules.bar = fit resizes rule bars, and off leaves them', async () => {
        await session.configure({});
        expect((await format()).some(e => isBar(e.newText))).toBe(false);

        await session.configure({ format: { rules: { bar: 'fit' } } });
        const fitted = await format();
        // The `var` rule's bar is 13 dashes over 10-column lines.
        expect(fitted.some(e => e.newText.includes('-'.repeat(10)) && !e.newText.includes('-'.repeat(11))))
            .toBe(true);

        await session.configure({});
        expect((await format()).some(e => isBar(e.newText))).toBe(false);
    });

    test('ott.docs.baseUrl repoints keyword hover links without a restart', async () => {
        const uri = await session.open('syntax.ott');
        const hoverMetavar = async () => hoverText(await session.connection.sendRequest(HoverRequest.type, {
            textDocument: { uri },
            position: at('syntax.ott', 'metavar var', 0, 2),
        }));

        await session.configure({ docs: { baseUrl: 'https://first.example/docs' } });
        expect(await hoverMetavar()).toContain('https://first.example/docs');

        await session.configure({ docs: { baseUrl: 'https://second.example/docs' } });
        expect(await hoverMetavar()).toContain('https://second.example/docs');
    });

    test('ott.project.profile narrows symbol resolution to that profile', async () => {
        await session.configure({});
        expect(await definitionOfLabelUse()).toContain(uriOf('labels.ott'));

        // `core` leaves labels.ott out, so nothing declares `l`.
        await session.configure({ project: { profile: 'core' } });
        expect(await definitionOfLabelUse()).not.toContain(uriOf('labels.ott'));

        await session.configure({});
        expect(await definitionOfLabelUse()).toContain(uriOf('labels.ott'));
    });
});

describe('shutdown', () => {
    test('the server exits cleanly on shutdown + exit', async () => {
        const { session: own } = await LspSession.start();
        expect(await own.close()).toBe(0);
    });
});
