import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import type {
  IStorage,
  StorageValue,
} from 'cs/base/parts/storage/common/storage';
import {
  StorageScope,
  type StorageChangeEvent,
  StorageTarget,
  TARGET_KEY,
  WillSaveStateReason,
  type IStorageEntry,
  type IStorageTargetChangeEvent,
  type IStorageValueChangeEvent,
  type IWillSaveStateEvent,
} from 'cs/platform/storage/common/storage';

type KeyTargets = Record<string, StorageTarget>;

export abstract class AbstractStorageService extends Disposable {
  private readonly didChangeValueEmitter = this._register(new EventEmitter<IStorageValueChangeEvent>());
  onDidChangeValue: StorageChangeEvent = ((
    listenerOrScope: ((event: IStorageValueChangeEvent) => unknown) | StorageScope,
    thisArgsOrKey?: unknown,
    disposablesOrStore?: DisposableStore,
  ) => {
    if (typeof listenerOrScope === 'function') {
      return this.didChangeValueEmitter.event(
        listenerOrScope,
        thisArgsOrKey,
        disposablesOrStore,
      );
    }

    const scope = listenerOrScope;
    const key = typeof thisArgsOrKey === 'string' ? thisArgsOrKey : undefined;
    const store = disposablesOrStore;
    const event: Event<IStorageValueChangeEvent> = (listener, thisArgs, disposables) =>
      this.didChangeValueEmitter.event(change => {
        if (change.scope === scope && (key === undefined || change.key === key)) {
          listener.call(thisArgs, change);
        }
      }, undefined, disposables ?? store);
    return event;
  }) as StorageChangeEvent;

  private readonly willSaveStateEmitter = this._register(new EventEmitter<IWillSaveStateEvent>());
  readonly onWillSaveState = this.willSaveStateEmitter.event;

  private readonly didChangeTargetEmitter = this._register(new EventEmitter<IStorageTargetChangeEvent>());
  readonly onDidChangeTarget = this.didChangeTargetEmitter.event;

  protected abstract getStorage(scope: StorageScope): IStorage | undefined;

  protected emitDidChangeValue(
    scope: StorageScope,
    event: { key: string; external?: boolean },
  ) {
    if (event.key === TARGET_KEY) {
      this.didChangeTargetEmitter.fire({ scope });
      return;
    }

    this.didChangeValueEmitter.fire({
      key: event.key,
      scope,
      target: this.getKeyTargets(scope)[event.key],
      external: event.external,
    });
  }

  protected emitWillSaveState(reason: WillSaveStateReason): readonly Promise<void>[] {
	const joins: Promise<void>[] = [];
	let acceptingJoins = true;
	this.willSaveStateEmitter.fire({
		reason,
		join: promise => {
			if (!acceptingJoins) {
				throw new Error('Storage save participants must join synchronously.');
			}
			joins.push(promise);
		},
	});
	acceptingJoins = false;
	return joins;
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
    target: StorageTarget = StorageTarget.MACHINE,
  ): void {
    void this.storeValue(key, value, scope, target);
  }

  storeAll(entries: Array<IStorageEntry>, external = false): void {
    for (const entry of entries) {
      this.storeValue(entry.key, entry.value, entry.scope, entry.target, external);
    }
  }

  remove(key: string, scope: StorageScope): void {
    const storage = this.getStorage(scope);
    if (!storage) {
      return;
    }

    this.removeKeyTarget(storage, scope, key);
    void storage.delete(key);
  }

  keys(scope: StorageScope, target: StorageTarget): string[] {
    return Object.entries(this.getKeyTargets(scope))
      .filter(([, value]) => value === target)
      .map(([key]) => key);
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
	await Promise.all(this.emitWillSaveState(reason));
    await Promise.all([
      this.getStorage(StorageScope.APPLICATION_SHARED)?.flush() ?? Promise.resolve(),
      this.getStorage(StorageScope.APPLICATION)?.flush() ?? Promise.resolve(),
      this.getStorage(StorageScope.PROFILE)?.flush() ?? Promise.resolve(),
      this.getStorage(StorageScope.WORKSPACE)?.flush() ?? Promise.resolve(),
    ]);
  }

  private storeValue(
    key: string,
    value: StorageValue,
    scope: StorageScope,
    target: StorageTarget,
    external = false,
  ): void {
    const storage = this.getStorage(scope);
    if (!storage) {
      return;
    }

    if (value === undefined || value === null) {
      this.remove(key, scope);
      return;
    }

    this.setKeyTarget(storage, scope, key, target);
    void storage.set(key, value, external);
  }

  private getKeyTargets(scope: StorageScope): KeyTargets {
    const rawValue = this.getStorage(scope)?.get(TARGET_KEY);
    return rawValue ? JSON.parse(rawValue) as KeyTargets : {};
  }

  private setKeyTarget(
    storage: IStorage,
    scope: StorageScope,
    key: string,
    target: StorageTarget,
  ): void {
    const targets = this.getKeyTargets(scope);
    if (targets[key] === target) {
      return;
    }

    targets[key] = target;
    void storage.set(TARGET_KEY, targets);
  }

  private removeKeyTarget(storage: IStorage, scope: StorageScope, key: string): void {
    const targets = this.getKeyTargets(scope);
    if (targets[key] === undefined) {
      return;
    }

    delete targets[key];
    void storage.set(TARGET_KEY, targets);
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
