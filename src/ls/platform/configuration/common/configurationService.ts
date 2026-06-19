import { EventEmitter } from 'ls/base/common/event';
import type {
  ConfigurationChangeEvent,
  ConfigurationData,
  ConfigurationOverrides,
  ConfigurationService as IConfigurationService,
  ConfigurationUpdateOverrides,
  ConfigurationValue,
} from 'ls/platform/configuration/common/configuration';
import {
  ConfigurationTarget,
  isConfigurationOverrides,
  isConfigurationUpdateOverrides,
} from 'ls/platform/configuration/common/configuration';
import {
  compareConfigurationModels,
  ConfigurationModel,
} from 'ls/platform/configuration/common/configurationModels';
import { DefaultConfiguration } from 'ls/platform/configuration/common/configurations';

export class ConfigurationService implements IConfigurationService {
  private readonly didChangeConfigurationEmitter = new EventEmitter<ConfigurationChangeEvent>();
  private readonly defaultConfiguration = new DefaultConfiguration();
  private userConfiguration = ConfigurationModel.createEmptyModel();
  private memoryConfiguration = ConfigurationModel.createEmptyModel();

  readonly onDidChangeConfiguration = this.didChangeConfigurationEmitter.event;

  constructor() {
    this.defaultConfiguration.initialize();
  }

  getConfigurationData(): ConfigurationData {
    return {
      defaults: this.defaultConfiguration.configurationModel.toJSON(),
      userLocal: this.userConfiguration.toJSON(),
      memory: this.memoryConfiguration.toJSON(),
    };
  }

  getValue<T>(): T;
  getValue<T>(section: string): T;
  getValue<T>(overrides: ConfigurationOverrides): T;
  getValue<T>(section: string, overrides: ConfigurationOverrides): T;
  getValue<T>(arg1?: unknown): T {
    const section = typeof arg1 === 'string' ? arg1 : undefined;
    return this.consolidatedConfiguration.getValue<T>(section) as T;
  }

  updateValue(key: string, value: unknown): Promise<void>;
  updateValue(key: string, value: unknown, target: ConfigurationTarget): Promise<void>;
  updateValue(
    key: string,
    value: unknown,
    overrides: ConfigurationOverrides | ConfigurationUpdateOverrides,
  ): Promise<void>;
  updateValue(
    key: string,
    value: unknown,
    overrides: ConfigurationOverrides | ConfigurationUpdateOverrides,
    target: ConfigurationTarget,
  ): Promise<void>;
  async updateValue(key: string, value: unknown, arg3?: unknown, arg4?: unknown): Promise<void> {
    const target = isConfigurationOverrides(arg3) || isConfigurationUpdateOverrides(arg3)
      ? arg4
      : arg3;
    const resolvedTarget =
      target === ConfigurationTarget.MEMORY ? ConfigurationTarget.MEMORY : ConfigurationTarget.USER;
    const model =
      resolvedTarget === ConfigurationTarget.MEMORY
        ? this.memoryConfiguration
        : this.userConfiguration;
    const previous = model.merge();

    if (value === undefined) {
      model.removeValue(key);
    } else {
      model.setValue(key, value);
    }

    const change = compareConfigurationModels(previous, model);
    this.fireChange([...change.added, ...change.removed, ...change.updated], resolvedTarget);
  }

  inspect<T>(key: string): ConfigurationValue<Readonly<T>> {
    return {
      defaultValue: this.defaultConfiguration.configurationModel.getValue<T>(key),
      userValue: this.userConfiguration.getValue<T>(key),
      userLocalValue: this.userConfiguration.getValue<T>(key),
      memoryValue: this.memoryConfiguration.getValue<T>(key),
      value: this.getValue<T>(key),
    } as ConfigurationValue<Readonly<T>>;
  }

  async reloadConfiguration(): Promise<void> {
    return undefined;
  }

  keys() {
    return {
      default: [...this.defaultConfiguration.configurationModel.keys],
      user: [...this.userConfiguration.keys],
      workspace: [],
      workspaceFolder: [],
      memory: [...this.memoryConfiguration.keys],
    };
  }

  protected replaceUserConfiguration(
    model: ConfigurationModel,
    source = ConfigurationTarget.USER,
  ): void {
    const previous = this.userConfiguration;
    this.userConfiguration = model;
    const change = compareConfigurationModels(previous, model);
    this.fireChange([...change.added, ...change.removed, ...change.updated], source);
  }

  private get consolidatedConfiguration() {
    return this.defaultConfiguration.configurationModel
      .merge(this.userConfiguration)
      .merge(this.memoryConfiguration);
  }

  private fireChange(keys: string[], source: ConfigurationTarget) {
    if (keys.length === 0) {
      return;
    }

    const affectedKeys = new Set(keys);
    this.didChangeConfigurationEmitter.fire({
      source,
      affectedKeys,
      change: { keys },
      affectsConfiguration(configuration) {
        return [...affectedKeys].some(
          (key) => key === configuration || key.startsWith(`${configuration}.`),
        );
      },
    });
  }
}
