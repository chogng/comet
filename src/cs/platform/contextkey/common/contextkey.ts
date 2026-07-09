import { EventEmitter } from 'cs/base/common/event';
import type { DisposableLike } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export type ContextKeyValue = boolean | number | string | null | undefined;

export type ContextKeyChangeEvent = {
  readonly keys: ReadonlySet<string>;
};

export interface ContextKey<T extends ContextKeyValue = ContextKeyValue> {
  readonly key: string;
  get(): T;
  set(value: T): void;
  reset(): void;
}

export interface ContextKeyService {
  readonly onDidChangeContext: (
    listener: (event: ContextKeyChangeEvent) => void,
  ) => DisposableLike;
  createKey<T extends ContextKeyValue>(
    key: string,
    defaultValue: T,
  ): ContextKey<T>;
  getContextKeyValue<T extends ContextKeyValue = ContextKeyValue>(
    key: string,
  ): T;
  setContextKeyValue<T extends ContextKeyValue>(
    key: string,
    value: T,
  ): void;
  contextMatchesRules(expression: ContextKeyExpression | undefined): boolean;
}

export interface IContextKeyService extends ContextKeyService {
  readonly _serviceBrand: undefined;
}

export const IContextKeyService =
  createDecorator<IContextKeyService>('contextKeyService');

export class RawContextKey<T extends ContextKeyValue = ContextKeyValue> {
  constructor(
    readonly key: string,
    readonly defaultValue: T,
  ) {}

  bindTo(service: ContextKeyService): ContextKey<T> {
    return service.createKey(this.key, this.defaultValue);
  }

  isEqualTo(value: T): ContextKeyExpression {
    return ContextKeyExpr.equals(this.key, value);
  }

  notEqualsTo(value: T): ContextKeyExpression {
    return ContextKeyExpr.notEquals(this.key, value);
  }
}

export type ContextKeyExpression =
  | { readonly type: 'has'; readonly key: string }
  | {
      readonly type: 'equals';
      readonly key: string;
      readonly value: ContextKeyValue;
    }
  | {
      readonly type: 'notEquals';
      readonly key: string;
      readonly value: ContextKeyValue;
    }
  | { readonly type: 'not'; readonly expression: ContextKeyExpression }
  | { readonly type: 'and'; readonly expressions: readonly ContextKeyExpression[] }
  | { readonly type: 'or'; readonly expressions: readonly ContextKeyExpression[] };

export const ContextKeyExpr = {
  has(key: string): ContextKeyExpression {
    return { type: 'has', key };
  },
  equals(key: string, value: ContextKeyValue): ContextKeyExpression {
    return { type: 'equals', key, value };
  },
  notEquals(key: string, value: ContextKeyValue): ContextKeyExpression {
    return { type: 'notEquals', key, value };
  },
  not(expression: ContextKeyExpression): ContextKeyExpression {
    return { type: 'not', expression };
  },
  and(
    ...expressions: readonly (ContextKeyExpression | undefined)[]
  ): ContextKeyExpression | undefined {
    const filtered = expressions.filter(
      (expression): expression is ContextKeyExpression => Boolean(expression),
    );
    return filtered.length > 0
      ? { type: 'and', expressions: filtered }
      : undefined;
  },
  or(
    ...expressions: readonly (ContextKeyExpression | undefined)[]
  ): ContextKeyExpression | undefined {
    const filtered = expressions.filter(
      (expression): expression is ContextKeyExpression => Boolean(expression),
    );
    return filtered.length > 0
      ? { type: 'or', expressions: filtered }
      : undefined;
  },
} as const;

class BoundContextKey<T extends ContextKeyValue> implements ContextKey<T> {
  constructor(
    private readonly service: ContextKeyService,
    readonly key: string,
    private readonly defaultValue: T,
  ) {}

  get(): T {
    return this.service.getContextKeyValue<T>(this.key);
  }

  set(value: T): void {
    this.service.setContextKeyValue(this.key, value);
  }

  reset(): void {
    this.service.setContextKeyValue(this.key, this.defaultValue);
  }
}

export class ContextKeyServiceImpl implements IContextKeyService {
  declare readonly _serviceBrand: undefined;

  private readonly values = new Map<string, ContextKeyValue>();
  private readonly onDidChangeContextEmitter =
    new EventEmitter<ContextKeyChangeEvent>();

  readonly onDidChangeContext = this.onDidChangeContextEmitter.event;

  createKey<T extends ContextKeyValue>(
    key: string,
    defaultValue: T,
  ): ContextKey<T> {
    if (!this.values.has(key)) {
      this.values.set(key, defaultValue);
    }

    return new BoundContextKey(this, key, defaultValue);
  }

  getContextKeyValue<T extends ContextKeyValue = ContextKeyValue>(
    key: string,
  ): T {
    return this.values.get(key) as T;
  }

  setContextKeyValue<T extends ContextKeyValue>(
    key: string,
    value: T,
  ): void {
    if (Object.is(this.values.get(key), value)) {
      return;
    }

    this.values.set(key, value);
    this.onDidChangeContextEmitter.fire({ keys: new Set([key]) });
  }

  contextMatchesRules(expression: ContextKeyExpression | undefined): boolean {
    if (!expression) {
      return true;
    }

    return evaluateContextKeyExpression(expression, this);
  }
}

export function evaluateContextKeyExpression(
  expression: ContextKeyExpression,
  service: Pick<ContextKeyService, 'getContextKeyValue'>,
): boolean {
  switch (expression.type) {
    case 'has':
      return Boolean(service.getContextKeyValue(expression.key));
    case 'equals':
      return Object.is(
        service.getContextKeyValue(expression.key),
        expression.value,
      );
    case 'notEquals':
      return !Object.is(
        service.getContextKeyValue(expression.key),
        expression.value,
      );
    case 'not':
      return !evaluateContextKeyExpression(expression.expression, service);
    case 'and':
      return expression.expressions.every((child) =>
        evaluateContextKeyExpression(child, service),
      );
    case 'or':
      return expression.expressions.some((child) =>
        evaluateContextKeyExpression(child, service),
      );
  }
}

export const contextKeyService: IContextKeyService =
  new ContextKeyServiceImpl();
