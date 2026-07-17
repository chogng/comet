/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, suite, test } from 'node:test';

import { c as createTar } from 'tar';

import { CancellationTokenNone, CancellationTokenSource } from 'cs/base/common/cancellation';
import { CancellationError } from 'cs/base/common/errors';
import { DisposableStore } from 'cs/base/common/lifecycle';
import {
	AgentSdkDownloader,
	type IAgentSdkDownloadProgress,
	type IAgentSdkPackage,
	resolveAgentSdkTarget,
} from 'cs/platform/agentHost/node/agentSdkDownloader';

const claudePackage: IAgentSdkPackage = Object.freeze({
	id: 'claude',
	displayName: 'Claude',
	developmentRootEnvironmentVariable: 'COMET_CLAUDE_SDK_ROOT',
	hasSeparateMuslLinuxTarget: true,
});

const codexPackage: IAgentSdkPackage = Object.freeze({
	id: 'codex',
	displayName: 'Codex',
	developmentRootEnvironmentVariable: 'COMET_CODEX_SDK_ROOT',
	hasSeparateMuslLinuxTarget: false,
});

interface ITestArchiveServer {
	readonly urlTemplate: string;
	readonly requests: number;
	close(): Promise<void>;
}

suite('AgentSdkDownloader', { concurrency: false }, () => {
	let disposables: DisposableStore;
	const temporaryDirectories: string[] = [];
	const servers: Server[] = [];

	afterEach(async () => {
		disposables.dispose();
		await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
			server.close(error => error === undefined ? resolve() : reject(error));
		})));
		await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, {
			recursive: true,
			force: true,
		})));
	});

	async function createTemporaryDirectory(): Promise<string> {
		const directory = await mkdtemp(path.join(tmpdir(), 'comet-agent-sdk-test-'));
		temporaryDirectories.push(directory);
		return directory;
	}

	async function createArchive(entries: Readonly<Record<string, string>>): Promise<string> {
		const root = await createTemporaryDirectory();
		for (const [relativePath, value] of Object.entries(entries)) {
			const target = path.join(root, relativePath);
			await mkdir(path.dirname(target), { recursive: true });
			await writeFile(target, value);
		}
		const archive = path.join(await createTemporaryDirectory(), 'sdk.tgz');
		await createTar({ cwd: root, file: archive, gzip: true }, Object.keys(entries));
		return archive;
	}

	async function serveArchive(archive: string): Promise<ITestArchiveServer> {
		const bytes = await readFile(archive);
		let requests = 0;
		const server = createServer((_request, response) => {
			requests += 1;
			response.writeHead(200, {
				'content-length': String(bytes.byteLength),
				'content-type': 'application/gzip',
			});
			response.end(bytes);
		});
		servers.push(server);
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const address = server.address();
		if (address === null || typeof address === 'string') {
			throw new Error('Test SDK archive server has no TCP address.');
		}
		return {
			urlTemplate: `http://127.0.0.1:${address.port}/claude-{sdkTarget}.tgz`,
			get requests() {
				return requests;
			},
			close: async () => {
				const index = servers.indexOf(server);
				if (index !== -1) {
					servers.splice(index, 1);
				}
				await new Promise<void>((resolve, reject) => {
					server.close(error => error === undefined ? resolve() : reject(error));
				});
			},
		};
	}

	async function createDownloader(
		urlTemplate: string,
		options: {
			readonly now?: () => number;
			readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
			readonly environment?: Readonly<Record<string, string | undefined>>;
		} = {},
	): Promise<AgentSdkDownloader> {
		return disposables.add(new AgentSdkDownloader({
			cacheRoot: await createTemporaryDirectory(),
			products: Object.freeze({
				claude: Object.freeze({ version: '0.3.208', urlTemplate }),
			}),
			fetch: options.fetch ?? ((url, init) => fetch(url, init)),
			now: options.now ?? Date.now,
			host: Object.freeze({ platform: 'darwin', architecture: 'arm64', libc: undefined }),
			environment: options.environment ?? Object.freeze({}),
		}));
	}

	beforeEach(() => {
		disposables = new DisposableStore();
	});

	test('resolves exact platform, architecture, and libc targets', () => {
		assert.equal(resolveAgentSdkTarget(claudePackage, {
			platform: 'linux',
			architecture: 'x64',
			libc: 'musl',
		}), 'linux-x64-musl');
		assert.equal(resolveAgentSdkTarget(codexPackage, {
			platform: 'linux',
			architecture: 'x64',
			libc: 'musl',
		}), 'linux-x64');
		assert.equal(resolveAgentSdkTarget(claudePackage, {
			platform: 'darwin',
			architecture: 'arm64',
			libc: undefined,
		}), 'darwin-arm64');
		assert.equal(resolveAgentSdkTarget(claudePackage, {
			platform: 'freebsd',
			architecture: 'x64',
			libc: undefined,
		}), undefined);
	});

	test('registers product availability without downloading', async () => {
		let requests = 0;
		const downloader = await createDownloader('https://example.invalid/claude-{sdkTarget}.tgz', {
			fetch: async () => {
				requests += 1;
				throw new Error('unexpected download');
			},
		});

		assert.equal(downloader.isAvailable(claudePackage), true);
		assert.equal(await downloader.isSdkResolvableWithoutDownload(claudePackage), false);
		assert.equal(requests, 0);
	});

	test('deduplicates a cold download and reuses the completed cache', async () => {
		const archive = await createArchive({
			'artifact.json': '{"version":"0.3.208"}',
			'sdk.js': 'export const sdk = true;',
			'bin/claude': 'executable',
		});
		const server = await serveArchive(archive);
		const downloader = await createDownloader(server.urlTemplate);
		const progress: IAgentSdkDownloadProgress[] = [];
		disposables.add(downloader.onDidDownloadProgress(event => progress.push(event)));

		const [first, second] = await Promise.all([
			downloader.loadSdkRoot(claudePackage, CancellationTokenNone),
			downloader.loadSdkRoot(claudePackage, CancellationTokenNone),
		]);

		assert.equal(first, second);
		assert.equal(server.requests, 1);
		assert.equal(await readFile(path.join(first, 'sdk.js'), 'utf8'), 'export const sdk = true;');
		assert.equal(await downloader.isSdkResolvableWithoutDownload(claudePackage), true);
		assert.equal(await downloader.loadSdkRoot(claudePackage, CancellationTokenNone), first);
		assert.equal(server.requests, 1);
		assert.equal(progress.filter(event => event.phase === 'started').length, 1);
		assert.equal(progress.filter(event => event.phase === 'completed').length, 1);
		assert.equal(progress.filter(event => event.phase === 'failed').length, 0);
		await server.close();
	});

	test('uses one explicit development root without consulting product bytes', async () => {
		const developmentRoot = await createTemporaryDirectory();
		const downloader = await createDownloader('https://example.invalid/claude-{sdkTarget}.tgz', {
			environment: Object.freeze({ COMET_CLAUDE_SDK_ROOT: developmentRoot }),
			fetch: async () => {
				throw new Error('unexpected download');
			},
		});

		assert.equal(downloader.isAvailable(claudePackage), true);
		assert.equal(await downloader.isSdkResolvableWithoutDownload(claudePackage), true);
		assert.equal(
			await downloader.loadSdkRoot(claudePackage, CancellationTokenNone),
			await realpath(developmentRoot),
		);
	});

	test('cancels an active download and leaves no completed cache', async () => {
		const source = disposables.add(new CancellationTokenSource());
		const downloader = await createDownloader('https://example.invalid/claude-{sdkTarget}.tgz', {
			fetch: async (_url, init) => new Response(new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array([1, 2, 3]));
					init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
				},
			}), {
				headers: { 'content-length': '32' },
				status: 200,
			}),
		});
		const progress: IAgentSdkDownloadProgress[] = [];
		disposables.add(downloader.onDidDownloadProgress(event => {
			progress.push(event);
			if (event.phase === 'progress') {
				source.cancel();
			}
		}));

		await assert.rejects(
			downloader.loadSdkRoot(claudePackage, source.token),
			CancellationError,
		);
		assert.equal(await downloader.isSdkResolvableWithoutDownload(claudePackage), false);
		assert.equal(progress.at(-1)?.phase, 'failed');
		assert.equal(progress.at(-1)?.error, 'cancelled');
	});

	test('latches a download failure without selecting another source', async () => {
		let now = 1_000;
		let requests = 0;
		const downloader = await createDownloader('https://example.invalid/claude-{sdkTarget}.tgz', {
			now: () => now,
			fetch: async () => {
				requests += 1;
				return new Response(null, { status: 503 });
			},
		});

		await assert.rejects(
			downloader.loadSdkRoot(claudePackage, CancellationTokenNone),
			/HTTP 503/,
		);
		await assert.rejects(
			downloader.loadSdkRoot(claudePackage, CancellationTokenNone),
			/HTTP 503/,
		);
		assert.equal(requests, 1);
		now += 30_001;
		await assert.rejects(
			downloader.loadSdkRoot(claudePackage, CancellationTokenNone),
			/HTTP 503/,
		);
		assert.equal(requests, 2);
	});

	test('rejects links in an SDK archive before cache publication', async () => {
		const root = await createTemporaryDirectory();
		await writeFile(path.join(root, 'sdk.js'), 'export {};');
		await symlink('sdk.js', path.join(root, 'sdk-link.js'));
		const archive = path.join(await createTemporaryDirectory(), 'sdk.tgz');
		await createTar({ cwd: root, file: archive, gzip: true }, ['sdk.js', 'sdk-link.js']);
		const server = await serveArchive(archive);
		const downloader = await createDownloader(server.urlTemplate);

		await assert.rejects(
			downloader.loadSdkRoot(claudePackage, CancellationTokenNone),
			/invalid entry/,
		);
		assert.equal(await downloader.isSdkResolvableWithoutDownload(claudePackage), false);
		await server.close();
	});
});
