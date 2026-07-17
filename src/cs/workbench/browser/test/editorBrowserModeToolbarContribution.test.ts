/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, afterEach, beforeEach } from 'node:test';
import { Emitter, Event } from 'cs/base/common/event';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';
import { commandsRegistry } from 'cs/platform/commands/common/commands';
import { IContextMenuService } from 'cs/platform/contextview/browser/contextView';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { INativeHostService } from 'cs/platform/native/common/native';
import { INotificationService } from 'cs/platform/notification/common/notification';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BrowserEditor,
	type BrowserEditorModelDetachReason,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { BrowserModeToolbar } from 'cs/workbench/contrib/browserView/electron-browser/browserModeToolbar';
import { BrowserFavoritesFeature } from 'cs/workbench/contrib/browserView/electron-browser/features/browserFavoritesFeature';
import { BrowserHistoryFeature } from 'cs/workbench/contrib/browserView/electron-browser/features/browserHistoryFeature';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import { ILibraryModel } from 'cs/workbench/services/knowledgeBase/libraryModel';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ISettingsModel } from 'cs/workbench/services/settings/settingsModel';
import { createEditorPdfModeToolbarContribution } from 'cs/workbench/contrib/pdfEditor/browser/pdfEditorToolbar';
import { locales } from 'language/locales';

const domEnvironment = installDomTestEnvironment();
let dropdownServices: Awaited<ReturnType<typeof createDropdownTestServices>>;

beforeEach(async () => {
	document.body.replaceChildren();
	dropdownServices = await createDropdownTestServices();
});

afterEach(() => {
	dropdownServices.dispose();
});

after(() => {
	domEnvironment.cleanup();
});

type TestBrowserModel = {
	readonly model: IBrowserViewModel;
	setNavigationState(url: string, canGoBack: boolean, canGoForward: boolean): void;
	dispose(): void;
};

type TestBrowserEditor = {
	readonly editor: BrowserEditor;
	readonly model: TestBrowserModel;
	readonly historyClearCount: number;
	readonly navigations: readonly string[];
	attach(): void;
	switchModel(model: TestBrowserModel): void;
	dispose(): void;
};

function createTestBrowserModel(
	initialUrl: string,
	initialCanGoBack: boolean,
	initialCanGoForward: boolean,
): TestBrowserModel {
	let url = initialUrl;
	let canGoBack = initialCanGoBack;
	let canGoForward = initialCanGoForward;
	const navigateEmitter = new Emitter<never>();
	const loadingEmitter = new Emitter<never>();
	const titleEmitter = new Emitter<never>();
	const faviconEmitter = new Emitter<never>();
	const model = {
		get url() { return url; },
		get canGoBack() { return canGoBack; },
		get canGoForward() { return canGoForward; },
		title: 'Article',
		favicon: undefined,
		loading: false,
		onDidNavigate: navigateEmitter.event,
		onDidChangeLoadingState: loadingEmitter.event,
		onDidChangeTitle: titleEmitter.event,
		onDidChangeFavicon: faviconEmitter.event,
	} as unknown as IBrowserViewModel;
	return {
		model,
		setNavigationState(nextUrl, nextCanGoBack, nextCanGoForward) {
			url = nextUrl;
			canGoBack = nextCanGoBack;
			canGoForward = nextCanGoForward;
			navigateEmitter.fire(undefined as never);
		},
		dispose() {
			navigateEmitter.dispose();
			loadingEmitter.dispose();
			titleEmitter.dispose();
			faviconEmitter.dispose();
		},
	};
}

function createTestBrowserEditor(
	id: string,
	url: string,
	canGoBack: boolean,
	canGoForward: boolean,
): TestBrowserEditor {
	const model = createTestBrowserModel(url, canGoBack, canGoForward);
	let historyClearCount = 0;
	const navigations: string[] = [];
	const modelChangeEmitter = new Emitter<{
		model: IBrowserViewModel | undefined;
		isNew: boolean;
		detachReason: BrowserEditorModelDetachReason;
	}>();
	const history = {
		onDidChange: Event.None,
		entries: [],
		getFavicon: () => '',
		removeEntry: () => false,
		clear() { historyClearCount += 1; },
	};
	const favorites = {
		onDidChange: Event.None,
		favorites: [],
		isFavorite: () => false,
		toggle() {},
		remove() {},
	};
	const root = document.createElement('div');
	root.className = 'browser-root';
	const editor = Object.create(BrowserEditor.prototype) as BrowserEditor;
	Object.defineProperties(editor, {
		input: { value: { id } },
		model: { value: model.model, configurable: true },
		onDidChangeModel: { value: modelChangeEmitter.event },
		getElement: { value: () => root },
		navigate: { value: async (value: string) => { navigations.push(value); } },
		getContribution: {
			value: (ctor: unknown) => {
				if (ctor === BrowserHistoryFeature) {
					return history;
				}
				if (ctor === BrowserFavoritesFeature) {
					return favorites;
				}
				return undefined;
			},
		},
	});

	return {
		editor,
		model,
		get historyClearCount() { return historyClearCount; },
		navigations,
		attach() {
			modelChangeEmitter.fire({
				model: model.model,
				isNew: true,
				detachReason: 'modelChanged',
			});
		},
		switchModel(nextModel) {
			Object.defineProperty(editor, 'model', {
				value: nextModel.model,
				configurable: true,
			});
			modelChangeEmitter.fire({
				model: nextModel.model,
				isNew: false,
				detachReason: 'modelChanged',
			});
		},
		dispose() {
			modelChangeEmitter.dispose();
			model.dispose();
		},
	};
}

function createToolbar(
	target: TestBrowserEditor,
	activeEditorPane: BrowserEditor,
	attachTarget = true,
) {
	const commands: Array<{ readonly id: string; readonly candidate: unknown }> = [];
	const editorService = { activeEditorPane } as never;
	const instantiationService = new InstantiationService(new ServiceCollection(
		[IEditorService, editorService],
		[IContextMenuService, dropdownServices.contextMenuService],
	), true);
	const toolbar = new BrowserModeToolbar(
		target.editor,
		instantiationService,
		dropdownServices.contextMenuService,
		dropdownServices.contextViewProvider,
		{
			executeCommand: async (id: string, candidate: unknown) => {
				commands.push({ id, candidate });
			},
		} as never,
		{ canInvoke: () => true } as never,
		{ getLocale: () => 'en', subscribe: () => () => {} } as never,
		{ getLocaleMessages: () => locales.en } as never,
	);
	if (attachTarget) {
		target.attach();
	}
	toolbar.onContainerCreated();
	document.body.append(toolbar.getEditorToolbarElement());
	return { toolbar, commands };
}

test('Browser toolbar actions keep their originating editor when the global editor differs', () => {
	const target = createTestBrowserEditor('browser-a', 'https://a.example/article', true, false);
	const globalActive = createTestBrowserEditor('browser-b', 'https://b.example', false, true);
	const { toolbar, commands } = createToolbar(target, globalActive.editor);
	try {
		const back = toolbar.getEditorToolbarElement().querySelector('[aria-label="Back"]');
		assert(back instanceof HTMLButtonElement);
		assert.equal(back.disabled, false);
		back.click();
		assert.deepEqual(commands, [{
			id: BrowserViewCommandId.GoBack,
			candidate: target.editor,
		}]);
	} finally {
		toolbar.dispose();
		target.dispose();
		globalActive.dispose();
	}
});

test('Browser toolbar updates addressed navigation state without closing More', () => {
	const target = createTestBrowserEditor('browser-a', 'https://a.example/article', true, false);
	const { toolbar } = createToolbar(target, target.editor);
	try {
		const more = toolbar.getEditorToolbarElement().querySelector('[aria-label="More"]');
		assert(more instanceof HTMLButtonElement);
		more.click();
		assert.equal(more.getAttribute('aria-expanded'), 'true');

		target.model.setNavigationState('https://a.example/next', false, true);
		const back = toolbar.getEditorToolbarElement().querySelector('[aria-label="Back"]');
		const forward = toolbar.getEditorToolbarElement().querySelector('[aria-label="Forward"]');
		assert(back instanceof HTMLButtonElement);
		assert(forward instanceof HTMLButtonElement);
		assert.equal(back.disabled, true);
		assert.equal(forward.disabled, false);
		assert.equal(toolbar.getEditorToolbarElement().querySelector('[aria-label="More"]'), more);
		assert.equal(more.getAttribute('aria-expanded'), 'true');
	} finally {
		toolbar.dispose();
		target.dispose();
	}
});

test('Browser toolbar ignores detached model events after an input switch', () => {
	const target = createTestBrowserEditor('browser-a', 'https://a.example/old', false, false);
	const nextModel = createTestBrowserModel('https://a.example/new', false, false);
	const { toolbar } = createToolbar(target, target.editor);
	try {
		const more = toolbar.getEditorToolbarElement().querySelector('[aria-label="More"]');
		assert(more instanceof HTMLButtonElement);
		more.click();
		assert.equal(more.getAttribute('aria-expanded'), 'true');
		const editedAddress = toolbar.getEditorToolbarElement().querySelector('[aria-label="Address bar"]');
		assert(editedAddress instanceof HTMLInputElement);
		editedAddress.focus();
		editedAddress.value = 'https://a.example/stale-draft';
		editedAddress.dispatchEvent(new window.Event('input', { bubbles: true }));

		target.switchModel(nextModel);
		const address = toolbar.getEditorToolbarElement().querySelector('[aria-label="Address bar"]');
		assert(address instanceof HTMLInputElement);
		assert.equal(address.value, 'https://a.example/new');
		assert.equal(more.getAttribute('aria-expanded'), 'false');

		target.model.setNavigationState('https://a.example/stale', true, true);
		assert.equal(address.value, 'https://a.example/new');
		address.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.deepEqual(target.navigations, ['https://a.example/new']);
	} finally {
		toolbar.dispose();
		target.dispose();
		nextModel.dispose();
	}
});

test('Browser toolbar clears a focused draft when a pending input identity changes', () => {
	const target = createTestBrowserEditor('browser-a', 'https://a.example/pending', false, false);
	const nextModel = createTestBrowserModel('https://b.example/ready', false, false);
	const { toolbar } = createToolbar(target, target.editor, false);
	try {
		toolbar.prerenderInput({ id: 'browser-a' } as never);
		const address = toolbar.getEditorToolbarElement().querySelector('[aria-label="Address bar"]');
		assert(address instanceof HTMLInputElement);
		address.focus();
		address.value = 'https://a.example/stale-draft';
		address.dispatchEvent(new window.Event('input', { bubbles: true }));

		toolbar.prerenderInput({ id: 'browser-b' } as never);
		target.switchModel(nextModel);
		assert.equal(address.value, 'https://b.example/ready');
		address.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.deepEqual(target.navigations, ['https://b.example/ready']);
	} finally {
		toolbar.dispose();
		target.dispose();
		nextModel.dispose();
	}
});

test('Browser toolbar closes its Sources panel when the owning pane hides', () => {
	const target = createTestBrowserEditor('browser-a', 'https://a.example', false, false);
	const { toolbar } = createToolbar(target, target.editor);
	try {
		const sources = toolbar.getEditorToolbarElement().querySelector('[aria-label="Source menu"]');
		assert(sources instanceof HTMLButtonElement);
		sources.click();
		const openedSources = toolbar.getEditorToolbarElement().querySelector('[aria-label="Source menu"]');
		assert(openedSources instanceof HTMLButtonElement);
		assert.equal(openedSources.getAttribute('aria-expanded'), 'true');
		const more = toolbar.getEditorToolbarElement().querySelector('[aria-label="More"]');
		assert(more instanceof HTMLButtonElement);
		more.click();
		assert.equal(more.getAttribute('aria-expanded'), 'true');

		toolbar.onPaneVisibilityChanged(false);
		const closedSources = toolbar.getEditorToolbarElement().querySelector('[aria-label="Source menu"]');
		assert(closedSources instanceof HTMLButtonElement);
		assert.equal(closedSources.getAttribute('aria-expanded'), 'false');
		assert.equal(more.getAttribute('aria-expanded'), 'false');
	} finally {
		toolbar.dispose();
		target.dispose();
	}
});

test('Browser archive action snapshots the explicit Browser editor target', async () => {
	await import('cs/workbench/contrib/browserView/electron-browser/features/browserToolbarActions');
	const target = createTestBrowserEditor(
		'browser-a',
		'https://a.example/article?issue=7#/document/2!',
		false,
		false,
	);
	const globalActive = createTestBrowserEditor('browser-b', 'https://b.example', false, false);
	const invocations: Array<{ readonly command: string; readonly payload: unknown }> = [];
	const notifications: string[] = [];
	const services = new Map<unknown, unknown>([
		[IEditorService, { activeEditorPane: globalActive.editor }],
		[INativeHostService, {
			canInvoke: () => true,
			invoke: async (command: string, payload: unknown) => {
				invocations.push({ command, payload });
				return {
					filePath: '/tmp/archive',
					htmlPath: '/tmp/archive/page.html',
					textPath: '/tmp/archive/page.txt',
					pdfPath: null,
					title: 'Article',
					sourceUrl: 'https://a.example/article',
					pdfSourceUrl: null,
					extractedText: 'Article',
				};
			},
		}],
		[INotificationService, { info: (message: string) => notifications.push(message), error: () => {} }],
		[ISettingsModel, { getSnapshot: () => ({ knowledgeBaseEnabled: false }) }],
		[ILibraryModel, { refresh: async () => {} }],
		[IWorkbenchLocaleService, { getLocale: () => 'en' }],
		[IWorkbenchLanguageService, { getLocaleMessages: () => locales.en }],
	]);
	const accessor = {
		get: (id: unknown) => services.get(id),
	} as ServicesAccessor;
	const command = commandsRegistry.getCommand(BrowserViewCommandId.ArchivePage);
	assert(command);

	try {
		await command.handler(accessor, target.editor);
		assert.deepEqual(invocations, [{
			command: 'web_content_archive_html',
			payload: {
				browserViewId: 'browser-a',
				pageUrl: 'https://a.example/article?issue=7#/document/2!',
			},
		}]);
		assert.equal(notifications.length, 1);
	} finally {
		target.dispose();
		globalActive.dispose();
	}
});

test('Browser toolbar semantic actions use the explicit target and desktop gate', async () => {
	await import('cs/workbench/contrib/browserView/electron-browser/features/browserToolbarActions');
	const target = createTestBrowserEditor('browser-a', 'https://a.example/action', false, false);
	const nativeInvocations: string[] = [];
	const copiedValues: string[] = [];
	const infoMessages: string[] = [];
	const errorMessages: string[] = [];
	const nativeHostService = {
		canInvoke: () => true,
		invoke: async (command: string) => {
			nativeInvocations.push(command);
			return true;
		},
	};
	const services = new Map<unknown, unknown>([
		[INativeHostService, nativeHostService],
		[INotificationService, {
			info: (message: string) => infoMessages.push(message),
			error: (message: string) => errorMessages.push(message),
		}],
		[IWorkbenchLocaleService, { getLocale: () => 'en' }],
		[IWorkbenchLanguageService, { getLocaleMessages: () => locales.en }],
	]);
	const accessor = { get: (id: unknown) => services.get(id) } as ServicesAccessor;
	const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText: async (value: string) => { copiedValues.push(value); } },
	});

	try {
		for (const commandId of [
			BrowserViewCommandId.CopyCurrentUrl,
			BrowserViewCommandId.ClearBrowsingHistory,
			BrowserViewCommandId.ClearCookies,
			BrowserViewCommandId.ClearCache,
		]) {
			const command = commandsRegistry.getCommand(commandId);
			assert(command);
			await command.handler(accessor, target.editor);
		}

		assert.deepEqual(copiedValues, ['https://a.example/action']);
		assert.equal(target.historyClearCount, 1);
		assert.deepEqual(nativeInvocations, ['clear_web_cookies', 'clear_web_cache']);
		assert.equal(infoMessages.length, 4);
		assert.deepEqual(errorMessages, []);
		const pendingEditor = Object.create(BrowserEditor.prototype) as BrowserEditor;
		const clearCookies = commandsRegistry.getCommand(BrowserViewCommandId.ClearCookies);
		assert(clearCookies);
		await clearCookies.handler(accessor, pendingEditor);
		assert.deepEqual(nativeInvocations, [
			'clear_web_cookies',
			'clear_web_cache',
			'clear_web_cookies',
		]);

		services.set(INativeHostService, {
			canInvoke: () => false,
			invoke: async () => { throw new Error('Unexpected native invocation.'); },
		});
		await clearCookies.handler(accessor, target.editor);
		assert.deepEqual(nativeInvocations, [
			'clear_web_cookies',
			'clear_web_cache',
			'clear_web_cookies',
		]);
		assert.equal(errorMessages.length, 1);
	} finally {
		if (clipboardDescriptor) {
			Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
		} else {
			Reflect.deleteProperty(navigator, 'clipboard');
		}
		target.dispose();
	}
});

test('PDF Sources action is disabled without the desktop Browser runtime', () => {
	const toolbar = createEditorPdfModeToolbarContribution({
		labels: {
			toolbarSources: 'Sources',
			toolbarMore: 'More',
			pdfTitle: 'PDF',
		},
		sourcesDisabled: true,
		onOpenSources: () => { throw new Error('Disabled Sources action ran.'); },
		onHighlightSelection: () => {},
		onNoteSelection: () => {},
	}, dropdownServices);
	try {
		const sources = toolbar.getElement().querySelector('[aria-label="Sources"]');
		assert(sources instanceof HTMLButtonElement);
		assert.equal(sources.disabled, true);
	} finally {
		toolbar.dispose();
	}
});
