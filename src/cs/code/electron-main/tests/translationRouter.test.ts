/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	DocumentTranslationProgress,
	LlmSettings,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { StorageService } from 'cs/platform/storage/common/storage';
import { createDefaultTranslationSettings } from 'cs/workbench/services/translation/config';
import { translateTextsToChinese } from 'cs/code/electron-main/translation/translationRouter';

const emptyLlmProviderSettings = {
	apiKey: '',
	baseUrl: '',
	selectedModelOption: '',
};

const llmSettings: LlmSettings = {
	activeProvider: 'openai',
	providers: {
		glm: emptyLlmProviderSettings,
		kimi: emptyLlmProviderSettings,
		deepseek: emptyLlmProviderSettings,
		anthropic: emptyLlmProviderSettings,
		openai: emptyLlmProviderSettings,
		gemini: emptyLlmProviderSettings,
		custom: emptyLlmProviderSettings,
	},
};

test('translation progress reports failures and rethrows translation errors', async () => {
	const translationSettings = createDefaultTranslationSettings();
	translationSettings.providers.deepl.apiKey = 'test-key';
	const progressUpdates: DocumentTranslationProgress[] = [];
	const storage = {
		async loadTranslationCache() {
			throw new Error('cache unavailable');
		},
		async saveTranslationCache() {
			throw new Error('save should not run');
		},
	} as Pick<StorageService, 'loadTranslationCache' | 'saveTranslationCache'>;

	await assert.rejects(
		translateTextsToChinese(
			['Example source text'],
			llmSettings,
			translationSettings,
			storage as StorageService,
			progress => progressUpdates.push(progress),
		),
		/cache unavailable/,
	);

	assert.deepEqual(progressUpdates, [{
		phase: 'failed',
		current: 0,
		total: 0,
		provider: 'translation:deepl',
		model: 'translate-to-zh-hans',
		message: 'cache unavailable',
	}]);
});
