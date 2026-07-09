/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import {
	StorageScope,
	StorageTarget,
	type IStorageService,
} from 'cs/platform/storage/common/storage';

export const secretStoragePrefix = 'secret://';

export type ProviderApiKeyScope = 'llm' | 'translation' | 'rag';

export interface ProviderApiKeyRef {
	readonly scope: ProviderApiKeyScope;
	readonly providerId: string;
}

export interface ISecretStorageService {
	readonly onDidChangeSecret: Event<string>;
	get(key: string): Promise<string | undefined>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
	keys(): Promise<string[]>;
}

export const ISecretStorageService =
	createDecorator<ISecretStorageService>('secretStorageService');

export interface IProviderApiKeySecretStorage {
	getApiKey(ref: ProviderApiKeyRef): Promise<string>;
	setApiKey(ref: ProviderApiKeyRef, apiKey: string): Promise<void>;
	deleteApiKey(ref: ProviderApiKeyRef): Promise<void>;
}

type SecretStorageBackingService = Pick<
	IStorageService,
	'get' | 'store' | 'remove' | 'keys' | 'flush'
>;

export function secretStorageKey(key: string): string {
	return `${secretStoragePrefix}${key}`;
}

export function providerApiKeySecretKey(ref: ProviderApiKeyRef): string {
	return `providerApiKey.${ref.scope}.${ref.providerId}`;
}

export class BaseSecretStorageService extends Disposable implements ISecretStorageService {
	protected readonly onDidChangeSecretEmitter = this._register(new EventEmitter<string>());
	readonly onDidChangeSecret = this.onDidChangeSecretEmitter.event;

	constructor(private readonly storageService: SecretStorageBackingService) {
		super();
	}

	async get(key: string): Promise<string | undefined> {
		return this.storageService.get(secretStorageKey(key), StorageScope.APPLICATION);
	}

	async set(key: string, value: string): Promise<void> {
		this.storageService.store(
			secretStorageKey(key),
			value,
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
		await this.storageService.flush();
		this.onDidChangeSecretEmitter.fire(key);
	}

	async delete(key: string): Promise<void> {
		this.storageService.remove(secretStorageKey(key), StorageScope.APPLICATION);
		await this.storageService.flush();
		this.onDidChangeSecretEmitter.fire(key);
	}

	async keys(): Promise<string[]> {
		return this.storageService
			.keys(StorageScope.APPLICATION, StorageTarget.MACHINE)
			.filter(key => key.startsWith(secretStoragePrefix))
			.map(key => key.slice(secretStoragePrefix.length));
	}
}

export class ProviderApiKeySecretStorage implements IProviderApiKeySecretStorage {
	constructor(private readonly secretStorageService: ISecretStorageService) {}

	async getApiKey(ref: ProviderApiKeyRef): Promise<string> {
		return (await this.secretStorageService.get(providerApiKeySecretKey(ref))) ?? '';
	}

	async setApiKey(ref: ProviderApiKeyRef, apiKey: string): Promise<void> {
		const normalizedApiKey = apiKey.trim();
		if (!normalizedApiKey) {
			await this.deleteApiKey(ref);
			return;
		}

		await this.secretStorageService.set(providerApiKeySecretKey(ref), normalizedApiKey);
	}

	async deleteApiKey(ref: ProviderApiKeyRef): Promise<void> {
		await this.secretStorageService.delete(providerApiKeySecretKey(ref));
	}
}
