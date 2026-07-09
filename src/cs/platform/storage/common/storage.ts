import type { IStorage } from 'cs/base/parts/storage/common/storage';
import type { StorageValue } from 'cs/base/parts/storage/common/storage';
import type { Event } from 'cs/base/common/event';
import type { DisposableStore } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

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

export type StorageChangeEvent = Event<IStorageValueChangeEvent> & ((
  scope: StorageScope,
  key: string | undefined,
  disposable: DisposableStore,
) => Event<IStorageValueChangeEvent>);

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

export interface IStorageEntry {
  readonly key: string;
  readonly value: StorageValue;
  readonly scope: StorageScope;
  readonly target: StorageTarget;
}

export interface IStorageTargetChangeEvent {
  readonly scope: StorageScope;
}

export interface IStorageService {
  readonly _serviceBrand: undefined;
  readonly applicationStorage: IStorage;
  readonly onDidChangeValue: StorageChangeEvent;
  readonly onDidChangeTarget: Event<IStorageTargetChangeEvent>;
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
    entries: Array<IStorageEntry>,
    external: boolean,
  ): void;
  remove(key: string, scope: StorageScope): void;
  keys(scope: StorageScope, target: StorageTarget): string[];
  log(): void;
  optimize(scope: StorageScope): Promise<void>;
  flush(reason?: WillSaveStateReason): Promise<void>;
}

export const IStorageService = createDecorator<IStorageService>('storageService');
