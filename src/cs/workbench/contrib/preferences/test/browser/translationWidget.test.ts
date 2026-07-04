/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import type { TranslationWidgetProps } from 'cs/workbench/contrib/preferences/browser/translationWidget';
import { createDefaultLlmSettings } from 'cs/workbench/services/llm/config';
import { createDefaultTranslationSettings } from 'cs/workbench/services/translation/config';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { locales } from 'language/locales';

let cleanupDomEnvironment: (() => void) | null = null;
let TranslationWidget: typeof import('cs/workbench/contrib/preferences/browser/translationWidget').TranslationWidget;
let createSettingsPartLabels: typeof import('cs/workbench/contrib/preferences/browser/settingsEditor').createSettingsPartLabels;

test.before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ TranslationWidget } = await import('cs/workbench/contrib/preferences/browser/translationWidget'));
  ({ createSettingsPartLabels } = await import('cs/workbench/contrib/preferences/browser/settingsEditor'));
});

test.after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createTranslationWidgetProps(
  overrides: Partial<TranslationWidgetProps> = {},
): TranslationWidgetProps {
  return {
    labels: createSettingsPartLabels({ ui: locales.en }),
    activeTranslationProvider: 'custom',
    translationProviders: createDefaultTranslationSettings().providers,
    llmProviders: {
      glm: createDefaultLlmSettings().providers.glm,
    },
    isSettingsSaving: false,
    isTestingTranslationConnection: false,
    isLoadingTranslationModels: false,
    showApiKey: false,
    onToggleShowApiKey: () => {},
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

test('TranslationWidget renders fetched custom models as select options', () => {
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

  const widget = new TranslationWidget(createTranslationWidgetProps({
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
