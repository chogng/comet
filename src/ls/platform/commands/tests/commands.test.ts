import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CommandRegistryImpl,
  CommandServiceImpl,
} from 'ls/platform/commands/common/commands';

test('CommandService executes registered commands by id', () => {
  const registry = new CommandRegistryImpl();
  const service = new CommandServiceImpl(registry);

  registry.registerCommand(
    'test.add',
    (left: number, right: number) => left + right,
  );

  assert.equal(service.executeCommand('test.add', 2, 3), 5);
});

test('CommandRegistry unregisters commands through the disposable', () => {
  const registry = new CommandRegistryImpl();
  const service = new CommandServiceImpl(registry);
  const registration = registry.registerCommand('test.noop', () => true);

  assert.equal(service.executeCommand('test.noop'), true);

  registration.dispose();

  assert.equal(service.executeCommand('test.noop'), undefined);
});

test('CommandRegistry rejects duplicate command ids', () => {
  const registry = new CommandRegistryImpl();

  registry.registerCommand('test.duplicate', () => true);

  assert.throws(
    () => registry.registerCommand('test.duplicate', () => false),
    /already registered/,
  );
});
