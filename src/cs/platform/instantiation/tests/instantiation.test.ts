/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { SyncDescriptor } from 'cs/platform/instantiation/common/descriptors';
import {
  createDecorator,
  type ServiceIdentifier,
} from 'cs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';

interface TestService {
  readonly _serviceBrand: undefined;
  readonly value: string;
}

const ITestService = createDecorator<TestService>('testService');

function decorateParameter<T>(
  id: ServiceIdentifier<T>,
  ctor: Function,
  index: number,
) {
  id(ctor, undefined, index);
}

test('InstantiationService injects decorator services into constructors', () => {
  class Consumer {
    constructor(
      readonly prefix: string,
      readonly testService: TestService,
    ) {}
  }
  decorateParameter(ITestService, Consumer, 1);

  const service = new InstantiationService(
    new ServiceCollection([
      ITestService,
      { value: 'ready', _serviceBrand: undefined } satisfies TestService,
    ]),
    true,
  );

  const consumer = service.createInstance(Consumer, 'state');

  assert.equal(consumer.prefix, 'state');
  assert.equal(consumer.testService.value, 'ready');

  service.dispose();
});

test('InstantiationService creates descriptor services once', () => {
  let created = 0;
  class TestServiceImpl implements TestService {
    readonly _serviceBrand = undefined;
    readonly value = `created:${++created}`;
  }

  const service = new InstantiationService(
    new ServiceCollection([
      ITestService,
      new SyncDescriptor(TestServiceImpl),
    ]),
    true,
  );

  const first = service.invokeFunction((accessor) => accessor.get(ITestService));
  const second = service.invokeFunction((accessor) => accessor.get(ITestService));

  assert.equal(first.value, 'created:1');
  assert.equal(second, first);

  service.dispose();
});

test('InstantiationService child services override parent services', () => {
  const parent = new InstantiationService(
    new ServiceCollection([
      ITestService,
      { value: 'parent', _serviceBrand: undefined } satisfies TestService,
    ]),
    true,
  );
  const child = parent.createChild(
    new ServiceCollection([
      ITestService,
      { value: 'child', _serviceBrand: undefined } satisfies TestService,
    ]),
  );

  const value = child.invokeFunction((accessor) => accessor.get(ITestService).value);

  assert.equal(value, 'child');

  parent.dispose();
});

test('InstantiationService accessor is only valid during invocation', () => {
  const service = new InstantiationService(new ServiceCollection(), true);
  let leakedAccessor: ((id: typeof ITestService) => TestService) | undefined;

  service.invokeFunction((accessor) => {
    leakedAccessor = accessor.get;
  });

  assert.throws(() => leakedAccessor?.(ITestService), /only valid during invocation/);

  service.dispose();
});

test('InstantiationService disposes every owned service in reverse creation order and aggregates failures', () => {
	interface ITeardownService {
		readonly _serviceBrand: undefined;
	}

	const IFirstTeardownService = createDecorator<ITeardownService>('firstTeardownService');
	const ISecondTeardownService = createDecorator<ITeardownService>('secondTeardownService');
	const IThirdTeardownService = createDecorator<ITeardownService>('thirdTeardownService');
	const transitions: string[] = [];
	const firstError = new Error('first service disposal failed');
	const thirdError = new Error('third service disposal failed');

	class TeardownService implements ITeardownService {
		declare readonly _serviceBrand: undefined;

		constructor(
			private readonly name: string,
			private readonly error: Error | undefined,
		) {}

		dispose(): void {
			transitions.push(this.name);
			if (this.error) {
				throw this.error;
			}
		}
	}

	const service = new InstantiationService(
		new ServiceCollection(
			[IFirstTeardownService, new SyncDescriptor(TeardownService, ['first', firstError])],
			[ISecondTeardownService, new SyncDescriptor(TeardownService, ['second', undefined])],
			[IThirdTeardownService, new SyncDescriptor(TeardownService, ['third', thirdError])],
		),
		true,
	);
	service.invokeFunction(accessor => {
		accessor.get(IFirstTeardownService);
		accessor.get(ISecondTeardownService);
		accessor.get(IThirdTeardownService);
	});

	assert.throws(() => service.dispose(), error => {
		assert.ok(error instanceof AggregateError);
		assert.deepEqual(error.errors, [thirdError, firstError]);
		return true;
	});
	assert.deepEqual(transitions, ['third', 'second', 'first']);

	service.dispose();
	assert.deepEqual(transitions, ['third', 'second', 'first']);
});
