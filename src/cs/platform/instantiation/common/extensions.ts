import { SyncDescriptor } from 'cs/platform/instantiation/common/descriptors';
import type {
  BrandedService,
  ServiceIdentifier,
} from 'cs/platform/instantiation/common/instantiation';

const registry: [ServiceIdentifier<unknown>, SyncDescriptor<unknown>][] = [];

export const enum InstantiationType {
  Eager = 0,
  Delayed = 1,
}

export function registerSingleton<T, Services extends BrandedService[]>(
  id: ServiceIdentifier<T>,
  ctor: new (...services: Services) => T,
  supportsDelayedInstantiation: InstantiationType,
): void;
export function registerSingleton<T>(
  id: ServiceIdentifier<T>,
  descriptor: SyncDescriptor<T>,
): void;
export function registerSingleton<T, Services extends BrandedService[]>(
  id: ServiceIdentifier<T>,
  ctorOrDescriptor:
    | (new (...services: Services) => T)
    | SyncDescriptor<T>,
  supportsDelayedInstantiation: boolean | InstantiationType = false,
): void {
  const descriptor =
    ctorOrDescriptor instanceof SyncDescriptor
      ? ctorOrDescriptor
      : new SyncDescriptor(
          ctorOrDescriptor as new (...args: any[]) => T,
          [],
          Boolean(supportsDelayedInstantiation),
        );

  registry.push([
    id as ServiceIdentifier<unknown>,
    descriptor as SyncDescriptor<unknown>,
  ]);
}

export function getSingletonServiceDescriptors(): [
  ServiceIdentifier<unknown>,
  SyncDescriptor<unknown>,
][] {
  return registry;
}
