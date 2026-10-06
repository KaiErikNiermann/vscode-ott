import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { LABEL_USE, RULE_SEPARATOR_WARNING, applyEdits, varBarWidth } from '../shared/fixtures.js';
import {
    EXTENSION_ID, diagnosticsOf, eventually, hoverText, open, positionOf, setSetting, uriKey, workspaceUri,
} from './util.js';

/**
 * The extension inside a real VS Code: activation, the contributed language,
 * grammar and configuration, and every language feature as VS Code's own
 * command layer sees it — which is the same path an editor action takes,
 * through the language client and over IPC to the bundled server.
 */

const { Error: ErrorSeverity, Warning } = vscode.DiagnosticSeverity;

suite('activation', () => {
    test('opening an .ott file activates the extension under the ott language', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `${EXTENSION_ID} is not installed in the test instance`);

        const editor = await open('syntax.ott');
        assert.equal(editor.document.languageId, 'ott');
        await eventually('activation', () => extension.isActive, active => active);
    });

    test('every file the manifest contributes exists', () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension);
        const manifest = extension.packageJSON as {
            main: string;
            icon: string;
            contributes: {
                languages: Array<{ configuration: string; icon: { light: string; dark: string } }>;
                grammars: Array<{ path: string }>;
            };
        };
        const paths = [
            manifest.main,
            manifest.icon,
            join('out', 'language', 'main.cjs'),
            ...manifest.contributes.languages.flatMap(l => [l.configuration, l.icon.light, l.icon.dark]),
            ...manifest.contributes.grammars.map(g => g.path),
        ];
        const missing = paths.filter(p => !existsSync(join(extension.extensionPath, p)));
        assert.deepEqual(missing, []);
    });
});

suite('diagnostics', () => {
    test('a well-formed project file has no errors', async () => {
        await open('typing.ott');
        // Give the server time to publish, then require that what it published has no errors.
        await eventually('typing.ott to be validated', () => diagnosticsOf('typing.ott'), () => true);
        await new Promise(resolve => setTimeout(resolve, 1000));
        assert.deepEqual(diagnosticsOf('typing.ott').filter(d => d.severity === ErrorSeverity), []);
    });

    test('a parse error shows as an error', async () => {
        await open('diagnostics', 'broken.ott');
        await eventually('a parse error', () => diagnosticsOf('diagnostics', 'broken.ott'),
            ds => ds.some(d => d.severity === ErrorSeverity));
    });

    test('a validator warning shows as a warning', async () => {
        await open('diagnostics', 'unnamed.ott');
        await eventually('the unnamed-rule warning', () => diagnosticsOf('diagnostics', 'unnamed.ott'),
            ds => ds.some(d => d.severity === Warning && d.message === RULE_SEPARATOR_WARNING));
    });

    test('breaking a file reports it, and undoing the edit clears it', async () => {
        const editor = await open('syntax.ott');
        const line = positionOf(editor.document, '| bool        ::   :: bool');
        const range = new vscode.Range(line, line.translate(0, '| bool        ::   :: bool'.length));
        await editor.edit(edit => edit.replace(range, '| bool        ::'));
        await eventually('the broken edit to be reported', () => diagnosticsOf('syntax.ott'),
            ds => ds.some(d => d.severity === ErrorSeverity));

        await vscode.commands.executeCommand('undo');
        await eventually('the error to clear after undo', () => diagnosticsOf('syntax.ott'),
            ds => !ds.some(d => d.severity === ErrorSeverity));
        await editor.document.save();
    });
});

suite('language features', () => {
    const at = async (file: string, needle: string, offset = 0) => {
        const editor = await open(file);
        return { uri: editor.document.uri, position: positionOf(editor.document, needle, 0, offset) };
    };

    test('go to definition crosses into the declaring file', async () => {
        const { uri, position } = await at(LABEL_USE.file, LABEL_USE.needle, LABEL_USE.offset);
        await eventually('a definition in labels.ott',
            () => vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
                'vscode.executeDefinitionProvider', uri, position),
            links => (links ?? []).map(uriKey).includes(workspaceUri('labels.ott').toString()));
    });

    test('find references from a declaration reaches other files', async () => {
        const { uri, position } = await at('syntax.ott', 'typ, T', 'typ, '.length);
        await eventually('references in typing.ott',
            () => vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, position),
            locations => (locations ?? []).map(uriKey).includes(workspaceUri('typing.ott').toString()));
    });

    test('hover on a use names its declaring file', async () => {
        const { uri, position } = await at(LABEL_USE.file, LABEL_USE.needle, LABEL_USE.offset);
        await eventually('a hover mentioning labels.ott',
            () => vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, position),
            hovers => hoverText(hovers ?? []).includes('labels.ott'));
    });

    test('completion inside a rule offers roots from sibling files', async () => {
        const needle = 'G |- e1 e2 : ';
        const { uri, position } = await at('typing.ott', needle, needle.length);
        await eventually('completion offering T and l',
            () => vscode.commands.executeCommand<vscode.CompletionList>(
                'vscode.executeCompletionItemProvider', uri, position),
            list => {
                const labels = (list?.items ?? []).map(i => (typeof i.label === 'string' ? i.label : i.label.label));
                return labels.includes('T') && labels.includes('l');
            });
    });

    test('document symbols outline the grammar', async () => {
        const { uri } = await at('syntax.ott', 'grammar');
        const symbols = await eventually('document symbols',
            () => vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri),
            list => (list ?? []).length > 0);
        const names = JSON.stringify(symbols.map(function flat(s: vscode.DocumentSymbol): unknown {
            return [s.name, s.children.map(flat)];
        }));
        assert.match(names, /typ/);
        assert.match(names, /exp/);
    });

    test('semantic tokens are produced against the contributed legend', async () => {
        const { uri } = await at('typing.ott', 'defns');
        const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend>(
            'vscode.provideDocumentSemanticTokensLegend', uri);
        assert.ok((legend?.tokenTypes.length ?? 0) > 0, 'no semantic token legend');
        await eventually('semantic tokens',
            () => vscode.commands.executeCommand<vscode.SemanticTokens>('vscode.provideDocumentSemanticTokens', uri),
            tokens => (tokens?.data.length ?? 0) > 0);
    });

    test('the language configuration comments lines with %', async () => {
        const editor = await open('labels.ott');
        const line = positionOf(editor.document, 'metavar label').line;
        editor.selection = new vscode.Selection(line, 0, line, 0);
        await vscode.commands.executeCommand('editor.action.commentLine');
        try {
            assert.match(editor.document.lineAt(line).text, /^%\s*metavar label/);
        } finally {
            await vscode.commands.executeCommand('undo');
        }
        assert.match(editor.document.lineAt(line).text, /^metavar label/);
    });
});

suite('settings', () => {
    teardown(async () => {
        for (const key of ['format.rules.bar', 'docs.baseUrl', 'project.profile']) {
            await setSetting(key, undefined);
        }
    });

    /** Width of the `var` rule's bar after formatting typing.ott. */
    const formattedBar = async (): Promise<number> => {
        const { document } = await open('typing.ott');
        const edits = (await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatDocumentProvider', document.uri, { tabSize: 2, insertSpaces: true },
        )) ?? [];
        return varBarWidth(applyEdits(document.getText(), edits));
    };

    test('ott.format.rules.bar reaches the formatter', async () => {
        assert.equal(await formattedBar(), 13, 'bars are resized with the setting off');
        await setSetting('format.rules.bar', 'fit');
        await eventually('the bar fitted to its rule', formattedBar, width => width === 10);
        await setSetting('format.rules.bar', undefined);
        await eventually('the bar left alone again', formattedBar, width => width === 13);
    });

    test('ott.docs.baseUrl reaches keyword hovers', async () => {
        const editor = await open('syntax.ott');
        const position = positionOf(editor.document, 'metavar var', 0, 2);
        const hover = () => vscode.commands.executeCommand<vscode.Hover[]>(
            'vscode.executeHoverProvider', editor.document.uri, position);

        await setSetting('docs.baseUrl', 'https://first.example/docs');
        await eventually('the first base URL', hover, h => hoverText(h ?? []).includes('https://first.example/docs'));
        await setSetting('docs.baseUrl', 'https://second.example/docs');
        await eventually('the second base URL', hover, h => hoverText(h ?? []).includes('https://second.example/docs'));
    });

    test('ott.project.profile changes which files resolve symbols', async () => {
        const editor = await open(LABEL_USE.file);
        const position = positionOf(editor.document, LABEL_USE.needle, 0, LABEL_USE.offset);
        const labels = workspaceUri('labels.ott').toString();
        const definition = async () => ((await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
            'vscode.executeDefinitionProvider', editor.document.uri, position)) ?? []).map(uriKey);

        await eventually('l to resolve under the default source set', definition, d => d.includes(labels));
        await setSetting('project.profile', 'core');
        await eventually('l to stop resolving under `core`', definition, d => !d.includes(labels));
        await setSetting('project.profile', undefined);
        await eventually('l to resolve again', definition, d => d.includes(labels));
    });
});
