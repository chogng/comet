import type { DisposableStore } from 'cs/base/common/lifecycle';
import type { SyncDescriptor0 } from 'cs/platform/instantiation/common/descriptors';
import type { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';

export namespace _util {
  export const serviceIds = new Map<string, ServiceIdentifier<unknown>>();

  export const DI_TARGET = '$di$target';
  export const DI_DEPENDENCIES = '$di$dependencies';

  export interface DITarget extends Function {
    [DI_TARGET]?: Function;
    [DI_DEPENDENCIES]?: { id: ServiceIdentifier<unknown>; index: number }[];
  }

  export function getServiceDependencies(
    ctor: DITarget,
  ): { id: ServiceIdentifier<unknown>; index: number }[] {
    return ctor[DI_DEPENDENCIES] ?? [];
  }
}

export type BrandedService = { _serviceBrand: undefined };

export interface ServicesAccessor {
  get<T>(id: ServiceIdentifier<T>): T;
}

export type GetLeadingNonServiceArgs<TArgs extends unknown[]> =
  TArgs extends []
    ? []
    : TArgs extends [...infer TFirst, BrandedService]
      ? GetLeadingNonServiceArgs<TFirst>
      : TArgs;

export interface IInstantiationService {
  readonly _serviceBrand: undefined;
  createInstance<T>(descriptor: SyncDescriptor0<T>): T;
  createInstance<
    Ctor extends new (...args: any[]) => unknown,
    R extends InstanceType<Ctor>,
  >(ctor: Ctor, ...args: GetLeadingNonServiceArgs<ConstructorParameters<Ctor>>): R;
  invokeFunction<R, TS extends unknown[] = []>(
    fn: (accessor: ServicesAccessor, ...args: TS) => R,
    ...args: TS
  ): R;
  createChild(
    services: ServiceCollection,
    store?: DisposableStore,
  ): IInstantiationService;
  dispose(): void;
}

export const IInstantiationService =
  createDecorator<IInstantiationService>('instantiationService');

export interface ServiceIdentifier<T> {
  (...args: unknown[]): void;
  readonly type: T;
}

function storeServiceDependency(
  id: ServiceIdentifier<unknown>,
  target: Function,
  index: number,
): void {
  const candidate = target as _util.DITarget;
  if (candidate[_util.DI_TARGET] === target) {
    candidate[_util.DI_DEPENDENCIES]?.push({ id, index });
    return;
  }

  candidate[_util.DI_DEPENDENCIES] = [{ id, index }];
  candidate[_util.DI_TARGET] = target;
}

export function createDecorator<T>(serviceId: string): ServiceIdentifier<T> {
  const existing = _util.serviceIds.get(serviceId);
  if (existing) {
    return existing as ServiceIdentifier<T>;
  }

  const id = function (
    target: Function,
    _key: string | undefined,
    index: number,
  ) {
    if (arguments.length !== 3) {
      throw new Error('@IServiceName-decorator can only be used to decorate a parameter');
    }

    storeServiceDependency(id, target, index);
  } as ServiceIdentifier<T>;

  id.toString = () => serviceId;
  _util.serviceIds.set(serviceId, id as ServiceIdentifier<unknown>);
  return id;
}

export function refineServiceDecorator<TBase, T extends TBase>(
  serviceIdentifier: ServiceIdentifier<TBase>,
): ServiceIdentifier<T> {
  return serviceIdentifier as ServiceIdentifier<T>;
}
