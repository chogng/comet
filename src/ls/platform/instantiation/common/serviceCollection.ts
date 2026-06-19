import type { SyncDescriptor } from 'ls/platform/instantiation/common/descriptors';
import type { ServiceIdentifier } from 'ls/platform/instantiation/common/instantiation';

export class ServiceCollection {
  private readonly entries = new Map<ServiceIdentifier<unknown>, unknown>();

  constructor(
    ...entries: [ServiceIdentifier<unknown>, unknown][]
  ) {
    for (const [id, service] of entries) {
      this.set(id, service);
    }
  }

  set<T>(
    id: ServiceIdentifier<T>,
    instanceOrDescriptor: T | SyncDescriptor<T>,
  ): T | SyncDescriptor<T> | undefined {
    const previous = this.entries.get(id) as T | SyncDescriptor<T> | undefined;
    this.entries.set(id, instanceOrDescriptor);
    return previous;
  }

  has(id: ServiceIdentifier<unknown>): boolean {
    return this.entries.has(id);
  }

  get<T>(id: ServiceIdentifier<T>): T | SyncDescriptor<T> | undefined {
    return this.entries.get(id) as T | SyncDescriptor<T> | undefined;
  }
}

