import type {
  AppSettings,
  StoredAppSettings,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import type { Event } from 'ls/base/common/event';

export interface ConfigurationOverrides {
  readonly overrideIdentifier?: string | null;
  readonly resource?: string | null;
}

export type ConfigurationUpdateOverrides = Omit<
  ConfigurationOverrides,
  'overrideIdentifier'
> & {
  readonly overrideIdentifiers?: readonly string[] | null;
};

export enum ConfigurationTarget {
  APPLICATION = 1,
  USER,
  USER_LOCAL,
  USER_REMOTE,
  WORKSPACE,
  WORKSPACE_FOLDER,
  DEFAULT,
  MEMORY,
}

export function ConfigurationTargetToString(target: ConfigurationTarget) {
  switch (target) {
    case ConfigurationTarget.APPLICATION:
      return 'APPLICATION';
    case ConfigurationTarget.USER:
      return 'USER';
    case ConfigurationTarget.USER_LOCAL:
      return 'USER_LOCAL';
    case ConfigurationTarget.USER_REMOTE:
      return 'USER_REMOTE';
    case ConfigurationTarget.WORKSPACE:
      return 'WORKSPACE';
    case ConfigurationTarget.WORKSPACE_FOLDER:
      return 'WORKSPACE_FOLDER';
    case ConfigurationTarget.DEFAULT:
      return 'DEFAULT';
    case ConfigurationTarget.MEMORY:
      return 'MEMORY';
  }
}

export interface ConfigurationChange {
  readonly keys: readonly string[];
}

export interface ConfigurationChangeEvent {
  readonly source: ConfigurationTarget;
  readonly affectedKeys: ReadonlySet<string>;
  readonly change: ConfigurationChange;
  affectsConfiguration(configuration: string, overrides?: ConfigurationOverrides): boolean;
}

export interface ConfigurationValue<T> {
  readonly defaultValue?: T;
  readonly applicationValue?: T;
  readonly userValue?: T;
  readonly userLocalValue?: T;
  readonly userRemoteValue?: T;
  readonly workspaceValue?: T;
  readonly workspaceFolderValue?: T;
  readonly memoryValue?: T;
  readonly value?: T;
}

export interface ConfigurationModelData {
  readonly contents: Record<string, unknown>;
  readonly keys: readonly string[];
}

export interface ConfigurationData {
  readonly defaults: ConfigurationModelData;
  readonly userLocal: ConfigurationModelData;
  readonly memory: ConfigurationModelData;
}

export interface ConfigurationService {
  readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
  getConfigurationData(): ConfigurationData | null;
  getValue<T>(): T;
  getValue<T>(section: string): T;
  getValue<T>(overrides: ConfigurationOverrides): T;
  getValue<T>(section: string, overrides: ConfigurationOverrides): T;
  updateValue(key: string, value: unknown): Promise<void>;
  updateValue(
    key: string,
    value: unknown,
    target: ConfigurationTarget,
  ): Promise<void>;
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
  inspect<T>(key: string, overrides?: ConfigurationOverrides): ConfigurationValue<Readonly<T>>;
  reloadConfiguration(target?: ConfigurationTarget): Promise<void>;
  keys(): {
    default: string[];
    user: string[];
    workspace: string[];
    workspaceFolder: string[];
    memory?: string[];
  };
}

export interface AppConfigurationService extends ConfigurationService {
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings?: Partial<StoredAppSettings>): Promise<AppSettings>;
}

export type AppSettingsConfigurationService = Pick<
  AppConfigurationService,
  'loadSettings' | 'saveSettings'
>;

export function isConfigurationOverrides(value: unknown): value is ConfigurationOverrides {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as ConfigurationOverrides;
  return (
    (candidate.overrideIdentifier === undefined ||
      candidate.overrideIdentifier === null ||
      typeof candidate.overrideIdentifier === 'string') &&
    (candidate.resource === undefined ||
      candidate.resource === null ||
      typeof candidate.resource === 'string')
  );
}

export function isConfigurationUpdateOverrides(
  value: unknown,
): value is ConfigurationUpdateOverrides {
  if (!isConfigurationOverrides(value)) {
    return false;
  }

  const candidate = value as ConfigurationUpdateOverrides;
  const record = value as Record<string, unknown>;
  return (
    record.overrideIdentifier === undefined &&
    (candidate.overrideIdentifiers === undefined ||
      candidate.overrideIdentifiers === null ||
      Array.isArray(candidate.overrideIdentifiers))
  );
}

export function getConfigValueInTarget<T>(
  configValue: ConfigurationValue<T>,
  target: ConfigurationTarget,
): T | undefined {
  switch (target) {
    case ConfigurationTarget.APPLICATION:
      return configValue.applicationValue;
    case ConfigurationTarget.USER:
      return configValue.userValue;
    case ConfigurationTarget.USER_LOCAL:
      return configValue.userLocalValue;
    case ConfigurationTarget.USER_REMOTE:
      return configValue.userRemoteValue;
    case ConfigurationTarget.WORKSPACE:
      return configValue.workspaceValue;
    case ConfigurationTarget.WORKSPACE_FOLDER:
      return configValue.workspaceFolderValue;
    case ConfigurationTarget.DEFAULT:
      return configValue.defaultValue;
    case ConfigurationTarget.MEMORY:
      return configValue.memoryValue;
  }
}
