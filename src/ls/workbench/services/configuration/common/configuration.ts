import { createDecorator } from 'ls/platform/instantiation/common/instantiation';
import type { IDisposable } from 'ls/base/common/lifecycle';
import type { ConfigurationService } from 'ls/platform/configuration/common/configuration';

export const IWorkbenchConfigurationService =
  createDecorator<IWorkbenchConfigurationService>(
    'workbenchConfigurationService',
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
} from 'ls/platform/configuration/common/configuration';
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
} from 'ls/platform/configuration/common/configuration';
