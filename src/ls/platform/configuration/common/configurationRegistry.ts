import type { DisposableLike } from 'ls/base/common/lifecycle';
import { EventEmitter } from 'ls/base/common/event';
import { toDisposable } from 'ls/base/common/lifecycle';

export enum ConfigurationScope {
  APPLICATION = 1,
  MACHINE,
  WINDOW,
  RESOURCE,
}

export interface ConfigurationPropertySchema {
  readonly type?: string | readonly string[];
  readonly default?: unknown;
  readonly description?: string;
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

  readonly onDidUpdateConfiguration = this.didUpdateConfigurationEmitter.event;

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

    this.didUpdateConfigurationEmitter.fire({ properties: new Set(registeredKeys) });

    return toDisposable(() => {
      for (const key of registeredKeys) {
        this.properties.delete(key);
      }
      this.didUpdateConfigurationEmitter.fire({ properties: new Set(registeredKeys) });
    });
  }

  getConfigurationProperties(): Record<string, RegisteredConfigurationPropertySchema> {
    return Object.fromEntries(this.properties);
  }
}

export const configurationRegistry: ConfigurationRegistry = new ConfigurationRegistryImpl();
