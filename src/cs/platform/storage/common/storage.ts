import type {
  Article,
  DeleteLibraryDocumentPayload,
  IndexDownloadedPdfPayload,
  UpsertLibraryDocumentMetadataPayload,
  LibraryDocumentStatusPayload,
  LibraryDocumentSummary,
  LibraryDocumentsResult,
  LibraryRegistrationResult,
  ListLibraryDocumentsPayload,
  ReindexLibraryDocumentPayload,
  ReindexLibraryDocumentResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { IStorage } from 'cs/base/parts/storage/common/storage';
import type { StorageValue } from 'cs/base/parts/storage/common/storage';
import type { Event } from 'cs/base/common/event';
import type { AppSettingsConfigurationService } from 'cs/platform/configuration/common/configuration';

export const IS_NEW_KEY = '__$__isNewStorageMarker';
export const TARGET_KEY = '__$__targetStorageMarker';

export enum WillSaveStateReason {
  NONE,
  SHUTDOWN,
}

export interface IWillSaveStateEvent {
  readonly reason: WillSaveStateReason;
}

export interface IStorageValueChangeEvent {
  readonly key: string;
  readonly scope: StorageScope;
  readonly target?: StorageTarget;
  readonly external?: boolean;
}

export enum StorageScope {
  APPLICATION_SHARED = -2,
  APPLICATION = -1,
  PROFILE = 0,
  WORKSPACE = 1,
}

export enum StorageTarget {
  USER,
  MACHINE,
}

export interface TranslationCacheRecord {
  key: string;
  value: string;
}

export interface StorageService extends AppSettingsConfigurationService {
  readonly applicationStorage: IStorage;
  readonly onDidChangeValue: Event<IStorageValueChangeEvent>;
  readonly onWillSaveState: Event<IWillSaveStateEvent>;
  init(): Promise<void>;
  close(): Promise<void>;
  get(key: string, scope: StorageScope, fallbackValue: string): string;
  get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined;
  getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean;
  getBoolean(
    key: string,
    scope: StorageScope,
    fallbackValue?: boolean,
  ): boolean | undefined;
  getNumber(key: string, scope: StorageScope, fallbackValue: number): number;
  getNumber(
    key: string,
    scope: StorageScope,
    fallbackValue?: number,
  ): number | undefined;
  getObject<T extends object>(key: string, scope: StorageScope, fallbackValue: T): T;
  getObject<T extends object>(
    key: string,
    scope: StorageScope,
    fallbackValue?: T,
  ): T | undefined;
  store(
    key: string,
    value: StorageValue,
    scope: StorageScope,
    target: StorageTarget,
  ): void;
  storeAll(
    entries: Array<{
      readonly key: string;
      readonly value: StorageValue;
      readonly scope: StorageScope;
      readonly target: StorageTarget;
    }>,
    external: boolean,
  ): void;
  remove(key: string, scope: StorageScope): void;
  keys(scope: StorageScope): string[];
  log(): void;
  optimize(scope: StorageScope): Promise<void>;
  flush(reason?: WillSaveStateReason): Promise<void>;
  saveFetchedArticles(items: Article[]): Promise<void>;
  loadTranslationCache(keys: string[]): Promise<Record<string, string>>;
  saveTranslationCache(entries: TranslationCacheRecord[]): Promise<void>;
  upsertLibraryDocumentMetadata(
    payload: UpsertLibraryDocumentMetadataPayload,
  ): Promise<LibraryDocumentSummary>;
  deleteLibraryDocument(payload: DeleteLibraryDocumentPayload): Promise<boolean>;
  registerLibraryDocument(payload: IndexDownloadedPdfPayload): Promise<LibraryRegistrationResult>;
  getLibraryDocumentStatus(
    payload: LibraryDocumentStatusPayload,
  ): Promise<LibraryDocumentSummary | null>;
  listLibraryDocuments(payload?: ListLibraryDocumentsPayload): Promise<LibraryDocumentsResult>;
  reindexLibraryDocument(
    payload: ReindexLibraryDocumentPayload,
  ): Promise<ReindexLibraryDocumentResult>;
}
