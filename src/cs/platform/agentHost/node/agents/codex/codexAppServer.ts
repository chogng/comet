/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { ClientNotification } from './protocol/generated/ClientNotification.js';
import type { ClientRequest } from './protocol/generated/ClientRequest.js';
import type { RequestId } from './protocol/generated/RequestId.js';
import type { ServerNotification } from './protocol/generated/ServerNotification.js';
import type { ServerRequest } from './protocol/generated/ServerRequest.js';

interface IPendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
}

interface IWireError {
	readonly code: number;
	readonly message: string;
	readonly data?: unknown;
}

type MethodOf<TMessage> = TMessage extends { readonly method: infer TMethod } ? TMethod : never;
type ParamsOf<TMessage, TMethod> = TMessage extends {
	readonly method: TMethod;
	readonly params: infer TParams;
} ? TParams : never;

export type CodexClientRequestMethod = MethodOf<ClientRequest>;
export type CodexServerNotificationMethod = MethodOf<ServerNotification>;
export type CodexServerRequestMethod = MethodOf<ServerRequest>;
export type CodexClientRequestParams<TMethod extends CodexClientRequestMethod> = ParamsOf<ClientRequest, TMethod>;
export type CodexServerNotificationParams<TMethod extends CodexServerNotificationMethod> = ParamsOf<ServerNotification, TMethod>;
export type CodexServerRequestParams<TMethod extends CodexServerRequestMethod> = ParamsOf<ServerRequest, TMethod>;

export interface ICodexAppServerClient extends IDisposable {
	readonly onDidExit: Event<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
	request<TMethod extends CodexClientRequestMethod>(
		method: TMethod,
		params: CodexClientRequestParams<TMethod>,
	): Promise<unknown>;
	notify(notification: ClientNotification): void;
	onNotification<TMethod extends CodexServerNotificationMethod>(
		method: TMethod,
		handler: (params: CodexServerNotificationParams<TMethod>) => void,
	): IDisposable;
	onUnhandledNotification(handler: (method: string, params: unknown) => void): IDisposable;
	onRequest<TMethod extends CodexServerRequestMethod>(
		method: TMethod,
		handler: (id: RequestId, params: CodexServerRequestParams<TMethod>) => Promise<unknown>,
	): IDisposable;
}

export interface ICodexAppServerFactory {
	start(apiKey?: string): Promise<ICodexAppServerClient>;
}

export interface ICodexAppServerProcessFactoryOptions {
	readonly executable: string;
	readonly stateDirectory: string;
}

/** One exact NDJSON client for the Codex app-server shipped in the installed package. */
class CodexAppServerClient extends Disposable implements ICodexAppServerClient {
	private readonly exitEmitter = this._register(new Emitter<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>());
	readonly onDidExit = this.exitEmitter.event;

	private readonly pending = new Map<number, IPendingRequest>();
	private readonly notificationHandlers = new Map<string, (params: unknown) => void>();
	private readonly requestHandlers = new Map<string, (id: RequestId, params: unknown) => Promise<unknown>>();
	private unhandledNotificationHandler: ((method: string, params: unknown) => void) | undefined;
	private nextRequest = 1;
	private buffer = '';
	private exited = false;

	constructor(private readonly child: ChildProcessWithoutNullStreams) {
		super();
		child.stdout.setEncoding('utf8');
		const dataListener = (chunk: string | Buffer) => this.accept(String(chunk));
		child.stdout.on('data', dataListener);
		this._register(toDisposable(() => child.stdout.off('data', dataListener)));
		child.once('exit', (code, signal) => this.acceptExit(code, signal));
		child.once('error', error => this.acceptProcessError(error));
		const stdinErrorListener = (error: Error) => this.acceptProcessError(error);
		child.stdin.on('error', stdinErrorListener);
		this._register(toDisposable(() => child.stdin.off('error', stdinErrorListener)));
	}

	request<TMethod extends CodexClientRequestMethod>(
		method: TMethod,
		params: CodexClientRequestParams<TMethod>,
	): Promise<unknown> {
		if (this.exited) {
			return Promise.reject(new Error('Codex app-server has exited.'));
		}
		const id = this.nextRequest++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.write({ id, method, params });
		});
	}

	notify(notification: ClientNotification): void {
		if (!this.exited) {
			this.write(notification);
		}
	}

	onNotification<TMethod extends CodexServerNotificationMethod>(
		method: TMethod,
		handler: (params: CodexServerNotificationParams<TMethod>) => void,
	): IDisposable {
		if (this.notificationHandlers.has(method)) {
			throw new Error(`Codex app-server notification '${method}' already has a handler.`);
		}
		this.notificationHandlers.set(method, params => handler(params as CodexServerNotificationParams<TMethod>));
		return toDisposable(() => this.notificationHandlers.delete(method));
	}

	onUnhandledNotification(handler: (method: string, params: unknown) => void): IDisposable {
		if (this.unhandledNotificationHandler !== undefined) {
			throw new Error('Codex app-server already has an unhandled notification handler.');
		}
		this.unhandledNotificationHandler = handler;
		return toDisposable(() => {
			if (this.unhandledNotificationHandler === handler) {
				this.unhandledNotificationHandler = undefined;
			}
		});
	}

	onRequest<TMethod extends CodexServerRequestMethod>(
		method: TMethod,
		handler: (id: RequestId, params: CodexServerRequestParams<TMethod>) => Promise<unknown>,
	): IDisposable {
		if (this.requestHandlers.has(method)) {
			throw new Error(`Codex app-server request '${method}' already has a handler.`);
		}
		this.requestHandlers.set(
			method,
			(id, params) => handler(id, params as CodexServerRequestParams<TMethod>),
		);
		return toDisposable(() => this.requestHandlers.delete(method));
	}

	private accept(chunk: string): void {
		this.buffer += chunk;
		for (;;) {
			const newline = this.buffer.indexOf('\n');
			if (newline < 0) {
				return;
			}
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (line.length === 0) {
				continue;
			}
			let message: unknown;
			try {
				message = JSON.parse(line);
			} catch {
				this.failAll(new Error('Codex app-server emitted invalid JSON.'));
				this.child.kill('SIGKILL');
				return;
			}
			this.dispatch(message);
		}
	}

	private dispatch(message: unknown): void {
		if (message === null || typeof message !== 'object' || Array.isArray(message)) {
			this.failProtocol('Codex app-server emitted a non-object message.');
			return;
		}
		const record = message as Readonly<Record<string, unknown>>;
		const requestId = typeof record.id === 'number' || typeof record.id === 'string' ? record.id : undefined;
		if (typeof record.id === 'number' && record.method === undefined) {
			const pending = this.pending.get(record.id);
			if (pending === undefined) {
				this.failProtocol('Codex app-server emitted an unknown response identity.');
				return;
			}
			this.pending.delete(record.id);
			if (record.error !== undefined) {
				pending.reject(this.rpcError(record.error));
			} else if (Object.hasOwn(record, 'result')) {
				pending.resolve(record.result);
			} else {
				pending.reject(new Error('Codex app-server response has no result.'));
			}
			return;
		}
		if (typeof record.method !== 'string') {
			this.failProtocol('Codex app-server message has no method.');
			return;
		}
		if (requestId !== undefined) {
			void this.dispatchRequest(requestId, record.method, record.params);
			return;
		}
		const handler = this.notificationHandlers.get(record.method);
		if (handler !== undefined) {
			try {
				handler(record.params);
			} catch {
				this.failProtocol(`Codex app-server notification '${record.method}' is invalid.`);
			}
		} else if (this.unhandledNotificationHandler !== undefined) {
			try {
				this.unhandledNotificationHandler(record.method, record.params);
			} catch {
				this.failProtocol(`Codex app-server notification '${record.method}' is unsupported.`);
			}
		} else {
			this.failProtocol(`Codex app-server notification '${record.method}' has no handler.`);
		}
	}

	private async dispatchRequest(id: RequestId, method: string, params: unknown): Promise<void> {
		const handler = this.requestHandlers.get(method);
		if (handler === undefined) {
			this.write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
			return;
		}
		try {
			this.write({ id, result: await handler(id, params) });
		} catch (error) {
			this.write({
				id,
				error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
			});
		}
	}

	private rpcError(value: unknown): Error {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			return new Error('Codex app-server returned an invalid error.');
		}
		const error = value as Partial<IWireError>;
		return new Error(typeof error.message === 'string' ? error.message : 'Codex app-server request failed.');
	}

	private write(message: unknown): void {
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private failProtocol(message: string): void {
		this.failAll(new Error(message));
		this.child.kill('SIGKILL');
	}

	private acceptProcessError(error: Error): void {
		if (this.exited) {
			return;
		}
		this.exited = true;
		this.failAll(error);
		this.exitEmitter.fire({ code: null, signal: null });
	}

	private acceptExit(code: number | null, signal: NodeJS.Signals | null): void {
		if (this.exited) {
			return;
		}
		this.exited = true;
		this.failAll(new Error(`Codex app-server exited (code=${code}, signal=${signal}).`));
		this.exitEmitter.fire({ code, signal });
	}

	private failAll(error: Error): void {
		for (const request of this.pending.values()) {
			request.reject(error);
		}
		this.pending.clear();
	}

	override dispose(): void {
		if (!this.exited) {
			this.child.stdin.end();
			this.child.kill();
		}
		super.dispose();
	}
}

/** Creates app-server processes from the immutable Codex executable receipt. */
export class CodexAppServerProcessFactory implements ICodexAppServerFactory {
	private readonly executable: string;
	private readonly stateDirectory: string;

	constructor(options: ICodexAppServerProcessFactoryOptions) {
		if (!isAbsolute(options.executable) || !isAbsolute(options.stateDirectory)) {
			throw new Error('Codex app-server paths must be absolute.');
		}
		this.executable = options.executable;
		this.stateDirectory = options.stateDirectory;
	}

	async start(apiKey?: string): Promise<ICodexAppServerClient> {
		await this.prepareStateDirectory();
		const commonArguments = ['-c', 'features.remote_plugin=false'];
		const providerArguments = apiKey === undefined ? [] : [
			'-c', 'model_provider="comet-openai"',
			'-c', 'model_providers.comet-openai.name="OpenAI"',
			'-c', 'model_providers.comet-openai.base_url="https://api.openai.com/v1"',
			'-c', 'model_providers.comet-openai.wire_api="responses"',
			'-c', 'model_providers.comet-openai.env_key="OPENAI_API_KEY"',
			'-c', 'model_providers.comet-openai.requires_openai_auth=false',
			'-c', 'model_providers.comet-openai.supports_websockets=true',
		];
		const environment: NodeJS.ProcessEnv = {
			CODEX_HOME: this.stateDirectory,
			HOME: this.stateDirectory,
			...(apiKey === undefined ? {} : { OPENAI_API_KEY: apiKey }),
		};
		if (process.platform === 'win32') {
			environment.USERPROFILE = this.stateDirectory;
			environment.SYSTEMROOT = 'C:\\Windows';
		} else {
			environment.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
		}
		const child = spawn(this.executable, ['app-server', ...commonArguments, ...providerArguments], {
			cwd: this.stateDirectory,
			env: environment,
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		child.stderr.resume();
		const client = new CodexAppServerClient(child);
		try {
				await client.request('initialize', {
					clientInfo: { name: 'comet', title: 'Comet', version: '0.1.0' },
					capabilities: { experimentalApi: true, requestAttestation: false },
				});
				client.notify({ method: 'initialized' });
			return client;
		} catch (error) {
			client.dispose();
			throw error;
		}
	}

	private async prepareStateDirectory(): Promise<void> {
		await mkdir(this.stateDirectory, { recursive: true, mode: 0o700 });
		const metadata = await lstat(this.stateDirectory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error('Codex app-server state root must be a real directory.');
		}
		if (await realpath(this.stateDirectory) !== this.stateDirectory) {
			throw new Error('Codex app-server state root has the wrong canonical address.');
		}
		await chmod(this.stateDirectory, 0o700);
	}
}
