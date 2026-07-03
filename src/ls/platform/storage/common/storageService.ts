import { EventEmitter, type Event } from 'ls/base/common/event';
import { Disposable, DisposableStore } from 'ls/base/common/lifecycle';
import type {
  IStorage,
  StorageValue,
} from 'ls/base/parts/storage/common/storage';
import {
  StorageScope,
  StorageTarget,
  WillSaveStateReason,
  type IStorageValueChangeEvent,
  type IWillSaveStateEvent,
} from 'ls/platform/storage/common/storage';

export abstract class AbstractStorageService extends Disposable {
  private readonly didChangeValueEmitter = this._register(new EventEmitter<IStorageValueChangeEvent>());
  readonly onDidChangeValue: Event<IStorageValueChangeEvent> =
    this.didChangeValueEmitter.event;

  private readonly willSaveStateEmitter = this._register(new EventEmitter<IWillSaveStateEvent>());
  readonly onWillSaveState = this.willSaveStateEmitter.event;

  protected abstract getStorage(scope: StorageScope): IStorage | undefined;

  protected emitDidChangeValue(
    scope: StorageScope,
    event: { key: string; external?: boolean },
  ) {
    this.didChangeValueEmitter.fire({
      key: event.key,
      scope,
      external: event.external,
    });
  }

  protected emitWillSaveState(reason: WillSaveStateReason) {
    this.willSaveStateEmitter.fire({ reason });
  }

  get(key: string, scope: StorageScope, fallbackValue: string): string;
  get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined;
  get(
    key: string,
    scope: StorageScope,
    fallbackValue?: string,
  ): string | undefined {
    return this.getStorage(scope)?.get(key, fallbackValue);
  }

  getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean;
  getBoolean(
    key: string,
    scope: StorageScope,
    fallbackValue?: boolean,
  ): boolean | undefined;
  getBoolean(
    key: string,
    scope: StorageScope,
    fallbackValue?: boolean,
  ): boolean | undefined {
    return this.getStorage(scope)?.getBoolean(key, fallbackValue);
  }

  getNumber(key: string, scope: StorageScope, fallbackValue: number): number;
  getNumber(
    key: string,
    scope: StorageScope,
    fallbackValue?: number,
  ): number | undefined;
  getNumber(
    key: string,
    scope: StorageScope,
    fallbackValue?: number,
  ): number | undefined {
    return this.getStorage(scope)?.getNumber(key, fallbackValue);
  }

  getObject<T extends object>(key: string, scope: StorageScope, fallbackValue: T): T;
  getObject<T extends object>(
    key: string,
    scope: StorageScope,
    fallbackValue?: T,
  ): T | undefined;
  getObject<T extends object>(
    key: string,
    scope: StorageScope,
    fallbackValue?: T,
  ): T | undefined {
    return this.getStorage(scope)?.getObject(key, fallbackValue);
  }

  store(
    key: string,
    value: StorageValue,
    scope: StorageScope,
    _target: StorageTarget = StorageTarget.MACHINE,
  ): void {
    void this.getStorage(scope)?.set(key, value);
  }

  storeAll(
    entries: Array<{
      readonly key: string;
      readonly value: StorageValue;
      readonly scope: StorageScope;
      readonly target: StorageTarget;
    }>,
    external = false,
  ): void {
    for (const entry of entries) {
      void this.getStorage(entry.scope)?.set(entry.key, entry.value, external);
    }
  }

  remove(key: string, scope: StorageScope): void {
    void this.getStorage(scope)?.delete(key);
  }

  keys(scope: StorageScope): string[] {
    return [...(this.getStorage(scope)?.items.keys() ?? [])];
  }

  log(): void {
    for (const scope of [
      StorageScope.APPLICATION_SHARED,
      StorageScope.APPLICATION,
      StorageScope.PROFILE,
      StorageScope.WORKSPACE,
    ]) {
      const storage = this.getStorage(scope);
      if (storage) {
        console.table([...storage.items.entries()]);
      }
    }
  }

  async optimize(scope: StorageScope): Promise<void> {
    await this.getStorage(scope)?.optimize();
  }

  async flush(reason = WillSaveStateReason.NONE): Promise<void> {
    this.emitWillSaveState(reason);
    await Promise.all([
      this.getStorage(StorageScope.APPLICATION_SHARED)?.flush() ?? Promise.resolve(),
      this.getStorage(StorageScope.APPLICATION)?.flush() ?? Promise.resolve(),
      this.getStorage(StorageScope.PROFILE)?.flush() ?? Promise.resolve(),
      this.getStorage(StorageScope.WORKSPACE)?.flush() ?? Promise.resolve(),
    ]);
  }

}

export class ApplicationStorageService extends AbstractStorageService {
  private readonly storageDisposables = this._register(new DisposableStore());

  constructor(private readonly applicationStorageValue: IStorage) {
    super();
    this.storageDisposables.add(
      applicationStorageValue.onDidChangeStorage((event) => {
        this.emitDidChangeValue(StorageScope.APPLICATION, event);
      }),
    );
  }

  get applicationStorage(): IStorage {
    return this.applicationStorageValue;
  }

  async init(): Promise<void> {
    await this.applicationStorageValue.init();
  }

  async close(): Promise<void> {
    this.emitWillSaveState(WillSaveStateReason.SHUTDOWN);
    await this.applicationStorageValue.close();
  }

  protected getStorage(scope: StorageScope): IStorage | undefined {
    return scope === StorageScope.APPLICATION
      ? this.applicationStorageValue
      : undefined;
  }
}
