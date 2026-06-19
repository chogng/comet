import type { IDisposable } from 'ls/base/common/lifecycle';
import { DisposableStore } from 'ls/base/common/lifecycle';
import type { SyncDescriptor } from 'ls/platform/instantiation/common/descriptors';
import { getSingletonServiceDescriptors } from 'ls/platform/instantiation/common/extensions';
import type {
  IInstantiationService,
  ServiceIdentifier,
} from 'ls/platform/instantiation/common/instantiation';
import { InstantiationService } from 'ls/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'ls/platform/instantiation/common/serviceCollection';

let serviceCollection = new ServiceCollection();
let disposables = new DisposableStore();
let instantiationService = new InstantiationService(serviceCollection, true);
let disposed = false;

function ensureActiveServiceCollection() {
  if (!disposed) {
    return;
  }

  serviceCollection = new ServiceCollection();
  disposables = new DisposableStore();
  instantiationService = new InstantiationService(serviceCollection, true);
  disposed = false;
}

function syncSingletonDescriptors() {
  ensureActiveServiceCollection();
  for (const [id, descriptor] of getSingletonServiceDescriptors()) {
    if (!serviceCollection.has(id)) {
      serviceCollection.set(id, descriptor);
    }
  }
}

export function getWorkbenchServiceCollection(): ServiceCollection {
  syncSingletonDescriptors();
  return serviceCollection;
}

export function getWorkbenchInstantiationService(): IInstantiationService {
  syncSingletonDescriptors();
  return instantiationService;
}

export function registerWorkbenchService<T>(
  id: ServiceIdentifier<T>,
  instanceOrDescriptor: T | SyncDescriptor<T>,
): void {
  ensureActiveServiceCollection();
  serviceCollection.set(id, instanceOrDescriptor);
}

export function registerWorkbenchDisposable(disposable: IDisposable): void {
  ensureActiveServiceCollection();
  disposables.add(disposable);
}

export function disposeWorkbenchInstantiationService(): void {
  if (disposed) {
    return;
  }

  disposed = true;
  disposables.dispose();
  instantiationService.dispose();
}
