/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { EventEmitter } from 'cs/base/common/event';
import { URI } from 'cs/base/common/uri';
import type { ElectronInvoke } from 'cs/base/parts/sandbox/common/electronTypes';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import { EditorDraftStyleService } from 'cs/editor/browser/text/editorDraftStyleService';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import { getWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';
import { SettingsController } from 'cs/workbench/contrib/preferences/browser/settingsController';
import { SettingsPartView } from 'cs/workbench/contrib/preferences/browser/settingsEditor';
import { FetchService } from 'cs/workbench/services/fetch/browser/fetchService';
import { FetchRegistry } from 'cs/workbench/services/fetch/common/fetchRegistry';
import { LibraryModel } from 'cs/workbench/services/knowledgeBase/libraryModel';
import { WorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import type {
	IWorkbenchLocaleService,
	LanguagePackLocale,
	LocaleServiceContext,
} from 'cs/workbench/services/localization/common/locale';
import { SettingsModel } from 'cs/workbench/services/settings/settingsModel';

class TestWorkbenchLocaleService implements IWorkbenchLocaleService {
	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeEmitter = new EventEmitter<void>();
	private locale: LanguagePackLocale = 'en';

	readonly subscribe = (listener: () => void) => this.onDidChangeEmitter.event(listener);

	getLocale() {
		return this.locale;
	}

	applyLocale(locale: LanguagePackLocale) {
		if (this.locale === locale) {
			return;
		}
		this.locale = locale;
		this.syncDocumentLanguage();
		this.onDidChangeEmitter.fire();
	}

	async updateLocalePreference(locale: LanguagePackLocale, _context: LocaleServiceContext) {
		this.applyLocale(locale);
	}

	syncDocumentLanguage() {
		document.documentElement.lang = this.locale;
	}

	async initialize(_context: LocaleServiceContext) {
		this.syncDocumentLanguage();
		return this.locale;
	}

	dispose() {
		this.onDidChangeEmitter.dispose();
	}
}

function createNativeHostService(): INativeHostService {
	return {
		_serviceBrand: undefined,
		canInvoke: () => false,
		invoke: (async (command: string) => {
			throw new Error(`Unexpected desktop command in SettingsPartView test: ${command}`);
		}) as ElectronInvoke,
		ipc: undefined,
		windowControls: undefined,
		webContent: undefined,
		document: undefined,
	};
}

test('SettingsPartView owns service state and preserves local search state across updates', async () => {
	const domEnvironment = installDomTestEnvironment();
	const dropdownServices = await createDropdownTestServices();
	const instantiationService = new InstantiationService(new ServiceCollection());
	const nativeHostService = createNativeHostService();
	const languageService = new WorkbenchLanguageService();
	const localeService = new TestWorkbenchLocaleService();
	const settingsModel = new SettingsModel();
	const editorDraftStyleService = new EditorDraftStyleService();
	const libraryModel = new LibraryModel(nativeHostService);
	const fetchRegistry = new FetchRegistry();
	const journalRegistration = fetchRegistry.registerJournal({
		id: 'test-journal',
		title: 'Test Journal',
		homeUrl: URI.parse('https://example.com/journal'),
		discoveryUrl: URI.parse('https://example.com/journal/discover'),
		providerId: 'test-provider',
	});
	const fetchService = new FetchService(fetchRegistry, instantiationService);
	const settingsController = new SettingsController(
		settingsModel,
		nativeHostService,
		new NoOpNotificationService(),
		localeService,
		languageService,
		editorDraftStyleService,
	);
	const view = new SettingsPartView(
		settingsModel,
		settingsController,
		libraryModel,
		fetchService,
		editorDraftStyleService,
		localeService,
		languageService,
		nativeHostService,
		dropdownServices.contextViewProvider,
	);

	try {
		const element = view.getElement();
		document.body.append(element);
		assert.equal(element.className, 'comet-settings-body');
		assert.equal(element.querySelectorAll('.comet-settings-navigation').length, 1);
		assert.equal(element.querySelectorAll('.comet-settings-page').length, 1);
		assert.equal(
			getWorkbenchPartDomNode(WORKBENCH_PART_IDS.settings),
			null,
		);

		const searchInput = element.querySelector<HTMLInputElement>('[data-focus-key="settings.search"]');
		assert(searchInput);
		assert.equal(
			searchInput.placeholder,
			languageService.getLocaleMessages('en').settingsSearchPlaceholder,
		);
		searchInput.value = 'theme';
		searchInput.focus();
		searchInput.setSelectionRange(1, 4);
		searchInput.dispatchEvent(new Event('input', { bubbles: true }));

		settingsModel.setUseMica(!settingsModel.getSnapshot().useMica);
		assert.equal(view.getElement(), element);
		assert.equal(
			element.querySelector('[data-focus-key="settings.search"]'),
			searchInput,
		);
		assert.equal(searchInput.value, 'theme');
		assert.equal(document.activeElement, searchInput);
		assert.deepEqual(
			[searchInput.selectionStart, searchInput.selectionEnd],
			[1, 4],
		);

		localeService.applyLocale('zh');
		assert.equal(
			searchInput.placeholder,
			languageService.getLocaleMessages('zh').settingsSearchPlaceholder,
		);
		assert.equal(searchInput.value, 'theme');
		assert.equal(document.activeElement, searchInput);

		localeService.applyLocale('en');
		searchInput.value = '';
		searchInput.dispatchEvent(new Event('input', { bubbles: true }));
		const generalNavigationButton = element.querySelector<HTMLButtonElement>('[data-page-target="general"]');
		assert(generalNavigationButton);
		generalNavigationButton.click();
		const statusbarInput = element.querySelector<HTMLInputElement>(
			'input[data-focus-key="settings.general.layout.statusbarVisible"]',
		);
		assert(statusbarInput);
		const previousStatusbarVisible = settingsModel.getSnapshot().statusbarVisible;
		statusbarInput.focus();
		statusbarInput.click();
		assert.equal(
			settingsModel.getSnapshot().statusbarVisible,
			!previousStatusbarVisible,
		);
		const updatedStatusbarInput = element.querySelector<HTMLInputElement>(
			'input[data-focus-key="settings.general.layout.statusbarVisible"]',
		);
		assert(updatedStatusbarInput);
		assert.notEqual(updatedStatusbarInput, statusbarInput);
		assert.equal(document.activeElement, updatedStatusbarInput);

		const literatureNavigationButton = element.querySelector<HTMLButtonElement>('[data-page-target="literature"]');
		assert(literatureNavigationButton);
		literatureNavigationButton.click();
		const supportedSourcesToggle = element.querySelector<HTMLButtonElement>(
			'button[data-focus-key="settings.supportedSources.toggle"]',
		);
		assert(supportedSourcesToggle);
		supportedSourcesToggle.focus();
		supportedSourcesToggle.click();
		const updatedSupportedSourcesToggle = element.querySelector<HTMLButtonElement>(
			'button[data-focus-key="settings.supportedSources.toggle"]',
		);
		assert(updatedSupportedSourcesToggle);
		assert.notEqual(updatedSupportedSourcesToggle, supportedSourcesToggle);
		assert.equal(document.activeElement, updatedSupportedSourcesToggle);
		assert.equal(
			element.querySelector<HTMLElement>('.comet-settings-supported-sources-table')?.hidden,
			false,
		);
	} finally {
		view.dispose();
		settingsController.dispose();
		fetchService.dispose();
		journalRegistration.dispose();
		libraryModel.dispose();
		editorDraftStyleService.dispose();
		localeService.dispose();
		instantiationService.dispose();
		dropdownServices.dispose();
		document.body.replaceChildren();
		domEnvironment.cleanup();
	}

	assert.equal(
		getWorkbenchPartDomNode(WORKBENCH_PART_IDS.settings),
		null,
	);
});
