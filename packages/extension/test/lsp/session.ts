import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    ConfigurationRequest, DidChangeConfigurationNotification, DidOpenTextDocumentNotification,
    ExitNotification, InitializedNotification, InitializeRequest, PublishDiagnosticsNotification,
    RegistrationRequest, ShutdownRequest, StreamMessageReader, StreamMessageWriter,
    WorkDoneProgressCreateRequest, createProtocolConnection,
    type Diagnostic, type InitializeResult, type ProtocolConnection,
} from 'vscode-languageserver-protocol/node';
import { REPO_ROOT, WORKSPACE, fixture, readFixture } from '../shared/fixtures.js';

/** What a client hands back for `workspace/configuration` with section `ott`. */
export type OttSettings = Record<string, unknown>;

export const uriOf = (...parts: string[]): string => pathToFileURL(fixture(...parts)).href;

/**
 * A language client driving `bin/ott-language-server --stdio` as a separate
 * process — the exact command the Neovim plugin runs. Nothing is imported from
 * the server: everything crosses the wire as JSON-RPC, so the bundle, the bin
 * shim and the protocol versions are all under test.
 */
export class LspSession {
    readonly stderr: string[] = [];
    private readonly diagnostics = new Map<string, Diagnostic[]>();
    private readonly waiters: Array<() => void> = [];
    private settings: OttSettings = {};
    private exitCode: number | null = null;
    private readonly exited: Promise<number | null>;

    private constructor(
        private readonly child: ChildProcessWithoutNullStreams,
        readonly connection: ProtocolConnection,
    ) {
        child.stderr.on('data', (chunk: Buffer) => this.stderr.push(chunk.toString()));
        this.exited = new Promise(resolve => child.on('exit', code => {
            this.exitCode = code;
            resolve(code);
        }));

        connection.onRequest(ConfigurationRequest.type, params =>
            params.items.map(item => (item.section === 'ott' ? this.settings : null)));
        connection.onRequest(RegistrationRequest.type, () => undefined);
        connection.onRequest(WorkDoneProgressCreateRequest.type, () => undefined);
        connection.onNotification(PublishDiagnosticsNotification.type, params => {
            this.diagnostics.set(params.uri, params.diagnostics);
            for (const wake of this.waiters.splice(0)) wake();
        });
        connection.listen();
    }

    static async start(settings: OttSettings = {}): Promise<{ session: LspSession; capabilities: InitializeResult }> {
        const child = spawn(process.execPath, [join(REPO_ROOT, 'bin', 'ott-language-server'), '--stdio'], {
            stdio: 'pipe',
        });
        const connection = createProtocolConnection(
            new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin),
        );
        const session = new LspSession(child, connection);
        session.settings = settings;

        const rootUri = pathToFileURL(WORKSPACE).href;
        const capabilities = await session.within(10_000, 'initialize', connection.sendRequest(InitializeRequest.type, {
            processId: process.pid,
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: 'workspace' }],
            capabilities: {
                workspace: {
                    configuration: true,
                    didChangeConfiguration: { dynamicRegistration: true },
                    workspaceFolders: true,
                },
                textDocument: {
                    hover: { contentFormat: ['markdown', 'plaintext'] },
                    publishDiagnostics: {},
                    synchronization: { dynamicRegistration: false },
                },
            },
        }));
        await connection.sendNotification(InitializedNotification.type, {});
        return { session, capabilities };
    }

    /** Push new `ott` settings the way VS Code's client does on a settings edit. */
    async configure(settings: OttSettings): Promise<void> {
        this.settings = settings;
        await this.connection.sendNotification(DidChangeConfigurationNotification.type, {
            settings: { ott: settings },
        });
    }

    async open(...parts: string[]): Promise<string> {
        const uri = uriOf(...parts);
        await this.connection.sendNotification(DidOpenTextDocumentNotification.type, {
            textDocument: { uri, languageId: 'ott', version: 1, text: readFixture(...parts) },
        });
        return uri;
    }

    /** The latest diagnostics for `uri` that satisfy `accept`, waiting for them to be published. */
    async diagnosticsFor(
        uri: string, accept: (d: Diagnostic[]) => boolean = () => true, timeoutMs = 15_000,
    ): Promise<Diagnostic[]> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const current = this.diagnostics.get(uri);
            if (current && accept(current)) return current;
            const left = deadline - Date.now();
            if (left <= 0) {
                throw new Error(`no matching diagnostics for ${uri}; last: ${JSON.stringify(current)}`);
            }
            await new Promise<void>(resolve => {
                const timer = setTimeout(resolve, left);
                this.waiters.push(() => { clearTimeout(timer); resolve(); });
            });
        }
    }

    /** Reject with the server's stderr if `promise` takes longer than `ms`. */
    within<T>(ms: number, label: string, promise: Promise<T>): Promise<T> {
        return Promise.race([
            promise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(
                `${label} timed out after ${ms}ms (server exit: ${this.exitCode}); stderr:\n${this.stderr.join('')}`,
            )), ms).unref()),
        ]);
    }

    /** Shut the server down politely and return its exit code. */
    async close(): Promise<number | null> {
        if (this.exitCode === null) {
            await this.within(5000, 'shutdown', this.connection.sendRequest(ShutdownRequest.type));
            await this.connection.sendNotification(ExitNotification.type);
        }
        const code = await this.within(5000, 'exit', this.exited);
        this.connection.dispose();
        return code;
    }

    kill(): void {
        this.child.kill();
        this.connection.dispose();
    }
}
