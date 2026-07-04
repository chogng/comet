import { ConfigurationService } from 'cs/platform/configuration/common/configurationService';
import {
  InstantiationType,
  registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import { IWorkbenchConfigurationService } from 'cs/workbench/services/configuration/common/configuration';

export class BrowserWorkbenchConfigurationService
  extends ConfigurationService
  implements IWorkbenchConfigurationService
{
  declare readonly _serviceBrand: undefined;
}

export function createWorkbenchConfigurationService(): IWorkbenchConfigurationService {
  return new BrowserWorkbenchConfigurationService();
}

registerSingleton(
  IWorkbenchConfigurationService,
  BrowserWorkbenchConfigurationService,
  InstantiationType.Delayed,
);

export { ConfigurationService };
export {
  IWorkbenchConfigurationService,
} from 'cs/workbench/services/configuration/common/configuration';
export type {
  ConfigurationChangeEvent,
  ConfigurationData,
  ConfigurationOverrides,
  ConfigurationUpdateOverrides,
  ConfigurationValue,
} from 'cs/workbench/services/configuration/common/configuration';
