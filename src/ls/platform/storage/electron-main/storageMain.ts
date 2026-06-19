import {
  Storage,
  type IStorage,
  type IStorageChangeEvent,
  type StorageValue,
} from 'ls/base/parts/storage/common/storage';
import { SQLiteStorageDatabase } from 'ls/base/parts/storage/node/storage';
import type { Event } from 'ls/base/common/event';

export interface IStorageMain {
  readonly onDidChangeStorage: Event<IStorageChangeEvent>;
  readonly items: Map<string, string>;
  readonly size: number;
  readonly path: string | undefined;
  readonly storage: IStorage;
  readonly whenInit: Promise<void>;
  init(): Promise<void>;
  get(key: string, fallbackValue: string): string;
  get(key: string, fallbackValue?: string): string | undefined;
  getBoolean(key: string, fallbackValue: boolean): boolean;
  getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;
  getNumber(key: string, fallbackValue: number): number;
  getNumber(key: string, fallbackValue?: number): number | undefined;
  getObject<T extends object>(key: string, fallbackValue: T): T;
  getObject<T extends object>(key: string, fallbackValue?: T): T | undefined;
  set(key: string, value: StorageValue): Promise<void>;
  delete(key: string): Promise<void>;
  flush(): Promise<void>;
  whenFlushed(): Promise<void>;
  isInMemory(): boolean;
  optimize(): Promise<void>;
  close(): Promise<void>;
  dispose(): void;
}

export interface IStorageMainOptions {
  readonly useInMemoryStorage?: boolean;
}

export class ApplicationStorageMain implements IStorageMain {
  readonly path: string | undefined;
  readonly storage: IStorage;
  readonly whenInit: Promise<void>;

  constructor(storageFilePath: string, options: IStorageMainOptions = {}) {
    this.path = options.useInMemoryStorage ? undefined : storageFilePath;
    this.storage = new Storage(
      new SQLiteStorageDatabase(
        this.path ?? SQLiteStorageDatabase.IN_MEMORY_PATH,
        {
          useWAL: !options.useInMemoryStorage,
          busyTimeout: 5000,
        },
      ),
    );
    this.whenInit = this.storage.init();
  }

  get onDidChangeStorage() {
    return this.storage.onDidChangeStorage;
  }

  get items() {
    return this.storage.items;
  }

  get size() {
    return this.storage.size;
  }

  init(): Promise<void> {
    return this.whenInit;
  }

  get(key: string, fallbackValue: string): string;
  get(key: string, fallbackValue?: string): string | undefined;
  get(key: string, fallbackValue?: string): string | undefined {
    return this.storage.get(key, fallbackValue);
  }

  getBoolean(key: string, fallbackValue: boolean): boolean;
  getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;
  getBoolean(key: string, fallbackValue?: boolean): boolean | undefined {
    return this.storage.getBoolean(key, fallbackValue);
  }

  getNumber(key: string, fallbackValue: number): number;
  getNumber(key: string, fallbackValue?: number): number | undefined;
  getNumber(key: string, fallbackValue?: number): number | undefined {
    return this.storage.getNumber(key, fallbackValue);
  }

  getObject<T extends object>(key: string, fallbackValue: T): T;
  getObject<T extends object>(key: string, fallbackValue?: T): T | undefined;
  getObject<T extends object>(key: string, fallbackValue?: T): T | undefined {
    return this.storage.getObject(key, fallbackValue);
  }

  set(key: string, value: StorageValue): Promise<void> {
    return this.storage.set(key, value);
  }

  delete(key: string): Promise<void> {
    return this.storage.delete(key);
  }

  flush(): Promise<void> {
    return this.storage.flush();
  }

  whenFlushed(): Promise<void> {
    return this.storage.whenFlushed();
  }

  isInMemory(): boolean {
    return !this.path;
  }

  optimize(): Promise<void> {
    return this.storage.optimize();
  }

  close(): Promise<void> {
    return this.storage.close();
  }

  dispose(): void {
    this.storage.dispose();
  }
}

export function createApplicationStorageMain(
  storageFilePath: string,
  options?: IStorageMainOptions,
): IStorageMain {
  return new ApplicationStorageMain(storageFilePath, options);
}
