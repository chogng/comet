import type { IDisposable } from 'cs/base/common/lifecycle';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { setCommandServiceInstantiationService } from 'cs/platform/commands/common/commands';
import type { SyncDescriptor } from 'cs/platform/instantiation/common/descriptors';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import type {
  IInstantiationService,
  ServiceIdentifier,
} from 'cs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';

let serviceCollection = new ServiceCollection();
let disposables = new DisposableStore();
let instantiationService = new InstantiationService(serviceCollection, true);
let commandServiceInstantiationService = setCommandServiceInstantiationService(
  instantiationService,
);
let disposed = false;

function connectCommandServiceInstantiationService() {
  commandServiceInstantiationService.dispose();
  commandServiceInstantiationService = setCommandServiceInstantiationService(
    instantiationService,
  );
}

function ensureActiveServiceCollection() {
  if (!disposed) {
    return;
  }

  serviceCollection = new ServiceCollection();
  disposables = new DisposableStore();
  instantiationService = new InstantiationService(serviceCollection, true);
  connectCommandServiceInstantiationService();
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
  commandServiceInstantiationService.dispose();
  disposables.dispose();
  instantiationService.dispose();
}
