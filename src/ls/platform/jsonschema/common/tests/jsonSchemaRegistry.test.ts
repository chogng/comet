import assert from 'node:assert/strict';
import test from 'node:test';

import { configurationRegistry } from 'ls/platform/configuration/common/configurationRegistry';
import {
  JSONSchemaRegistryImpl,
  USER_SETTINGS_SCHEMA_ID,
  jsonSchemaRegistry,
} from 'ls/platform/jsonschema/common/jsonSchemaRegistry';

test('JSONSchemaRegistry registers schemas and fires change events', () => {
  const registry = new JSONSchemaRegistryImpl();
  const changedUris: string[] = [];
  const subscription = registry.onDidChangeSchema((event) => {
    changedUris.push(...event.uris);
  });

  const disposable = registry.registerSchema('ls://schemas/example', {
    type: 'object',
    properties: {
      title: { type: 'string' },
    },
  });

  assert.equal(registry.getSchema('ls://schemas/example')?.schema.type, 'object');
  assert.deepEqual(changedUris, ['ls://schemas/example']);

  disposable.dispose();
  assert.equal(registry.getSchema('ls://schemas/example'), undefined);
  assert.deepEqual(changedUris, [
    'ls://schemas/example',
    'ls://schemas/example',
  ]);

  subscription.dispose();
  registry.dispose();
});

test('configuration registry contributes user settings JSON schema', () => {
  const key = 'literature.testJsonSchemaSetting';
  const disposable = configurationRegistry.registerConfigurationProperties({
    [key]: {
      type: 'string',
      default: 'default value',
      description: 'Test setting',
    },
  });

  try {
    const schema = jsonSchemaRegistry.getSchema(USER_SETTINGS_SCHEMA_ID)?.schema;
    assert(schema);
    assert.equal(schema.type, 'object');
    assert.equal(schema.allowComments, true);
    assert.equal(schema.allowTrailingCommas, true);
    assert.equal(schema.properties?.[key]?.type, 'string');
    assert.equal(schema.properties?.[key]?.default, 'default value');
  } finally {
    disposable.dispose();
  }

  const nextSchema = jsonSchemaRegistry.getSchema(USER_SETTINGS_SCHEMA_ID)?.schema;
  assert.equal(nextSchema?.properties?.[key], undefined);
});
