import {
  localeService,
} from 'ls/workbench/contrib/localization/browser/localeService';
import type {
  IWorkbenchLocaleService,
} from 'ls/workbench/services/localization/common/locale';

class WorkbenchLocaleServiceAdapter implements IWorkbenchLocaleService {
  declare readonly _serviceBrand: undefined;

  constructor(private readonly delegate: typeof localeService) {}

  subscribe(listener: () => void) {
    return this.delegate.subscribe(listener);
  }

  getLocale() {
    return this.delegate.getLocale();
  }

  applyLocale(locale: ReturnType<typeof localeService.getLocale>) {
    this.delegate.applyLocale(locale);
  }

  updateLocalePreference(
    locale: ReturnType<typeof localeService.getLocale>,
    context: Parameters<typeof localeService.updateLocalePreference>[1],
  ) {
    return this.delegate.updateLocalePreference(locale, context);
  }

  syncDocumentLanguage() {
    this.delegate.syncDocumentLanguage();
  }

  initialize(context: Parameters<typeof localeService.initialize>[0]) {
    return this.delegate.initialize(context);
  }
}

export function createWorkbenchLocaleService(): IWorkbenchLocaleService {
  return new WorkbenchLocaleServiceAdapter(localeService);
}

export {
  IWorkbenchLocaleService,
} from 'ls/workbench/services/localization/common/locale';
export { localeService };
export type {
  ILocaleService,
  LocaleServiceContext,
} from 'ls/workbench/services/localization/common/locale';
