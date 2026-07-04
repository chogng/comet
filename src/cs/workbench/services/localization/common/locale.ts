import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type {
  LanguagePackLocale,
} from 'cs/platform/languagePacks/common/languagePacks';

export const IWorkbenchLocaleService =
  createDecorator<IWorkbenchLocaleService>('workbenchLocaleService');

export type LocaleServiceContext = {
  desktopRuntime: boolean;
  invokeDesktop: ElectronInvoke;
};

export interface IWorkbenchLocaleService {
  readonly _serviceBrand: undefined;
  subscribe(listener: () => void): () => void;
  getLocale(): LanguagePackLocale;
  applyLocale(locale: LanguagePackLocale): void;
  updateLocalePreference(
    locale: LanguagePackLocale,
    context: LocaleServiceContext,
  ): Promise<void>;
  syncDocumentLanguage(): void;
  initialize(context: LocaleServiceContext): Promise<LanguagePackLocale>;
}

export type {
  LanguagePackLocale,
} from 'cs/platform/languagePacks/common/languagePacks';
