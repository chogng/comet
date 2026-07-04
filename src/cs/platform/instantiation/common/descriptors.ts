export class SyncDescriptor<T> {
  readonly ctor: new (...args: any[]) => T;
  readonly staticArguments: readonly unknown[];
  readonly supportsDelayedInstantiation: boolean;

  constructor(
    ctor: new (...args: any[]) => T,
    staticArguments: readonly unknown[] = [],
    supportsDelayedInstantiation = false,
  ) {
    this.ctor = ctor;
    this.staticArguments = staticArguments;
    this.supportsDelayedInstantiation = supportsDelayedInstantiation;
  }
}

export interface SyncDescriptor0<T> {
  readonly ctor: new () => T;
}
