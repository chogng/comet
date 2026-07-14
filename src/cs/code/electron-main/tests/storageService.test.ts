/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createStorageService } from 'cs/code/electron-main/storageService';
import {
	providerApiKeySecretKey,
	secretStorageKey,
} from 'cs/platform/secrets/common/secret';
import {
	SecretStorageError,
	SecretStorageErrorCode,
	type ElectronSafeStorage,
} from 'cs/platform/secrets/electron-main/secretStorageService';
import { StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import { createStorageMainService } from 'cs/platform/storage/electron-main/storageMainService';
import { createDefaultTranslationSettings } from 'cs/workbench/services/translation/config';

interface TestSafeStorageOptions {
	readonly available?: boolean;
	readonly backendApiAvailable?: boolean;
	readonly backend?: string;
	readonly backendFailureMessage?: string;
	readonly failEncryptionAt?: number;
	readonly encryptionFailureMessage?: string;
	readonly decryptionFailureMessage?: string;
}

class TestSafeStorage implements ElectronSafeStorage {
	private static readonly marker = 0xa7;

	encryptionCount = 0;
	readonly getSelectedStorageBackend: (() => string) | undefined;

	constructor(private readonly options: TestSafeStorageOptions = {}) {
		if (options.backendApiAvailable !== false) {
			this.getSelectedStorageBackend = () => {
				if (this.options.backendFailureMessage !== undefined) {
					throw new Error(this.options.backendFailureMessage);
				}
				return this.options.backend ?? 'gnome_libsecret';
			};
		}
	}

	isEncryptionAvailable(): boolean {
		return this.options.available !== false;
	}

	encryptString(plainText: string): Buffer {
		this.encryptionCount += 1;
		if (this.encryptionCount === this.options.failEncryptionAt) {
			throw new Error(this.options.encryptionFailureMessage ?? 'encryption failed');
		}

		const plainTextBytes = Buffer.from(plainText, 'utf8');
		const encryptedValue = Buffer.alloc(plainTextBytes.byteLength + 1);
		encryptedValue[0] = TestSafeStorage.marker;
		for (let index = 0; index < plainTextBytes.byteLength; index += 1) {
			encryptedValue[index + 1] = plainTextBytes[index] ^ TestSafeStorage.marker;
		}
		return encryptedValue;
	}

	decryptString(encryptedValue: Buffer): string {
		if (this.options.decryptionFailureMessage !== undefined) {
			throw new Error(this.options.decryptionFailureMessage);
		}
		if (encryptedValue[0] !== TestSafeStorage.marker) {
			throw new Error('invalid test ciphertext');
		}

		const plainTextBytes = Buffer.alloc(encryptedValue.byteLength - 1);
		for (let index = 1; index < encryptedValue.byteLength; index += 1) {
			plainTextBytes[index - 1] = encryptedValue[index] ^ TestSafeStorage.marker;
		}
		return plainTextBytes.toString('utf8');
	}
}

async function withStoragePaths<T>(run: (tempDir: string) => Promise<T>): Promise<T> {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cs-storage-service-'));
	try {
		return await run(tempDir);
	} finally {
		await rm(tempDir, { recursive: true, force: true });
	}
}

function createPaths(tempDir: string) {
	return {
		historyFile: path.join(tempDir, 'history.json'),
		stateDbFile: path.join(tempDir, 'state.vscdb'),
		configFile: path.join(tempDir, 'config.json'),
		userSettingsFile: path.join(tempDir, 'settings.json'),
		translationCacheFile: path.join(tempDir, 'translation-cache.json'),
		libraryDbFile: path.join(tempDir, 'library.sqlite'),
		libraryFilesDir: path.join(tempDir, 'library-files'),
		ragCacheDir: path.join(tempDir, 'rag-cache'),
	};
}

function createTestStorage(
	paths: ReturnType<typeof createPaths>,
	safeStorage: ElectronSafeStorage = new TestSafeStorage(),
	platform: NodeJS.Platform = 'darwin',
) {
	return createStorageService(paths, { safeStorage, platform });
}

async function seedStoredSecrets(
	paths: ReturnType<typeof createPaths>,
	entries: ReadonlyArray<readonly [string, string]>,
): Promise<void> {
	const storage = createStorageMainService({ stateDbFile: paths.stateDbFile });
	await storage.init();
	try {
		for (const [key, value] of entries) {
			storage.store(
				secretStorageKey(key),
				value,
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);
		}
		await storage.flush();
	} finally {
		await storage.close();
	}
}

async function readStoredSecret(
	paths: ReturnType<typeof createPaths>,
	key: string,
): Promise<string | undefined> {
	const storage = createStorageMainService({ stateDbFile: paths.stateDbFile });
	await storage.init();
	try {
		return storage.get(secretStorageKey(key), StorageScope.APPLICATION);
	} finally {
		await storage.close();
	}
}

function assertEncryptedEnvelope(value: string | undefined, plainText: string): void {
	assert.ok(value);
	assert.match(
		value,
		/^comet-secret-storage:\{"version":1,"ciphertext":"[A-Za-z0-9+/]+={0,2}"\}$/,
	);
	assert.equal(value.includes(plainText), false);
}

function isSecretStorageError(
	error: unknown,
	code: (typeof SecretStorageErrorCode)[keyof typeof SecretStorageErrorCode],
	redactedValues: readonly string[] = [],
): boolean {
	assert.ok(error instanceof SecretStorageError);
	assert.equal(error.code, code);
	for (const redactedValue of redactedValues) {
		assert.equal(String(error).includes(redactedValue), false);
	}
	return true;
}

test('createStorageService wires application state storage to state.vscdb', async () => {
	await withStoragePaths(async tempDir => {
		const paths = createPaths(tempDir);
		const storage = createTestStorage(paths);
		await storage.init();

		await storage.applicationStorage.set('workspace.lastActive', 'draft');
		storage.store(
			'workspace.lastScopeWrite',
			'application',
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
		await storage.flush();
		await storage.close();

		const restored = createTestStorage(paths);
		await restored.init();

		assert.equal(restored.applicationStorage.get('workspace.lastActive'), 'draft');
		assert.equal(
			restored.get('workspace.lastScopeWrite', StorageScope.APPLICATION),
			'application',
		);

		await restored.close();
	});
});

test('provider api keys persist only as versioned safeStorage ciphertext', async () => {
	await withStoragePaths(async tempDir => {
		const paths = createPaths(tempDir);
		const storage = createTestStorage(paths);
		await storage.init();
		const translation = createDefaultTranslationSettings();
		translation.activeProvider = 'custom';
		translation.providers.custom = {
			apiKey: 'custom-key',
			baseUrl: 'https://custom.example/v1',
			model: 'custom-model',
			models: ['custom-model'],
		};

		await storage.saveSettings({ translation });
		const providerSecretKey = providerApiKeySecretKey({
			scope: 'translation',
			providerId: 'custom',
		});
		assertEncryptedEnvelope(
			storage.get(secretStorageKey(providerSecretKey), StorageScope.APPLICATION),
			'custom-key',
		);
		await storage.close();

		const savedConfig = JSON.parse(await readFile(paths.configFile, 'utf8')) as {
			translation: { providers: { custom: { apiKey?: string } } };
		};
		assert.equal(savedConfig.translation.providers.custom.apiKey, undefined);
		assert.equal(
			(await readFile(paths.stateDbFile)).includes(Buffer.from('custom-key', 'utf8')),
			false,
		);

		const restored = createTestStorage(paths, new TestSafeStorage());
		await restored.init();
		const restoredSettings = await restored.loadSettings();
		assert.equal(restoredSettings.translation.providers.custom.apiKey, 'custom-key');

		await restored.close();
	});
});

test('startup migrates plaintext secret entries in place and restart decrypts them', async () => {
	await withStoragePaths(async tempDir => {
		const paths = createPaths(tempDir);
		const providerSecretKey = providerApiKeySecretKey({
			scope: 'translation',
			providerId: 'custom',
		});
		await seedStoredSecrets(paths, [[providerSecretKey, 'legacy-custom-key']]);

		const storage = createTestStorage(paths, new TestSafeStorage());
		await storage.init();
		assertEncryptedEnvelope(
			storage.get(secretStorageKey(providerSecretKey), StorageScope.APPLICATION),
			'legacy-custom-key',
		);
		assert.equal(
			(await storage.loadSettings()).translation.providers.custom.apiKey,
			'legacy-custom-key',
		);
		await storage.close();

		const restartSafeStorage = new TestSafeStorage();
		const restored = createTestStorage(paths, restartSafeStorage);
		await restored.init();
		assert.equal(restartSafeStorage.encryptionCount, 0);
		assert.equal(
			(await restored.loadSettings()).translation.providers.custom.apiKey,
			'legacy-custom-key',
		);
		await restored.close();
	});
});

test('startup fails closed when safeStorage encryption is unavailable', async () => {
	await withStoragePaths(async tempDir => {
		const paths = createPaths(tempDir);
		const providerSecretKey = providerApiKeySecretKey({
			scope: 'llm',
			providerId: 'openai',
		});
		await seedStoredSecrets(paths, [[providerSecretKey, 'unavailable-secret']]);

		const storage = createTestStorage(paths, new TestSafeStorage({ available: false }));
		try {
			await assert.rejects(
				storage.init(),
				error => isSecretStorageError(
					error,
					SecretStorageErrorCode.EncryptionUnavailable,
					['unavailable-secret'],
				),
			);
		} finally {
			await storage.close();
		}

		assert.equal(await readStoredSecret(paths, providerSecretKey), 'unavailable-secret');
	});
});

test('Linux startup rejects unsafe or unavailable safeStorage backends before secret migration', async () => {
	const cases: readonly {
		readonly label: string;
		readonly options: TestSafeStorageOptions;
		readonly redactedValues?: readonly string[];
	}[] = [
		{ label: 'basic text', options: { backend: 'basic_text' } },
		{ label: 'unknown', options: { backend: 'unknown' } },
		{ label: 'missing API', options: { backendApiAvailable: false } },
		{
			label: 'failing API',
			options: { backendFailureMessage: 'backend-sensitive-diagnostic' },
			redactedValues: ['backend-sensitive-diagnostic'],
		},
	];

	for (const entry of cases) {
		await withStoragePaths(async tempDir => {
			const paths = createPaths(tempDir);
			const providerSecretKey = providerApiKeySecretKey({
				scope: 'llm',
				providerId: 'openai',
			});
			await seedStoredSecrets(paths, [[providerSecretKey, 'linux-legacy-secret']]);
			const safeStorage = new TestSafeStorage(entry.options);
			const storage = createTestStorage(paths, safeStorage, 'linux');
			try {
				await assert.rejects(
					storage.init(),
					error => isSecretStorageError(
						error,
						SecretStorageErrorCode.EncryptionUnavailable,
						['linux-legacy-secret', ...(entry.redactedValues ?? [])],
					),
					entry.label,
				);
			} finally {
				await storage.close();
			}

			assert.equal(safeStorage.encryptionCount, 0, entry.label);
			assert.equal(
				await readStoredSecret(paths, providerSecretKey),
				'linux-legacy-secret',
				entry.label,
			);
		});
	}
});

test('Linux startup accepts an OS-backed safeStorage backend', async () => {
	await withStoragePaths(async tempDir => {
		const paths = createPaths(tempDir);
		const providerSecretKey = providerApiKeySecretKey({
			scope: 'llm',
			providerId: 'openai',
		});
		await seedStoredSecrets(paths, [[providerSecretKey, 'linux-secure-secret']]);
		const safeStorage = new TestSafeStorage({ backend: 'gnome_libsecret' });
		const storage = createTestStorage(paths, safeStorage, 'linux');
		await storage.init();

		assert.equal(safeStorage.encryptionCount, 1);
		assertEncryptedEnvelope(
			storage.get(secretStorageKey(providerSecretKey), StorageScope.APPLICATION),
			'linux-secure-secret',
		);
		await storage.close();
	});
});

test('startup prepares every plaintext migration before storing ciphertext', async () => {
	await withStoragePaths(async tempDir => {
		const paths = createPaths(tempDir);
		const firstKey = providerApiKeySecretKey({ scope: 'llm', providerId: 'openai' });
		const secondKey = providerApiKeySecretKey({ scope: 'rag', providerId: 'moark' });
		await seedStoredSecrets(paths, [
			[firstKey, 'first-legacy-secret'],
			[secondKey, 'second-legacy-secret'],
		]);

		const storage = createTestStorage(paths, new TestSafeStorage({
			failEncryptionAt: 2,
			encryptionFailureMessage: 'second-legacy-secret',
		}));
		try {
			await assert.rejects(
				storage.init(),
				error => isSecretStorageError(
					error,
					SecretStorageErrorCode.EncryptionFailed,
					['first-legacy-secret', 'second-legacy-secret'],
				),
			);
		} finally {
			await storage.close();
		}

		assert.deepEqual(
			await Promise.all([
				readStoredSecret(paths, firstKey),
				readStoredSecret(paths, secondKey),
			]),
			['first-legacy-secret', 'second-legacy-secret'],
		);
	});
});

test('startup surfaces a redacted typed decryption failure', async () => {
	await withStoragePaths(async tempDir => {
		const paths = createPaths(tempDir);
		const storage = createTestStorage(paths);
		await storage.init();
		const translation = createDefaultTranslationSettings();
		translation.providers.custom.apiKey = 'decrypt-secret';
		await storage.saveSettings({ translation });
		await storage.close();

		const restored = createTestStorage(paths, new TestSafeStorage({
			decryptionFailureMessage: 'decrypt-secret',
		}));
		try {
			await assert.rejects(
				restored.init(),
				error => isSecretStorageError(
					error,
					SecretStorageErrorCode.DecryptionFailed,
					['decrypt-secret'],
				),
			);
		} finally {
			await restored.close();
		}
	});
});

test('startup rejects unsupported encrypted secret envelope versions', async () => {
	await withStoragePaths(async tempDir => {
		const paths = createPaths(tempDir);
		const providerSecretKey = providerApiKeySecretKey({
			scope: 'rag',
			providerId: 'moark',
		});
		const unsupportedEnvelope =
			'comet-secret-storage:{"version":2,"ciphertext":"pw=="}';
		await seedStoredSecrets(paths, [[providerSecretKey, unsupportedEnvelope]]);

		const storage = createTestStorage(paths);
		try {
			await assert.rejects(
				storage.init(),
				error => isSecretStorageError(
					error,
					SecretStorageErrorCode.UnsupportedEnvelopeVersion,
				),
			);
		} finally {
			await storage.close();
		}

		assert.equal(await readStoredSecret(paths, providerSecretKey), unsupportedEnvelope);
	});
});

test('startup rejects malformed encrypted secret envelopes', async () => {
	await withStoragePaths(async tempDir => {
		const paths = createPaths(tempDir);
		const providerSecretKey = providerApiKeySecretKey({
			scope: 'translation',
			providerId: 'glm',
		});
		const malformedEnvelope =
			'comet-secret-storage:{"version":1,"ciphertext":"not base64"}';
		await seedStoredSecrets(paths, [[providerSecretKey, malformedEnvelope]]);

		const storage = createTestStorage(paths);
		try {
			await assert.rejects(
				storage.init(),
				error => isSecretStorageError(error, SecretStorageErrorCode.InvalidEnvelope),
			);
		} finally {
			await storage.close();
		}

		assert.equal(await readStoredSecret(paths, providerSecretKey), malformedEnvelope);
	});
});

test('normal reads reject plaintext written after startup', async () => {
	await withStoragePaths(async tempDir => {
		const paths = createPaths(tempDir);
		const providerSecretKey = providerApiKeySecretKey({
			scope: 'translation',
			providerId: 'custom',
		});
		const storage = createTestStorage(paths);
		await storage.init();
		storage.store(
			secretStorageKey(providerSecretKey),
			'post-startup-plaintext',
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
		await storage.flush();

		await assert.rejects(
			storage.loadSettings(),
			error => isSecretStorageError(
				error,
				SecretStorageErrorCode.InvalidEnvelope,
				['post-startup-plaintext'],
			),
		);
		assert.equal(
			storage.get(secretStorageKey(providerSecretKey), StorageScope.APPLICATION),
			'post-startup-plaintext',
		);
		await storage.close();
	});
});
