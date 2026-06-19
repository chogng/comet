import { createDecorator } from 'ls/platform/instantiation/common/instantiation';
import type {
  ILocaleService,
} from 'ls/workbench/contrib/localization/common/locale';

export const IWorkbenchLocaleService =
  createDecorator<IWorkbenchLocaleService>('workbenchLocaleService');

export interface IWorkbenchLocaleService extends ILocaleService {
  readonly _serviceBrand: undefined;
}

export type {
  ILocaleService,
  LocaleServiceContext,
} from 'ls/workbench/contrib/localization/common/locale';
