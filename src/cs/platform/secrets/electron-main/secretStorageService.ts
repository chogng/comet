/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Buffer } from 'node:buffer';

import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import type { ISecretStorageService } from 'cs/platform/secrets/common/secret';
import { secretStorageKey, secretStoragePrefix } from 'cs/platform/secrets/common/secret';
import {
	StorageScope,
	StorageTarget,
	type IStorageService,
} from 'cs/platform/storage/common/storage';

const encryptedSecretEnvelopePrefix = 'comet-secret-storage:';
const encryptedSecretEnvelopeVersion = 1;
const canonicalBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const secureLinuxStorageBackends = new Set([
	'gnome_libsecret',
	'kwallet',
	'kwallet5',
	'kwallet6',
]);

type SecretStorageBackingService = Pick<
	IStorageService,
	'applicationStorage' | 'get' | 'store' | 'remove' | 'flush'
>;

interface EncryptedSecretEnvelope {
	readonly version: number;
	readonly ciphertext: string;
}

interface PendingSecretMigration {
	readonly storageKey: string;
	readonly encryptedValue: string;
}

/** The Electron safeStorage operations required by persistent secret storage. */
export interface ElectronSafeStorage {
	isEncryptionAvailable(): boolean;
	encryptString(plainText: string): Buffer;
	decryptString(encryptedValue: Buffer): string;
	getSelectedStorageBackend?(): string;
}

export const SecretStorageErrorCode = {
	NotInitialized: 'notInitialized',
	EncryptionUnavailable: 'encryptionUnavailable',
	EncryptionFailed: 'encryptionFailed',
	DecryptionFailed: 'decryptionFailed',
	InvalidEnvelope: 'invalidEnvelope',
	UnsupportedEnvelopeVersion: 'unsupportedEnvelopeVersion',
	PersistenceFailed: 'persistenceFailed',
} as const;

export type SecretStorageErrorCode =
	(typeof SecretStorageErrorCode)[keyof typeof SecretStorageErrorCode];

/** A redacted, stable failure from the Electron secret-storage boundary. */
export class SecretStorageError extends Error {
	constructor(readonly code: SecretStorageErrorCode) {
		super(`Secret storage failed (${code}).`);
		this.name = 'SecretStorageError';
	}
}

/** Persistent Electron secret storage backed exclusively by safeStorage ciphertext. */
export class ElectronSecretStorageService extends Disposable implements ISecretStorageService {
	private readonly onDidChangeSecretEmitter = this._register(new EventEmitter<string>());
	readonly onDidChangeSecret: Event<string> = this.onDidChangeSecretEmitter.event;

	private initialization: Promise<void> | undefined;
	private initialized = false;

	constructor(
		private readonly storageService: SecretStorageBackingService,
		private readonly safeStorage: ElectronSafeStorage,
		private readonly platform: NodeJS.Platform,
	) {
		super();
	}

	init(): Promise<void> {
		this.initialization ??= this.initialize();
		return this.initialization;
	}

	async get(key: string): Promise<string | undefined> {
		this.ensureInitialized();

		let encryptedValue: string | undefined;
		try {
			encryptedValue = this.storageService.get(
				secretStorageKey(key),
				StorageScope.APPLICATION,
			);
		} catch {
			throw new SecretStorageError(SecretStorageErrorCode.PersistenceFailed);
		}

		return encryptedValue === undefined
			? undefined
			: this.decryptValue(encryptedValue);
	}

	async set(key: string, value: string): Promise<void> {
		this.ensureInitialized();
		const encryptedValue = this.encryptValue(value);

		try {
			this.storageService.store(
				secretStorageKey(key),
				encryptedValue,
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);
			await this.storageService.flush();
		} catch {
			throw new SecretStorageError(SecretStorageErrorCode.PersistenceFailed);
		}

		this.onDidChangeSecretEmitter.fire(key);
	}

	async delete(key: string): Promise<void> {
		this.ensureInitialized();

		try {
			this.storageService.remove(secretStorageKey(key), StorageScope.APPLICATION);
			await this.storageService.flush();
		} catch {
			throw new SecretStorageError(SecretStorageErrorCode.PersistenceFailed);
		}

		this.onDidChangeSecretEmitter.fire(key);
	}

	async keys(): Promise<string[]> {
		this.ensureInitialized();
		return [...this.storageService.applicationStorage.items.keys()]
			.filter(key => key.startsWith(secretStoragePrefix))
			.map(key => key.slice(secretStoragePrefix.length));
	}

	private async initialize(): Promise<void> {
		this.ensureEncryptionAvailable();

		const migrations: PendingSecretMigration[] = [];
		for (const [storageKey, storedValue] of this.storageService.applicationStorage.items) {
			if (!storageKey.startsWith(secretStoragePrefix)) {
				continue;
			}

			if (storedValue.startsWith(encryptedSecretEnvelopePrefix)) {
				this.decryptValue(storedValue);
				continue;
			}

			migrations.push({
				storageKey,
				encryptedValue: this.encryptValue(storedValue),
			});
		}

		if (migrations.length > 0) {
			try {
				for (const migration of migrations) {
					this.storageService.store(
						migration.storageKey,
						migration.encryptedValue,
						StorageScope.APPLICATION,
						StorageTarget.MACHINE,
					);
				}
				await this.storageService.flush();
			} catch {
				throw new SecretStorageError(SecretStorageErrorCode.PersistenceFailed);
			}
		}

		this.initialized = true;
	}

	private ensureInitialized(): void {
		if (!this.initialized) {
			throw new SecretStorageError(SecretStorageErrorCode.NotInitialized);
		}
	}

	private ensureEncryptionAvailable(): void {
		if (this.platform !== 'darwin' && this.platform !== 'linux' && this.platform !== 'win32') {
			throw new SecretStorageError(SecretStorageErrorCode.EncryptionUnavailable);
		}
		let available = false;
		try {
			available = this.safeStorage.isEncryptionAvailable();
		} catch {
			throw new SecretStorageError(SecretStorageErrorCode.EncryptionUnavailable);
		}

		if (!available) {
			throw new SecretStorageError(SecretStorageErrorCode.EncryptionUnavailable);
		}
		if (this.platform === 'linux') {
			const resolveBackend = this.safeStorage.getSelectedStorageBackend;
			if (resolveBackend === undefined) {
				throw new SecretStorageError(SecretStorageErrorCode.EncryptionUnavailable);
			}
			let backend: string;
			try {
				backend = resolveBackend.call(this.safeStorage);
			} catch {
				throw new SecretStorageError(SecretStorageErrorCode.EncryptionUnavailable);
			}
			if (!secureLinuxStorageBackends.has(backend)) {
				throw new SecretStorageError(SecretStorageErrorCode.EncryptionUnavailable);
			}
		}
	}

	private encryptValue(value: string): string {
		let encryptedValue: Buffer;
		try {
			encryptedValue = this.safeStorage.encryptString(value);
		} catch {
			throw new SecretStorageError(SecretStorageErrorCode.EncryptionFailed);
		}

		if (!Buffer.isBuffer(encryptedValue) || encryptedValue.byteLength === 0) {
			throw new SecretStorageError(SecretStorageErrorCode.EncryptionFailed);
		}

		return encryptedSecretEnvelopePrefix + JSON.stringify({
			version: encryptedSecretEnvelopeVersion,
			ciphertext: encryptedValue.toString('base64'),
		} satisfies EncryptedSecretEnvelope);
	}

	private decryptValue(value: string): string {
		const encryptedValue = this.parseEncryptedValue(value);
		try {
			return this.safeStorage.decryptString(encryptedValue);
		} catch {
			throw new SecretStorageError(SecretStorageErrorCode.DecryptionFailed);
		}
	}

	private parseEncryptedValue(value: string): Buffer {
		if (!value.startsWith(encryptedSecretEnvelopePrefix)) {
			throw new SecretStorageError(SecretStorageErrorCode.InvalidEnvelope);
		}

		let parsedValue: unknown;
		try {
			parsedValue = JSON.parse(value.slice(encryptedSecretEnvelopePrefix.length));
		} catch {
			throw new SecretStorageError(SecretStorageErrorCode.InvalidEnvelope);
		}

		if (!this.isEnvelope(parsedValue)) {
			throw new SecretStorageError(SecretStorageErrorCode.InvalidEnvelope);
		}
		if (parsedValue.version !== encryptedSecretEnvelopeVersion) {
			throw new SecretStorageError(SecretStorageErrorCode.UnsupportedEnvelopeVersion);
		}
		if (
			parsedValue.ciphertext.length === 0 ||
			!canonicalBase64Pattern.test(parsedValue.ciphertext)
		) {
			throw new SecretStorageError(SecretStorageErrorCode.InvalidEnvelope);
		}

		const encryptedValue = Buffer.from(parsedValue.ciphertext, 'base64');
		if (encryptedValue.toString('base64') !== parsedValue.ciphertext) {
			throw new SecretStorageError(SecretStorageErrorCode.InvalidEnvelope);
		}
		return encryptedValue;
	}

	private isEnvelope(value: unknown): value is EncryptedSecretEnvelope {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return false;
		}

		const envelope = value as Partial<EncryptedSecretEnvelope>;
		return Object.keys(value).length === 2 &&
			typeof envelope.version === 'number' &&
			Number.isInteger(envelope.version) &&
			typeof envelope.ciphertext === 'string';
	}
}
