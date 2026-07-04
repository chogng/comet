import type { DisposableLike } from 'cs/base/common/lifecycle';
import { EventEmitter } from 'cs/base/common/event';
import { toDisposable } from 'cs/base/common/lifecycle';
import type { IJSONSchema } from 'cs/base/common/jsonSchema';
import {
  USER_SETTINGS_SCHEMA_ID,
  jsonSchemaRegistry,
} from 'cs/platform/jsonschema/common/jsonSchemaRegistry';

export enum ConfigurationScope {
  APPLICATION = 1,
  MACHINE,
  WINDOW,
  RESOURCE,
}

export interface ConfigurationPropertySchema extends IJSONSchema {
  readonly scope?: ConfigurationScope;
  readonly restricted?: boolean;
}

export interface RegisteredConfigurationPropertySchema
  extends ConfigurationPropertySchema {
  readonly key: string;
}

export interface ConfigurationRegistry {
  readonly onDidUpdateConfiguration: (listener: (event: { properties: Set<string> }) => void) => DisposableLike;
  registerConfigurationProperties(
    properties: Record<string, ConfigurationPropertySchema>,
  ): DisposableLike;
  getConfigurationProperties(): Record<string, RegisteredConfigurationPropertySchema>;
}

class ConfigurationRegistryImpl implements ConfigurationRegistry {
  private readonly properties = new Map<string, RegisteredConfigurationPropertySchema>();
  private readonly didUpdateConfigurationEmitter = new EventEmitter<{ properties: Set<string> }>();
  private settingsSchemaRegistration: DisposableLike | undefined;

  readonly onDidUpdateConfiguration = this.didUpdateConfigurationEmitter.event;

  constructor() {
    this.updateSettingsSchema();
  }

  registerConfigurationProperties(
    properties: Record<string, ConfigurationPropertySchema>,
  ): DisposableLike {
    const registeredKeys = Object.keys(properties);
    for (const [key, schema] of Object.entries(properties)) {
      this.properties.set(key, {
        ...schema,
        key,
      });
    }

    this.updateSettingsSchema();
    this.didUpdateConfigurationEmitter.fire({ properties: new Set(registeredKeys) });

    return toDisposable(() => {
      for (const key of registeredKeys) {
        this.properties.delete(key);
      }
      this.updateSettingsSchema();
      this.didUpdateConfigurationEmitter.fire({ properties: new Set(registeredKeys) });
    });
  }

  getConfigurationProperties(): Record<string, RegisteredConfigurationPropertySchema> {
    return Object.fromEntries(this.properties);
  }

  private updateSettingsSchema(): void {
    this.settingsSchemaRegistration?.dispose();
    this.settingsSchemaRegistration = jsonSchemaRegistry.registerSchema(
      USER_SETTINGS_SCHEMA_ID,
      createSettingsSchema(this.properties),
      ['**/settings.json'],
    );
  }
}

export const configurationRegistry: ConfigurationRegistry = new ConfigurationRegistryImpl();

function createSettingsSchema(
  properties: ReadonlyMap<string, RegisteredConfigurationPropertySchema>,
): IJSONSchema {
  return {
    id: USER_SETTINGS_SCHEMA_ID,
    type: 'object',
    title: 'User Settings',
    allowComments: true,
    allowTrailingCommas: true,
    additionalProperties: false,
    properties: Object.fromEntries(
      [...properties].map(([key, schema]) => {
        const { key: _key, scope: _scope, restricted: _restricted, ...jsonSchema } = schema;
        return [key, jsonSchema];
      }),
    ),
  };
}
