/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DisposableStore } from 'cs/base/common/lifecycle';
import {
  disposeAll,
  isDisposable,
  type IDisposable,
} from 'cs/base/common/lifecycle';
import {
  SyncDescriptor,
  type SyncDescriptor0,
} from 'cs/platform/instantiation/common/descriptors';
import {
  IInstantiationService,
  type GetLeadingNonServiceArgs,
  type ServiceIdentifier,
  type ServicesAccessor,
  _util,
} from 'cs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';

class CyclicDependencyError extends Error {
  constructor(id: ServiceIdentifier<unknown>) {
    super(`Cyclic dependency while instantiating service '${id}'.`);
  }
}

export class InstantiationService implements IInstantiationService {
  declare readonly _serviceBrand: undefined;

  private disposed = false;
  private readonly servicesToMaybeDispose = new Set<unknown>();
  private readonly children = new Set<InstantiationService>();
  private readonly activeInstantiations = new Set<ServiceIdentifier<unknown>>();

  constructor(
    private readonly services: ServiceCollection = new ServiceCollection(),
    private readonly strict = false,
    private readonly parent?: InstantiationService,
  ) {
    this.services.set(IInstantiationService, this);
  }

  dispose(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		const children = [...this.children];
		const serviceCandidates = [...this.servicesToMaybeDispose];
		this.children.clear();
		this.servicesToMaybeDispose.clear();
		disposeAll([
			...serviceCandidates.filter(isDisposable),
			...children,
		]);
  }

  createChild(
    services: ServiceCollection,
    store?: DisposableStore,
  ): IInstantiationService {
    this.throwIfDisposed();
    const child = new InstantiationService(services, this.strict, this);
    this.children.add(child);
    store?.add(child);
    return child;
  }

  invokeFunction<R, TS extends unknown[] = []>(
    fn: (accessor: ServicesAccessor, ...args: TS) => R,
    ...args: TS
  ): R {
    this.throwIfDisposed();
    let done = false;
    const accessor: ServicesAccessor = {
      get: <T>(id: ServiceIdentifier<T>) => {
        if (done) {
          throw new Error('service accessor is only valid during invocation');
        }

        return this.getOrCreateServiceInstance(id);
      },
    };

    try {
      return fn(accessor, ...args);
    } finally {
      done = true;
    }
  }

  createInstance<T>(descriptor: SyncDescriptor0<T>): T;
  createInstance<
    Ctor extends new (...args: any[]) => unknown,
    R extends InstanceType<Ctor>,
  >(ctor: Ctor, ...args: GetLeadingNonServiceArgs<ConstructorParameters<Ctor>>): R;
  createInstance(
    ctorOrDescriptor: SyncDescriptor0<unknown> | (new (...args: any[]) => unknown),
    ...rest: unknown[]
  ): unknown {
    this.throwIfDisposed();

    if (typeof ctorOrDescriptor !== 'function') {
      const staticArguments =
        ctorOrDescriptor instanceof SyncDescriptor
          ? ctorOrDescriptor.staticArguments
          : [];
      return this.createInstanceWithDependencies(
        ctorOrDescriptor.ctor,
        [...staticArguments, ...rest],
      );
    }

    return this.createInstanceWithDependencies(ctorOrDescriptor, rest);
  }

  private createInstanceWithDependencies<T>(
    ctor: new (...args: any[]) => T,
    args: unknown[],
  ): T {
    const serviceDependencies = _util
      .getServiceDependencies(ctor)
      .sort((left, right) => left.index - right.index);
    const serviceArgs = serviceDependencies.map((dependency) =>
      this.getOrCreateServiceInstance(dependency.id),
    );
    const firstServiceArgPosition =
      serviceDependencies.length > 0 ? serviceDependencies[0].index : args.length;
    const normalizedArgs =
      args.length === firstServiceArgPosition
        ? args
        : args.slice(0, firstServiceArgPosition);

    return Reflect.construct(
      ctor,
      [...normalizedArgs, ...serviceArgs],
    ) as T;
  }

  private getServiceInstanceOrDescriptor<T>(
    id: ServiceIdentifier<T>,
  ): T | SyncDescriptor<T> | undefined {
    return this.services.get(id) ?? this.parent?.getServiceInstanceOrDescriptor(id);
  }

  private setCreatedServiceInstance<T>(
    id: ServiceIdentifier<T>,
    instance: T,
  ): void {
    if (this.services.get(id) instanceof SyncDescriptor) {
      this.services.set(id, instance);
      return;
    }

    if (this.parent) {
      this.parent.setCreatedServiceInstance(id, instance);
      return;
    }

    throw new Error(`Cannot set unknown service instance '${id}'.`);
  }

  private getOrCreateServiceInstance<T>(id: ServiceIdentifier<T>): T {
    const instanceOrDescriptor = this.getServiceInstanceOrDescriptor(id);
    if (!instanceOrDescriptor) {
      if (this.strict) {
        throw new Error(`Unknown service '${id}'.`);
      }

      return undefined as T;
    }

    if (!(instanceOrDescriptor instanceof SyncDescriptor)) {
      return instanceOrDescriptor;
    }

    return this.createAndCacheServiceInstance(id, instanceOrDescriptor);
  }

  private createAndCacheServiceInstance<T>(
    id: ServiceIdentifier<T>,
    descriptor: SyncDescriptor<T>,
  ): T {
    if (this.activeInstantiations.has(id)) {
      throw new CyclicDependencyError(id as ServiceIdentifier<unknown>);
    }

    this.activeInstantiations.add(id);
    try {
      const instance = this.createInstanceWithDependencies(
        descriptor.ctor,
        [...descriptor.staticArguments],
      );
      this.setCreatedServiceInstance(id, instance);
      this.servicesToMaybeDispose.add(instance);
      return instance;
    } finally {
      this.activeInstantiations.delete(id);
    }
  }

  private throwIfDisposed(): void {
    if (this.disposed) {
      throw new Error('InstantiationService has been disposed');
    }
  }
}

export function disposeServiceCollection(
  serviceCollection: ServiceCollection,
  ids: readonly ServiceIdentifier<unknown>[],
): void {
  for (const id of ids) {
    const candidate = serviceCollection.get(id);
    if (isDisposable(candidate)) {
      (candidate as IDisposable).dispose();
    }
  }
}
