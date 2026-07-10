/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import type {
	IStorageDatabase,
	IStorageItemsChangeEvent,
	IUpdateRequest,
} from 'cs/base/parts/storage/common/storage';
import { Storage } from 'cs/base/parts/storage/common/storage';
import type {
	AppSettings,
	DeleteLibraryDocumentPayload,
	IndexDownloadedPdfPayload,
	LibraryDocumentStatusPayload,
	LibraryDocumentSummary,
	LibraryDocumentsResult,
	LibraryRegistrationResult,
	ListLibraryDocumentsPayload,
	ReindexLibraryDocumentPayload,
	ReindexLibraryDocumentResult,
	StoredAppSettings,
	TranslationCacheRecord,
	UpsertLibraryDocumentMetadataPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';
import { INativeHostService } from 'cs/platform/native/common/native';
import { IStorageService, StorageScope } from 'cs/platform/storage/common/storage';
import { AbstractStorageService } from 'cs/platform/storage/common/storageService';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';

const storagePrefix = 'comet.workbench.storage.';

function storageScopeName(scope: StorageScope): string {
	switch (scope) {
		case StorageScope.APPLICATION_SHARED:
			return 'applicationShared';
		case StorageScope.APPLICATION:
			return 'application';
		case StorageScope.PROFILE:
			return 'profile';
		case StorageScope.WORKSPACE:
			return 'workspace';
	}
}

class LocalStorageDatabase extends Disposable implements IStorageDatabase {
	private readonly didChangeItemsExternalEmitter =
		this._register(new EventEmitter<IStorageItemsChangeEvent>());
	readonly onDidChangeItemsExternal = this.didChangeItemsExternalEmitter.event;

	constructor(private readonly prefix: string) {
		super();
		window.addEventListener('storage', this.onDidChangeLocalStorage);
		this._register({
			dispose: () => window.removeEventListener('storage', this.onDidChangeLocalStorage),
		});
	}

	async getItems(): Promise<Map<string, string>> {
		const items = new Map<string, string>();
		for (let index = 0; index < window.localStorage.length; index++) {
			const storageKey = window.localStorage.key(index);
			if (!storageKey?.startsWith(this.prefix)) {
				continue;
			}

			const value = window.localStorage.getItem(storageKey);
			if (value !== null) {
				items.set(storageKey.slice(this.prefix.length), value);
			}
		}

		return items;
	}

	async updateItems(request: IUpdateRequest): Promise<void> {
		request.insert?.forEach((value, key) => {
			window.localStorage.setItem(this.toStorageKey(key), value);
		});
		request.delete?.forEach(key => {
			window.localStorage.removeItem(this.toStorageKey(key));
		});
	}

	async optimize(): Promise<void> {}

	async close(): Promise<void> {}

	private readonly onDidChangeLocalStorage = (event: StorageEvent) => {
		if (!event.key?.startsWith(this.prefix)) {
			return;
		}

		const key = event.key.slice(this.prefix.length);
		if (event.newValue === null) {
			this.didChangeItemsExternalEmitter.fire({ deleted: new Set([key]) });
			return;
		}

		this.didChangeItemsExternalEmitter.fire({
			changed: new Map([[key, event.newValue]]),
		});
	};

	private toStorageKey(key: string): string {
		return `${this.prefix}${key}`;
	}
}

export class WorkbenchStorageService
	extends AbstractStorageService
	implements IStorageService
{
	declare readonly _serviceBrand: undefined;

	readonly applicationSharedStorage =
		this._register(this.createStorage(StorageScope.APPLICATION_SHARED));
	readonly applicationStorage =
		this._register(this.createStorage(StorageScope.APPLICATION));
	readonly profileStorage =
		this._register(this.createStorage(StorageScope.PROFILE));
	readonly workspaceStorage =
		this._register(this.createStorage(StorageScope.WORKSPACE));

	constructor(
		@INativeHostService private readonly nativeHostService: INativeHostService,
	) {
		super();
	}

	async init(): Promise<void> {
		await Promise.all([
			this.applicationSharedStorage.init(),
			this.applicationStorage.init(),
			this.profileStorage.init(),
			this.workspaceStorage.init(),
		]);
	}

	async close(): Promise<void> {
		await Promise.all([
			this.applicationSharedStorage.close(),
			this.applicationStorage.close(),
			this.profileStorage.close(),
			this.workspaceStorage.close(),
		]);
	}

	async loadSettings(): Promise<AppSettings> {
		return this.nativeHostService.invoke('load_settings');
	}

	async saveSettings(settings: Partial<StoredAppSettings> = {}): Promise<AppSettings> {
		return this.nativeHostService.invoke('save_settings', { settings });
	}

	async saveFetchedArticles(items: FetchArticle[]): Promise<void> {
		await this.nativeHostService.invoke('save_fetched_articles', { items });
	}

	async loadTranslationCache(keys: string[]): Promise<Record<string, string>> {
		return this.nativeHostService.invoke('load_translation_cache', { keys });
	}

	async saveTranslationCache(entries: TranslationCacheRecord[]): Promise<void> {
		await this.nativeHostService.invoke('save_translation_cache', { entries });
	}

	async upsertLibraryDocumentMetadata(
		payload: UpsertLibraryDocumentMetadataPayload,
	): Promise<LibraryDocumentSummary> {
		return this.nativeHostService.invoke('upsert_library_document_metadata', payload);
	}

	async deleteLibraryDocument(payload: DeleteLibraryDocumentPayload): Promise<boolean> {
		return this.nativeHostService.invoke('delete_library_document', payload);
	}

	async registerLibraryDocument(
		payload: IndexDownloadedPdfPayload,
	): Promise<LibraryRegistrationResult> {
		return this.nativeHostService.invoke('index_downloaded_pdf', payload);
	}

	async getLibraryDocumentStatus(
		payload: LibraryDocumentStatusPayload,
	): Promise<LibraryDocumentSummary | null> {
		return this.nativeHostService.invoke('get_library_document_status', payload);
	}

	async listLibraryDocuments(
		payload?: ListLibraryDocumentsPayload,
	): Promise<LibraryDocumentsResult> {
		return this.nativeHostService.invoke('list_library_documents', payload);
	}

	async reindexLibraryDocument(
		payload: ReindexLibraryDocumentPayload,
	): Promise<ReindexLibraryDocumentResult> {
		return this.nativeHostService.invoke('reindex_library_document', payload);
	}

	protected getStorage(scope: StorageScope) {
		switch (scope) {
			case StorageScope.APPLICATION_SHARED:
				return this.applicationSharedStorage;
			case StorageScope.APPLICATION:
				return this.applicationStorage;
			case StorageScope.PROFILE:
				return this.profileStorage;
			case StorageScope.WORKSPACE:
				return this.workspaceStorage;
		}
	}

	private createStorage(scope: StorageScope): Storage {
		const database = this._register(
			new LocalStorageDatabase(`${storagePrefix}${storageScopeName(scope)}.`),
		);
		const storage = new Storage(database);
		this._register(
			storage.onDidChangeStorage(event => this.emitDidChangeValue(scope, event)),
		);
		return storage;
	}
}

registerSingleton(
	IStorageService,
	WorkbenchStorageService,
	InstantiationType.Delayed,
);
