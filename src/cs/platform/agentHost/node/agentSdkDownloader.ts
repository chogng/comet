/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomUUID } from 'node:crypto';
import {
	lstat,
	mkdir,
	open,
	realpath,
	readdir,
	rename,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { x as extractTar } from 'tar';

import type { CancellationToken } from 'cs/base/common/cancellation';
import { CancellationError } from 'cs/base/common/errors';
import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';

const maximumSdkArchiveBytes = 512 * 1024 * 1024;
const maximumExtractedSdkBytes = 2 * 1024 * 1024 * 1024;
const maximumExtractedSdkEntries = 100_000;
const progressIntervalMilliseconds = 250;
const failureLatchMilliseconds = 30_000;
const completeSentinelName = '.complete';

export interface IAgentSdkPackage {
	readonly id: string;
	readonly displayName: string;
	readonly developmentRootEnvironmentVariable: string;
	readonly hasSeparateMuslLinuxTarget: boolean;
}

export interface IAgentSdkProductConfiguration {
	readonly version: string;
	readonly urlTemplate: string;
}

export interface IAgentSdkTargetHost {
	readonly platform: NodeJS.Platform;
	readonly architecture: string;
	readonly libc: 'glibc' | 'musl' | undefined;
}

export type AgentSdkDownloadPhase = 'started' | 'progress' | 'completed' | 'failed';

export interface IAgentSdkDownloadProgress {
	readonly downloadId: string;
	readonly packageId: string;
	readonly displayName: string;
	readonly phase: AgentSdkDownloadPhase;
	readonly receivedBytes: number;
	readonly totalBytes: number | undefined;
	readonly error?: string;
}

export interface IAgentSdkDownloaderOptions {
	readonly cacheRoot: string;
	readonly products: Readonly<Record<string, IAgentSdkProductConfiguration>>;
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	readonly now: () => number;
	readonly host?: IAgentSdkTargetHost;
	readonly environment?: Readonly<Record<string, string | undefined>>;
}

interface IAgentSdkDownloadFailure {
	readonly error: Error;
	readonly expiresAt: number;
}

function currentLibc(): IAgentSdkTargetHost['libc'] {
	if (process.platform !== 'linux') {
		return undefined;
	}
	const report = process.report?.getReport() as { readonly header?: unknown } | undefined;
	const header = report?.header as { readonly glibcVersionRuntime?: unknown } | undefined;
	return typeof header?.glibcVersionRuntime === 'string' ? 'glibc' : 'musl';
}

export function resolveAgentSdkTarget(
	pkg: Pick<IAgentSdkPackage, 'hasSeparateMuslLinuxTarget'>,
	host: IAgentSdkTargetHost = {
		platform: process.platform,
		architecture: process.arch,
		libc: currentLibc(),
	},
): string | undefined {
	if (
		(host.platform !== 'darwin' && host.platform !== 'linux' && host.platform !== 'win32')
		|| (host.architecture !== 'arm64' && host.architecture !== 'x64')
	) {
		return undefined;
	}
	if (host.platform === 'linux' && host.libc === 'musl' && pkg.hasSeparateMuslLinuxTarget) {
		return `linux-${host.architecture}-musl`;
	}
	return `${host.platform}-${host.architecture}`;
}

function validatePackage(pkg: IAgentSdkPackage): void {
	if (
		!/^[a-z][a-z0-9-]{0,63}$/.test(pkg.id)
		|| pkg.displayName.length === 0
		|| pkg.displayName.length > 128
		|| !/^[A-Z][A-Z0-9_]{0,127}$/.test(pkg.developmentRootEnvironmentVariable)
	) {
		throw new Error('Agent SDK package definition is invalid.');
	}
}

function validateProductConfiguration(
	packageId: string,
	value: IAgentSdkProductConfiguration,
): IAgentSdkProductConfiguration {
	if (
		!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(value.version)
		|| value.urlTemplate.length === 0
		|| value.urlTemplate.length > 4_096
		|| !value.urlTemplate.includes('{sdkTarget}')
	) {
		throw new Error(`Agent SDK product configuration '${packageId}' is invalid.`);
	}
	const unknownPlaceholder = /{(?!sdkTarget})[^}]*}/.exec(value.urlTemplate);
	if (unknownPlaceholder !== null) {
		throw new Error(
			`Agent SDK product configuration '${packageId}' contains unsupported placeholder '${unknownPlaceholder[0]}'.`,
		);
	}
	let url: URL;
	try {
		url = new URL(value.urlTemplate.replaceAll('{sdkTarget}', 'darwin-arm64'));
	} catch {
		throw new Error(`Agent SDK product configuration '${packageId}' has an invalid URL template.`);
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error(`Agent SDK product configuration '${packageId}' must use HTTP or HTTPS.`);
	}
	return Object.freeze({ version: value.version, urlTemplate: value.urlTemplate });
}

function parseContentLength(value: string | null): number | undefined {
	if (value === null || !/^[0-9]+$/.test(value)) {
		return undefined;
	}
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function assertArchiveEntry(entryPath: string, type: string): boolean {
	const normalized = path.posix.normalize(entryPath.replaceAll('\\', '/'));
	if (
		normalized.length === 0
		|| normalized === '.'
		|| normalized === '..'
		|| normalized.startsWith('../')
		|| normalized.startsWith('/')
		|| normalized === completeSentinelName
		|| normalized.endsWith(`/${completeSentinelName}`)
		|| (type !== 'File' && type !== 'OldFile' && type !== 'Directory')
	) {
		throw new Error(`Agent SDK archive contains invalid entry '${entryPath}'.`);
	}
	return true;
}

async function assertExtractedTree(root: string): Promise<void> {
	const visit = async (directory: string): Promise<void> => {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const candidate = path.join(directory, entry.name);
			const metadata = await lstat(candidate);
			if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
				throw new Error(`Agent SDK archive extracted unsupported entry '${entry.name}'.`);
			}
			if (metadata.isDirectory()) {
				await visit(candidate);
			}
		}
	};
	await visit(root);
}

/** Resolves exact product-owned Agent SDKs through one versioned target cache. */
export class AgentSdkDownloader extends Disposable {
	private readonly progressEmitter = this._register(new Emitter<IAgentSdkDownloadProgress>());
	readonly onDidDownloadProgress: Event<IAgentSdkDownloadProgress> = this.progressEmitter.event;

	private readonly cacheRoot: string;
	private readonly products: ReadonlyMap<string, IAgentSdkProductConfiguration>;
	private readonly host: IAgentSdkTargetHost;
	private readonly environment: Readonly<Record<string, string | undefined>>;
	private readonly pendingDownloads = new Map<string, Promise<string>>();
	private readonly failures = new Map<string, IAgentSdkDownloadFailure>();

	constructor(private readonly options: IAgentSdkDownloaderOptions) {
		super();
		if (!path.isAbsolute(options.cacheRoot)) {
			throw new Error('Agent SDK cache root must be absolute.');
		}
		this.cacheRoot = path.resolve(options.cacheRoot);
		this.products = new Map(Object.entries(options.products).map(([packageId, value]) => [
			packageId,
			validateProductConfiguration(packageId, value),
		]));
		this.host = options.host ?? {
			platform: process.platform,
			architecture: process.arch,
			libc: currentLibc(),
		};
		this.environment = options.environment ?? process.env;
	}

	isAvailable(pkg: IAgentSdkPackage): boolean {
		validatePackage(pkg);
		if (this.environment[pkg.developmentRootEnvironmentVariable] !== undefined) {
			return true;
		}
		return this.products.has(pkg.id) && resolveAgentSdkTarget(pkg, this.host) !== undefined;
	}

	async isSdkResolvableWithoutDownload(pkg: IAgentSdkPackage): Promise<boolean> {
		validatePackage(pkg);
		if (this.environment[pkg.developmentRootEnvironmentVariable] !== undefined) {
			return true;
		}
		const resolved = this.resolveConfiguredCache(pkg);
		if (resolved === undefined) {
			return false;
		}
		try {
			return (await stat(resolved.sentinel)).isFile();
		} catch {
			return false;
		}
	}

	async loadSdkRoot(pkg: IAgentSdkPackage, token: CancellationToken): Promise<string> {
		validatePackage(pkg);
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const developmentRoot = this.environment[pkg.developmentRootEnvironmentVariable];
		if (developmentRoot !== undefined) {
			return this.resolveDevelopmentRoot(developmentRoot, pkg);
		}
		const resolved = this.resolveConfiguredCache(pkg);
		if (resolved === undefined) {
			throw new Error(`Agent SDK '${pkg.id}' is unavailable for this product and host.`);
		}
		const latched = this.failures.get(resolved.cacheDirectory);
		if (latched !== undefined && latched.expiresAt > this.options.now()) {
			throw latched.error;
		}
		try {
			const root = await this.resolveOrDownload(pkg, resolved, token);
			this.failures.delete(resolved.cacheDirectory);
			return root;
		} catch (error) {
			if (token.isCancellationRequested || error instanceof CancellationError) {
				throw error;
			}
			const failure = error instanceof Error ? error : new Error(String(error));
			this.failures.set(resolved.cacheDirectory, Object.freeze({
				error: failure,
				expiresAt: this.options.now() + failureLatchMilliseconds,
			}));
			throw failure;
		}
	}

	private async resolveDevelopmentRoot(value: string, pkg: IAgentSdkPackage): Promise<string> {
		if (!path.isAbsolute(value)) {
			throw new Error(`Agent SDK development root '${pkg.developmentRootEnvironmentVariable}' must be absolute.`);
		}
		const root = await realpath(value);
		if (!(await stat(root)).isDirectory()) {
			throw new Error(`Agent SDK development root '${pkg.developmentRootEnvironmentVariable}' must be a directory.`);
		}
		return root;
	}

	private resolveConfiguredCache(pkg: IAgentSdkPackage): {
		readonly cacheDirectory: string;
		readonly sentinel: string;
		readonly url: string;
	} | undefined {
		const product = this.products.get(pkg.id);
		const target = resolveAgentSdkTarget(pkg, this.host);
		if (product === undefined || target === undefined) {
			return undefined;
		}
		const cacheDirectory = path.join(this.cacheRoot, pkg.id, product.version, target);
		return Object.freeze({
			cacheDirectory,
			sentinel: path.join(cacheDirectory, completeSentinelName),
			url: product.urlTemplate.replaceAll('{sdkTarget}', target),
		});
	}

	private async resolveOrDownload(
		pkg: IAgentSdkPackage,
		resolved: {
			readonly cacheDirectory: string;
			readonly sentinel: string;
			readonly url: string;
		},
		token: CancellationToken,
	): Promise<string> {
		try {
			if ((await stat(resolved.sentinel)).isFile()) {
				return resolved.cacheDirectory;
			}
		} catch {
		}
		let pending = this.pendingDownloads.get(resolved.cacheDirectory);
		if (pending === undefined) {
			pending = this.download(pkg, resolved, token).finally(() => {
				this.pendingDownloads.delete(resolved.cacheDirectory);
			});
			this.pendingDownloads.set(resolved.cacheDirectory, pending);
		}
		return pending;
	}

	private async download(
		pkg: IAgentSdkPackage,
		resolved: {
			readonly cacheDirectory: string;
			readonly sentinel: string;
			readonly url: string;
		},
		token: CancellationToken,
	): Promise<string> {
		const downloadId = randomUUID();
		const parent = path.dirname(resolved.cacheDirectory);
		const temporaryDirectory = `${resolved.cacheDirectory}.tmp.${process.pid}.${randomUUID()}`;
		const archive = path.join(temporaryDirectory, 'sdk.tgz');
		let receivedBytes = 0;
		let totalBytes: number | undefined;
		await mkdir(parent, { recursive: true });
		await mkdir(temporaryDirectory, { recursive: true });
		this.emitProgress(pkg, downloadId, 'started', receivedBytes, totalBytes);
		try {
			const result = await this.fetchArchive(resolved.url, archive, token, (received, total) => {
				receivedBytes = received;
				totalBytes = total;
				this.emitProgress(pkg, downloadId, 'progress', received, total);
			});
			receivedBytes = result.receivedBytes;
			totalBytes = result.totalBytes;
			let invalidArchiveEntry: Error | undefined;
			let extractedBytes = 0;
			let extractedEntries = 0;
			await extractTar({
				cwd: temporaryDirectory,
				file: archive,
				filter: (entryPath, entry) => {
					try {
						extractedEntries += 1;
						extractedBytes += entry.size;
						if (
							extractedEntries > maximumExtractedSdkEntries
							|| extractedBytes > maximumExtractedSdkBytes
						) {
							throw new Error('Agent SDK archive exceeds the maximum extracted size.');
						}
						return assertArchiveEntry(
							entryPath,
							'type' in entry
								? entry.type
								: entry.isDirectory()
									? 'Directory'
									: entry.isFile()
										? 'File'
										: 'Unsupported',
						);
					} catch (error) {
						invalidArchiveEntry ??= error instanceof Error ? error : new Error(String(error));
						return false;
					}
				},
				preservePaths: false,
				strict: true,
			});
			if (invalidArchiveEntry !== undefined) {
				throw invalidArchiveEntry;
			}
			await rm(archive, { force: true });
			await assertExtractedTree(temporaryDirectory);
			await writeFile(path.join(temporaryDirectory, completeSentinelName), '');
			try {
				await rename(temporaryDirectory, resolved.cacheDirectory);
			} catch (error) {
				try {
					if ((await stat(resolved.sentinel)).isFile()) {
						await rm(temporaryDirectory, { recursive: true, force: true });
						this.emitProgress(pkg, downloadId, 'completed', receivedBytes, totalBytes);
						return resolved.cacheDirectory;
					}
				} catch {
				}
				throw error;
			}
			this.emitProgress(pkg, downloadId, 'completed', totalBytes ?? receivedBytes, totalBytes);
			return resolved.cacheDirectory;
		} catch (error) {
			await rm(temporaryDirectory, { recursive: true, force: true });
			const cancelled = token.isCancellationRequested || error instanceof CancellationError;
			const message = cancelled ? 'cancelled' : error instanceof Error ? error.message : String(error);
			this.emitProgress(pkg, downloadId, 'failed', receivedBytes, totalBytes, message);
			if (cancelled) {
				throw new CancellationError();
			}
			throw new Error(`Failed to prepare Agent SDK '${pkg.id}' from '${resolved.url}': ${message}`);
		}
	}

	private async fetchArchive(
		url: string,
		destination: string,
		token: CancellationToken,
		onProgress: (receivedBytes: number, totalBytes: number | undefined) => void,
	): Promise<{ readonly receivedBytes: number; readonly totalBytes: number | undefined }> {
		const controller = new AbortController();
		const cancellation = token.onCancellationRequested(() => controller.abort());
		try {
			const response = await this.options.fetch(url, Object.freeze({
				method: 'GET',
				signal: controller.signal,
			}));
			if (!response.ok || response.body === null) {
				throw new Error(`HTTP ${response.status}`);
			}
			const totalBytes = parseContentLength(response.headers.get('content-length'));
			if (totalBytes !== undefined && totalBytes > maximumSdkArchiveBytes) {
				throw new Error('Agent SDK archive exceeds the maximum download size.');
			}
			const file = await open(destination, 'wx', 0o600);
			const reader = response.body.getReader();
			let receivedBytes = 0;
			let lastProgressAt = 0;
			try {
				for (;;) {
					if (token.isCancellationRequested) {
						throw new CancellationError();
					}
					const chunk = await reader.read();
					if (chunk.done) {
						break;
					}
					receivedBytes += chunk.value.byteLength;
					if (receivedBytes > maximumSdkArchiveBytes) {
						throw new Error('Agent SDK archive exceeds the maximum download size.');
					}
					let writtenBytes = 0;
					while (writtenBytes < chunk.value.byteLength) {
						const write = await file.write(chunk.value.subarray(writtenBytes));
						if (write.bytesWritten === 0) {
							throw new Error('Agent SDK archive write made no progress.');
						}
						writtenBytes += write.bytesWritten;
					}
					const now = this.options.now();
					if (lastProgressAt === 0 || now - lastProgressAt >= progressIntervalMilliseconds) {
						lastProgressAt = now;
						onProgress(receivedBytes, totalBytes);
					}
				}
				if (totalBytes !== undefined && receivedBytes !== totalBytes) {
					throw new Error('Agent SDK archive length does not match the response metadata.');
				}
				onProgress(receivedBytes, totalBytes);
				return Object.freeze({ receivedBytes, totalBytes });
			} finally {
				await reader.cancel().catch(() => undefined);
				await file.close();
			}
		} catch (error) {
			if (token.isCancellationRequested || controller.signal.aborted) {
				throw new CancellationError();
			}
			throw error;
		} finally {
			cancellation.dispose();
		}
	}

	private emitProgress(
		pkg: IAgentSdkPackage,
		downloadId: string,
		phase: AgentSdkDownloadPhase,
		receivedBytes: number,
		totalBytes: number | undefined,
		error?: string,
	): void {
		this.progressEmitter.fire(Object.freeze({
			downloadId,
			packageId: pkg.id,
			displayName: pkg.displayName,
			phase,
			receivedBytes,
			totalBytes,
			...(error === undefined ? {} : { error }),
		}));
	}
}
