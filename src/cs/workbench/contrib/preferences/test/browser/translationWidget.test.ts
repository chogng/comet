/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import type { TranslationSettingsSectionProps } from 'cs/workbench/contrib/preferences/browser/translationWidget';
import { createDefaultLlmSettings } from 'cs/workbench/services/llm/config';
import { createDefaultTranslationSettings } from 'cs/workbench/services/translation/config';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { locales } from 'language/locales';

let cleanupDomEnvironment: (() => void) | null = null;
let TranslationSettingsSection: typeof import('cs/workbench/contrib/preferences/browser/translationWidget').TranslationSettingsSection;

test.before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ TranslationSettingsSection } = await import('cs/workbench/contrib/preferences/browser/translationWidget'));
});

test.after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createTranslationWidgetProps(
  overrides: Partial<TranslationSettingsSectionProps> = {},
): TranslationSettingsSectionProps {
  return {
	labels: locales.en,
    contextViewProvider: {
      showContextView: () => {},
      hideContextView: () => {},
      layout: () => {},
    },
    activeTranslationProvider: 'custom',
    translationProviders: createDefaultTranslationSettings().providers,
    llmProviders: {
      glm: createDefaultLlmSettings().providers.glm,
    },
    isSettingsSaving: false,
    isTestingTranslationConnection: false,
    isLoadingTranslationModels: false,
    onActiveTranslationProviderChange: () => {},
    onTranslationProviderApiKeyChange: () => {},
    onTranslationProviderBaseUrlChange: () => {},
    onTranslationProviderModelChange: () => {},
    onGlmModelChange: () => {},
    onFetchTranslationModels: () => {},
    onTestTranslationConnection: () => {},
    ...overrides,
  };
}

test('TranslationSettingsSection renders fetched custom models as select options', () => {
  const translationProviders = createDefaultTranslationSettings().providers;
  translationProviders.custom = {
    ...translationProviders.custom,
    model: 'step-3.7-flash',
    models: [
      'step-3.7-flash',
      'step-3.7',
      'step-2-16k',
    ],
  };

  const widget = new TranslationSettingsSection(createTranslationWidgetProps({
    translationProviders,
  }));

  const modelSelect = widget
    .getElement()
    .querySelector<HTMLSelectElement>('[data-focus-key="settings.translation.custom.model"]');

  assert(modelSelect);
  assert.deepEqual(
    Array.from(modelSelect.options).map((option) => option.value),
    ['step-3.7-flash', 'step-3.7', 'step-2-16k'],
  );
  assert.equal(modelSelect.value, 'step-3.7-flash');
  assert.equal(widget.getElement().querySelector('datalist'), null);
});
