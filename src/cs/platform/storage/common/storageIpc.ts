import type { Event } from 'cs/base/common/event';
import { EventEmitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import type {
  IStorageDatabase,
  IStorageItemsChangeEvent,
  IUpdateRequest,
} from 'cs/base/parts/storage/common/storage';

export type Key = string;
export type Value = string;
export type Item = [Key, Value];

export interface IStorageChannel {
  call<T = unknown>(command: string, arg: IBaseSerializableStorageRequest): Promise<T>;
  listen<T = unknown>(
    event: string,
    arg: IBaseSerializableStorageRequest,
  ): Event<T>;
}

export interface IBaseSerializableStorageRequest {
  readonly profile: unknown | undefined;
  readonly workspace: unknown | undefined;
  readonly applicationShared?: boolean;
  readonly payload?: unknown;
}

export interface ISerializableUpdateRequest
  extends IBaseSerializableStorageRequest {
  insert?: Item[];
  delete?: Key[];
}

export interface ISerializableItemsChangeEvent {
  readonly changed?: Item[];
  readonly deleted?: Key[];
}

function normalizeStorageChangeEvent(
  event: ISerializableItemsChangeEvent,
): IStorageItemsChangeEvent {
  return {
    changed: event.changed ? new Map(event.changed) : undefined,
    deleted: event.deleted ? new Set(event.deleted) : undefined,
  };
}

abstract class BaseStorageDatabaseClient extends Disposable implements IStorageDatabase {
  abstract readonly onDidChangeItemsExternal: Event<IStorageItemsChangeEvent>;

  protected get applicationShared(): boolean {
    return false;
  }

  constructor(
    protected readonly channel: IStorageChannel,
    protected readonly profile: unknown | undefined,
    protected readonly workspace: unknown | undefined,
  ) {
    super();
  }

  async getItems(): Promise<Map<string, string>> {
    const request: IBaseSerializableStorageRequest = {
      profile: this.profile,
      workspace: this.workspace,
      applicationShared: this.applicationShared,
    };
    const items = await this.channel.call<Item[]>('getItems', request);
    return new Map(items);
  }

  updateItems(update: IUpdateRequest): Promise<void> {
    const request: ISerializableUpdateRequest = {
      profile: this.profile,
      workspace: this.workspace,
      applicationShared: this.applicationShared,
    };

    if (update.insert) {
      request.insert = [...update.insert.entries()];
    }

    if (update.delete) {
      request.delete = [...update.delete.values()];
    }

    return this.channel.call<void>('updateItems', request);
  }

  optimize(): Promise<void> {
    return this.channel.call<void>('optimize', {
      profile: this.profile,
      workspace: this.workspace,
      applicationShared: this.applicationShared,
    });
  }

  abstract close(): Promise<void>;
}

abstract class BaseProfileAwareStorageDatabaseClient extends BaseStorageDatabaseClient {
  private readonly changeEmitter = this._register(
    new EventEmitter<IStorageItemsChangeEvent>(),
  );
  readonly onDidChangeItemsExternal = this.changeEmitter.event;

  constructor(channel: IStorageChannel, profile: unknown | undefined) {
    super(channel, profile, undefined);
    this._register(
      this.channel.listen<ISerializableItemsChangeEvent>('onDidChangeStorage', {
        profile,
        workspace: undefined,
        applicationShared: this.applicationShared,
      })((event) => {
        this.changeEmitter.fire(normalizeStorageChangeEvent(event));
      }),
    );
  }

  async close(): Promise<void> {
    this.dispose();
  }
}

export class ApplicationStorageDatabaseClient extends BaseProfileAwareStorageDatabaseClient {
  constructor(channel: IStorageChannel) {
    super(channel, undefined);
  }
}

export class ApplicationSharedStorageDatabaseClient extends BaseProfileAwareStorageDatabaseClient {
  constructor(channel: IStorageChannel) {
    super(channel, undefined);
  }

  protected override get applicationShared(): boolean {
    return true;
  }
}

export class ProfileStorageDatabaseClient extends BaseProfileAwareStorageDatabaseClient {}

export class WorkspaceStorageDatabaseClient extends BaseStorageDatabaseClient {
  readonly onDidChangeItemsExternal: Event<IStorageItemsChangeEvent> = () => ({
    dispose() {},
  } as (() => void) & { dispose(): void });

  constructor(channel: IStorageChannel, workspace: unknown) {
    super(channel, undefined, workspace);
  }

  async close(): Promise<void> {
    this.dispose();
  }
}

export class StorageClient {
  constructor(private readonly channel: IStorageChannel) {}

  isUsed(path: string): Promise<boolean> {
    return this.channel.call<boolean>('isUsed', {
      payload: path,
      profile: undefined,
      workspace: undefined,
    });
  }
}

export class FallbackApplicationStorageDatabaseClient
  extends Disposable
  implements IStorageDatabase
{
  readonly onDidChangeItemsExternal: Event<IStorageItemsChangeEvent> = () => ({
    dispose() {},
  } as (() => void) & { dispose(): void });

  constructor(private readonly channel: IStorageChannel) {
    super();
  }

  async getItems(): Promise<Map<string, string>> {
    const items = await this.channel.call<Item[]>(
      'getFallbackApplicationStorageItems',
      {
        profile: undefined,
        workspace: undefined,
        applicationShared: true,
      },
    );
    return new Map(items);
  }

  updateItems(): Promise<void> {
    throw new Error('Not supported');
  }

  optimize(): Promise<void> {
    throw new Error('Not supported');
  }

  close(): Promise<void> {
    throw new Error('Not supported');
  }
}
