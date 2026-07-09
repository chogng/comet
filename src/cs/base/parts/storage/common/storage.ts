import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';

export enum StorageHint {
  STORAGE_DOES_NOT_EXIST,
  STORAGE_IN_MEMORY,
}

export interface IStorageOptions {
  readonly hint?: StorageHint;
}

export interface IUpdateRequest {
  readonly insert?: Map<string, string>;
  readonly delete?: Set<string>;
}

export interface IStorageItemsChangeEvent {
  readonly changed?: Map<string, string>;
  readonly deleted?: Set<string>;
}

export function isStorageItemsChangeEvent(
  value: unknown,
): value is IStorageItemsChangeEvent {
  const candidate = value as IStorageItemsChangeEvent | undefined;
  return candidate?.changed instanceof Map || candidate?.deleted instanceof Set;
}

export interface IStorageDatabase {
  readonly onDidChangeItemsExternal: Event<IStorageItemsChangeEvent>;
  getItems(): Promise<Map<string, string>>;
  updateItems(request: IUpdateRequest): Promise<void>;
  optimize(): Promise<void>;
  close(recovery?: () => Map<string, string>): Promise<void>;
}

export interface IStorageChangeEvent {
  readonly key: string;
  readonly external?: boolean;
}

export type StorageValue = string | boolean | number | undefined | null | object;

export interface IStorage extends IDisposable {
  readonly onDidChangeStorage: Event<IStorageChangeEvent>;
  readonly items: Map<string, string>;
  readonly size: number;
  init(): Promise<void>;
  get(key: string, fallbackValue: string): string;
  get(key: string, fallbackValue?: string): string | undefined;
  getBoolean(key: string, fallbackValue: boolean): boolean;
  getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;
  getNumber(key: string, fallbackValue: number): number;
  getNumber(key: string, fallbackValue?: number): number | undefined;
  getObject<T extends object>(key: string, fallbackValue: T): T;
  getObject<T extends object>(key: string, fallbackValue?: T): T | undefined;
  set(key: string, value: StorageValue, external?: boolean): Promise<void>;
  delete(key: string, external?: boolean): Promise<void>;
  flush(): Promise<void>;
  whenFlushed(): Promise<void>;
  optimize(): Promise<void>;
  close(): Promise<void>;
}

export enum StorageState {
  None,
  Initialized,
  Closed,
}

function serializeStorageValue(value: Exclude<StorageValue, undefined | null>) {
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function eventNone<T>(): Event<T> {
  return () => toDisposable(() => {});
}

export class InMemoryStorageDatabase implements IStorageDatabase {
  readonly onDidChangeItemsExternal = eventNone<IStorageItemsChangeEvent>();
  private readonly items = new Map<string, string>();

  async getItems(): Promise<Map<string, string>> {
    return new Map(this.items);
  }

  async updateItems(request: IUpdateRequest): Promise<void> {
    request.insert?.forEach((value, key) => {
      this.items.set(key, value);
    });
    request.delete?.forEach((key) => {
      this.items.delete(key);
    });
  }

  async optimize(): Promise<void> {}

  async close(): Promise<void> {}
}

export class Storage extends Disposable implements IStorage {
  private readonly changeEmitter = this._register(
    new EventEmitter<IStorageChangeEvent>(),
  );
  readonly onDidChangeStorage = this.changeEmitter.event;

  private state = StorageState.None;
  private cache = new Map<string, string>();
  private pendingDeletes = new Set<string>();
  private pendingInserts = new Map<string, string>();
  private pendingFlush: Promise<void> | undefined;

  constructor(
    private readonly database: IStorageDatabase,
    private readonly options: IStorageOptions = {},
  ) {
    super();
    this._register(
      this.database.onDidChangeItemsExternal((event) => {
        this.acceptExternalChanges(event);
      }),
    );
  }

  get items(): Map<string, string> {
    return this.cache;
  }

  get size(): number {
    return this.cache.size;
  }

  async init(): Promise<void> {
    if (this.state !== StorageState.None) {
      return;
    }

    this.state = StorageState.Initialized;
    if (this.options.hint === StorageHint.STORAGE_DOES_NOT_EXIST) {
      return;
    }

    this.cache = await this.database.getItems();
  }

  get(key: string, fallbackValue: string): string;
  get(key: string, fallbackValue?: string): string | undefined;
  get(key: string, fallbackValue?: string): string | undefined {
    return this.cache.get(key) ?? fallbackValue;
  }

  getBoolean(key: string, fallbackValue: boolean): boolean;
  getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;
  getBoolean(key: string, fallbackValue?: boolean): boolean | undefined {
    const value = this.get(key);
    return value === undefined ? fallbackValue : value === 'true';
  }

  getNumber(key: string, fallbackValue: number): number;
  getNumber(key: string, fallbackValue?: number): number | undefined;
  getNumber(key: string, fallbackValue?: number): number | undefined {
    const value = this.get(key);
    if (value === undefined) {
      return fallbackValue;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallbackValue : parsed;
  }

  getObject<T extends object>(key: string, fallbackValue: T): T;
  getObject<T extends object>(key: string, fallbackValue?: T): T | undefined;
  getObject<T extends object>(key: string, fallbackValue?: T): T | undefined {
    const value = this.get(key);
    if (value === undefined) {
      return fallbackValue;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as T)
        : fallbackValue;
    } catch {
      return fallbackValue;
    }
  }

  async set(key: string, value: StorageValue, external = false): Promise<void> {
    if (value === undefined || value === null) {
      await this.delete(key, external);
      return;
    }

    const serializedValue = serializeStorageValue(value);
    if (this.cache.get(key) === serializedValue) {
      return;
    }

    this.cache.set(key, serializedValue);
    this.pendingDeletes.delete(key);
    this.pendingInserts.set(key, serializedValue);
    this.changeEmitter.fire({ key, external });
    await this.flush();
  }

  async delete(key: string, external = false): Promise<void> {
    if (!this.cache.delete(key)) {
      return;
    }

    this.pendingInserts.delete(key);
    this.pendingDeletes.add(key);
    this.changeEmitter.fire({ key, external });
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.pendingFlush) {
      await this.pendingFlush;
      return this.flush();
    }

    if (this.pendingInserts.size === 0 && this.pendingDeletes.size === 0) {
      return;
    }

    const request: IUpdateRequest = {
      insert: new Map(this.pendingInserts),
      delete: new Set(this.pendingDeletes),
    };
    this.pendingInserts.clear();
    this.pendingDeletes.clear();
    this.pendingFlush = this.database.updateItems(request).finally(() => {
      this.pendingFlush = undefined;
    });
    return this.pendingFlush;
  }

  async whenFlushed(): Promise<void> {
    await this.pendingFlush;
  }

  async optimize(): Promise<void> {
    await this.database.optimize();
  }

  async close(): Promise<void> {
    if (this.state === StorageState.Closed) {
      return;
    }

    this.state = StorageState.Closed;
    await this.flush();
    await this.database.close(() => new Map(this.cache));
  }

  override dispose(): void {
    void this.close();
    super.dispose();
  }

  private acceptExternalChanges(event: IStorageItemsChangeEvent) {
    event.changed?.forEach((value, key) => {
      if (this.cache.get(key) === value) {
        return;
      }

      this.cache.set(key, value);
      this.changeEmitter.fire({ key, external: true });
    });

    event.deleted?.forEach((key) => {
      if (!this.cache.delete(key)) {
        return;
      }

      this.changeEmitter.fire({ key, external: true });
    });
  }
}
