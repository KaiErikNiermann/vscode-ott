import * as vscode from 'vscode';
import { positionIn } from '../shared/fixtures.js';

export const EXTENSION_ID = 'KaiErikNiermann.vscode-vscode-ott';

/** The throwaway copy of the fixture workspace that .vscode-test.mjs opened. */
export function workspaceUri(...parts: string[]): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) throw new Error('the e2e suite needs a workspace folder');
    return vscode.Uri.joinPath(folder.uri, ...parts);
}

export async function open(...parts: string[]): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument(workspaceUri(...parts));
    return vscode.window.showTextDocument(document);
}

export function positionOf(document: vscode.TextDocument, needle: string, nth = 0, offset = 0): vscode.Position {
    const { line, character } = positionIn(document.getText(), needle, nth, offset);
    return new vscode.Position(line, character);
}

/**
 * Poll `probe` until it returns something `accept` likes. The language server
 * indexes the workspace in the background, so the first answer to a request
 * can legitimately be "nothing yet"; a fixed sleep would be either flaky or
 * slow.
 */
export async function eventually<T>(
    label: string, probe: () => Thenable<T> | T, accept: (value: T) => boolean, timeoutMs = 30_000,
): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: T | undefined;
    for (;;) {
        last = await probe();
        if (accept(last)) return last;
        if (Date.now() > deadline) {
            throw new Error(`timed out waiting for ${label}; last value: ${stringify(last)}`);
        }
        await new Promise(resolve => setTimeout(resolve, 200));
    }
}

function stringify(value: unknown): string {
    try {
        return JSON.stringify(value)?.slice(0, 2000) ?? String(value);
    } catch {
        return String(value);
    }
}

export const diagnosticsOf = (...parts: string[]): vscode.Diagnostic[] =>
    vscode.languages.getDiagnostics(workspaceUri(...parts));

/** Set an `ott.*` setting at workspace scope; `undefined` removes it. */
export async function setSetting(key: string, value: unknown): Promise<void> {
    await vscode.workspace.getConfiguration('ott').update(key, value, vscode.ConfigurationTarget.Workspace);
}

export const uriKey = (location: vscode.Location | vscode.LocationLink): string =>
    ('targetUri' in location ? location.targetUri : location.uri).toString();

export function hoverText(hovers: readonly vscode.Hover[]): string {
    return hovers.flatMap(h => h.contents).map(c => {
        if (typeof c === 'string') return c;
        return c.value;
    }).join('\n');
}
