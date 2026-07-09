import type { IDisposable } from 'cs/base/common/lifecycle';
import {
  IConfigurationService,
  type ConfigurationService,
} from 'cs/platform/configuration/common/configuration';
import { refineServiceDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IWorkbenchConfigurationService =
  refineServiceDecorator<ConfigurationService, IWorkbenchConfigurationService>(
    IConfigurationService,
  );

export interface IWorkbenchConfigurationService
  extends ConfigurationService, IDisposable {
  readonly _serviceBrand: undefined;
}

export {
  ConfigurationTarget,
  ConfigurationTargetToString,
  getConfigValueInTarget,
  isConfigurationOverrides,
  isConfigurationUpdateOverrides,
} from 'cs/platform/configuration/common/configuration';
export type {
  AppConfigurationService,
  AppSettingsConfigurationService,
  ConfigurationChange,
  ConfigurationChangeEvent,
  ConfigurationData,
  ConfigurationModelData,
  ConfigurationOverrides,
  ConfigurationService,
  ConfigurationUpdateOverrides,
  ConfigurationValue,
} from 'cs/platform/configuration/common/configuration';
