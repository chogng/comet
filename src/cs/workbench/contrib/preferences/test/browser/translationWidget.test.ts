/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import type { TranslationSettingsSectionProps } from 'cs/workbench/contrib/preferences/browser/translationWidget';
import { createDefaultLlmSettings } from 'cs/workbench/services/llm/config';
import { createDefaultTranslationSettings } from 'cs/workbench/services/translation/config';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';
import { getHoverService } from 'cs/platform/hover/browser/hoverService';
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
  }), getHoverService());

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
	widget.dispose();
});

test('TranslationSettingsSection disposes controls replaced by setProps and final disposal', () => {
	const baseUrlChanges: string[] = [];
	const props = createTranslationWidgetProps({
		onTranslationProviderBaseUrlChange: (_provider, value) => {
			baseUrlChanges.push(value);
		},
	});
	const widget = new TranslationSettingsSection(props, getHoverService());
	const oldInput = widget.getElement().querySelector<HTMLInputElement>(
		'[data-focus-key="settings.translation.custom.baseUrl"]',
	);
	assert(oldInput);

	widget.setProps({ ...props, isSettingsSaving: true });
	assert.equal(widget.getElement().contains(oldInput), false);
	oldInput.value = 'https://stale.example.com';
	oldInput.dispatchEvent(new Event('input', { bubbles: true }));
	assert.deepEqual(baseUrlChanges, []);

	const currentInput = widget.getElement().querySelector<HTMLInputElement>(
		'[data-focus-key="settings.translation.custom.baseUrl"]',
	);
	assert(currentInput);
	currentInput.value = 'https://current.example.com';
	currentInput.dispatchEvent(new Event('input', { bubbles: true }));
	assert.deepEqual(baseUrlChanges, ['https://current.example.com']);

	widget.dispose();
	currentInput.value = 'https://disposed.example.com';
	currentInput.dispatchEvent(new Event('input', { bubbles: true }));
	assert.deepEqual(baseUrlChanges, ['https://current.example.com']);
});
