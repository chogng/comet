import { ConfigurationService } from 'ls/platform/configuration/common/configurationService';
import type { IWorkbenchConfigurationService } from 'ls/workbench/services/configuration/common/configuration';

export class BrowserWorkbenchConfigurationService
  extends ConfigurationService
  implements IWorkbenchConfigurationService
{
  declare readonly _serviceBrand: undefined;
}

export function createWorkbenchConfigurationService(): IWorkbenchConfigurationService {
  return new BrowserWorkbenchConfigurationService();
}

export { ConfigurationService };
export {
  IWorkbenchConfigurationService,
} from 'ls/workbench/services/configuration/common/configuration';
export type {
  ConfigurationChangeEvent,
  ConfigurationData,
  ConfigurationOverrides,
  ConfigurationUpdateOverrides,
  ConfigurationValue,
} from 'ls/workbench/services/configuration/common/configuration';
