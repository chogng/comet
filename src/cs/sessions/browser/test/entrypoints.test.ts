/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const Root = process.cwd();

function readSource(relativePath: string): string {
	return readFileSync(path.join(Root, relativePath), 'utf8');
}

function sourceFiles(root: string): readonly string[] {
	const files: string[] = [];
	for (const entry of readdirSync(root)) {
		const candidate = path.join(root, entry);
		const stat = statSync(candidate);
		if (stat.isDirectory()) {
			if (entry !== 'test' && entry !== 'tests') {
				files.push(...sourceFiles(candidate));
			}
			continue;
		}
		if (candidate.endsWith('.ts') && !candidate.endsWith('.test.ts')) {
			files.push(candidate);
		}
	}
	return files;
}

function count(source: string, pattern: RegExp): number {
	return source.match(pattern)?.length ?? 0;
}

test('browser and desktop bootstrap the Sessions application exactly once', () => {
	for (const target of ['browser', 'electron-browser'] as const) {
		const source = readSource(`src/cs/code/${target}/workbench.ts`);
		const expectedMain = target === 'browser'
			? 'cs/sessions/sessions.web.main'
			: 'cs/sessions/sessions.desktop.main';
		assert.ok(source.includes(`await import('${expectedMain}')`));
		assert.match(source, /cs\/sessions\/browser\/sessionsWorkbench/);
		assert.equal(count(source, /await startSessionsWorkbench\(\)/g), 1);
		assert.doesNotMatch(source, /startWorkbenchContributions|renderSessionsWorkbench/);
		assert.doesNotMatch(source, /cs\/workbench\/browser\/workbench/);
		assert.doesNotMatch(source, /renderWorkbench\(\)/);
		assert.doesNotMatch(source, /nativeOverlay|isNativeWorkbenchAuxiliaryWindow/);
		if (target === 'electron-browser') {
			assert.match(source, /initializeLocalAgentHostSessionsContribution/);
			assert.match(
				source,
				/sessions\/contrib\/providers\/agentHost\/electron-browser\/localAgentHost/,
			);
			assert.ok(
				source.indexOf("await import('cs/sessions/sessions.desktop.main')")
					< source.indexOf('await initializeLocalAgentHostSessionsContribution('),
				'Agent Host provider composition must follow desktop contribution registration',
			);
			assert.ok(
				source.indexOf('await initializeLocalAgentHostSessionsContribution(')
					< source.indexOf('await startSessionsWorkbench()'),
				'Agent Host provider composition must finish before Sessions starts',
			);
		}
	}

	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	assert.match(sessionsWorkbench, /@IStorageService private readonly storageService/);
	assert.ok(
		sessionsWorkbench.indexOf('await storageInitialization')
			< sessionsWorkbench.indexOf('startWorkbenchContributions()'),
		'Sessions storage must initialize before product contributions start',
	);
	assert.ok(
		sessionsWorkbench.indexOf('this._register(toDisposable(stopWorkbenchContributions))')
			< sessionsWorkbench.indexOf('startWorkbenchContributions()'),
		'Contribution cleanup ownership must exist before factories start',
	);
	assert.ok(
		sessionsWorkbench.indexOf('startWorkbenchContributions()')
			< sessionsWorkbench.indexOf('const host = this.createHost()'),
		'product contributions must start before the Sessions host renders',
	);
	assert.match(
		sessionsWorkbench,
		/await this\.storageService\.flush\(WillSaveStateReason\.SHUTDOWN\)/,
	);
	assert.doesNotMatch(sessionsWorkbench, /handleWorkbenchEditorShortcut|handleWindowKeydown/);
	assert.match(sessionsWorkbench, /class SessionsWorkbenchApplication extends Disposable/);
	assert.match(sessionsWorkbench, /this\._register\(toDisposable\(stopWorkbenchContributions\)\)/);
	assert.match(sessionsWorkbench, /addDisposableListener\(window, 'beforeunload'/);
	assert.match(sessionsWorkbench, /disposeSessionsWorkbench\(\): Promise<void>/);
	assert.match(sessionsWorkbench, /disposeWorkbenchInstantiationService\(\)/);
	assert.match(
		sessionsWorkbench,
		/if \(!this\.storageInitialized\) \{\s*await this\.storageInitializationSettled;\s*\}\s*const shutdownErrors/,
	);
	assert.match(
		sessionsWorkbench,
		/let application: SessionsWorkbenchApplication \| null = null;\s*try \{\s*application = getWorkbenchInstantiationService\(\)\.createInstance/,
	);
	assert.ok(
		count(sessionsWorkbench, /this\.ensureStartupActive\(\)/g) >= 6,
		'Sessions startup must recheck shutdown after callbacks that can re-enter lifecycle code',
	);
	assert.match(
		sessionsWorkbench,
		/sessionsWorkbenchState !== 'starting'\s*\|\| activeSessionsWorkbenchApplication !== application/,
	);
	assert.doesNotMatch(sessionsWorkbench, /activeSessionsWorkbenchHost|renderSessionsWorkbench/);
	assert.ok(
		sessionsWorkbench.lastIndexOf('await this.storageService.flush(WillSaveStateReason.SHUTDOWN)')
			< sessionsWorkbench.lastIndexOf('this.dispose()'),
		'Sessions state must finish saving before Host and product contributions stop',
	);
	assert.ok(
		sessionsWorkbench.lastIndexOf('super.dispose()')
			< sessionsWorkbench.lastIndexOf('disposeWorkbenchInstantiationService()'),
		'Host and product contributions must stop before DI services dispose',
	);
	assert.match(
		sessionsWorkbench,
		/try \{\s*super\.dispose\(\);\s*\} finally \{\s*registerWorkbenchPartDomNode\(WORKBENCH_PART_IDS\.container, null\)/,
	);
	assert.equal(
		existsSync(path.join(Root, 'src/cs/sessions/browser/sessions.contribution.ts')),
		false,
	);
	const commonMain = readSource('src/cs/sessions/sessions.common.main.ts');
	assert.doesNotMatch(commonMain, /['"]cs\/sessions\/browser\/sessions\.contribution['"]/);
	const workbenchContribution = readSource(
		'src/cs/workbench/contrib/workbench/workbench.contribution.ts',
	);
	assert.doesNotMatch(
		workbenchContribution,
		/createWorkbenchServicesLifecycleContribution|disposeWorkbenchInstantiationService/,
	);
});

test('Sessions target mains load their matching Workbench foundation before contributions', () => {
	for (const removedWorkbenchEntry of [
		'src/cs/workbench/browser/web.api.ts',
		'src/cs/workbench/browser/web.main.ts',
		'src/cs/workbench/electron-browser/desktop.contribution.ts',
		'src/cs/workbench/electron-browser/desktop.main.ts',
		'src/cs/workbench/electron-browser/windows.ts',
	]) {
		assert.equal(existsSync(path.join(Root, removedWorkbenchEntry)), false);
	}

	const common = readSource('src/cs/sessions/sessions.common.main.ts');
	const desktop = readSource('src/cs/sessions/sessions.desktop.main.ts');
	const web = readSource('src/cs/sessions/sessions.web.main.ts');
	const workbenchCommon = readSource('src/cs/workbench/workbench.common.main.ts');
	const workbenchDesktop = readSource('src/cs/workbench/workbench.desktop.main.ts');
	assert.ok(desktop.indexOf("'cs/workbench/workbench.desktop.main'") < desktop.indexOf("'cs/sessions/sessions.common.main'"));
	assert.ok(web.indexOf("'cs/workbench/workbench.web.main'") < web.indexOf("'cs/sessions/sessions.common.main'"));
	assert.match(common, /sessions\/services\/layout\/browser\/layoutService/);
	assert.doesNotMatch(common, /sessions\/contrib\/editor\/browser\/editorCommands\.contribution/);
	assert.match(workbenchCommon, /workbench\/contrib\/draftEditor\/browser\/draftEditor\.contribution/);
	assert.match(common, /sessions\/contrib\/sessions\/browser\/sessions\.contribution/);
	assert.match(desktop, /sessions\/contrib\/browserView\/electron-browser\/browserViewChat\.contribution/);
	assert.match(desktop, /workbench\/contrib\/files\/browser\/fileChatAttachments\.contribution/);
	assert.doesNotMatch(desktop, /providers\/default|defaultSessionsProvider/);
	assert.doesNotMatch(web, /providers\/default|defaultSessionsProvider/);
	assert.equal(count(desktop, /layout\.contribution/g), 1);
	assert.equal(count(web, /layout\.contribution/g), 1);
	assert.match(desktop, /sessions\/contrib\/splash\/browser\/partsSplash/);
	assert.doesNotMatch(workbenchCommon, /services\/layout|actions\/layoutActions/);
	assert.doesNotMatch(workbenchDesktop, /browserEditorChatFeatures|cs\/sessions/);
	assert.doesNotMatch(workbenchDesktop, /contrib\/splash\/browser\/partsSplash/);
	assert.equal(existsSync(path.join(Root, 'src/cs/code/electron-browser/agentHost.ts')), false);
	const localAgentHostContribution = readSource(
		'src/cs/sessions/contrib/providers/agentHost/electron-browser/localAgentHost.ts',
	);
	assert.match(localAgentHostContribution, /class LocalAgentHostSessionsContribution extends Disposable/);
	assert.match(localAgentHostContribution, /@IMainProcessService private readonly mainProcessService/);
	assert.match(localAgentHostContribution, /@IChatService private readonly chatService/);
	assert.match(localAgentHostContribution, /@ISessionsProvidersService private readonly sessionsProvidersService/);
	assert.doesNotMatch(localAgentHostContribution, /invokeFunction|accessor\.get/);
	assert.equal(existsSync(path.join(Root, 'src/cs/code/common/agentHostConfiguration.ts')), false);
	const clientAgentHostConfiguration = readSource('src/cs/code/electron-browser/agentHostConfiguration.ts');
	const hostAgentHostConfiguration = readSource(
		'src/cs/code/electron-main/agentHost/localAgentHostConfiguration.ts',
	);
	assert.doesNotMatch(clientAgentHostConfiguration, /agentHost\/node/);
	assert.doesNotMatch(hostAgentHostConfiguration, /agentHost\/browser/);
});

test('Lower source layers do not import Sessions and Workbench has no product host entry', () => {
	const lowerLayerRoots = ['base', 'platform', 'editor', 'workbench']
		.map(layer => path.join(Root, 'src/cs', layer));
	const violations = lowerLayerRoots.flatMap(root => sourceFiles(root)).flatMap(file => {
		const source = readFileSync(file, 'utf8');
		return source.includes("'cs/sessions/") || source.includes('"cs/sessions/')
			? [path.relative(Root, file)]
			: [];
	});
	assert.deepEqual(violations, []);
	const workbenchRoot = path.join(Root, 'src/cs/workbench');
	assert.equal(existsSync(path.join(workbenchRoot, 'browser/workbench.ts')), false);

	const sessionsSources = sourceFiles(path.join(Root, 'src/cs/sessions'));
	const hostDefinitions = sessionsSources.filter(file =>
		readFileSync(file, 'utf8').includes('class SessionsWorkbenchHost'),
	);
	assert.deepEqual(hostDefinitions.map(file => path.relative(Root, file)), [
		'src/cs/sessions/browser/sessionsWorkbench.ts',
	]);
});

test('Sessions host directly composes Parts without a state-forwarding wrapper', () => {
	assert.equal(
		existsSync(path.join(Root, 'src/cs/sessions/browser/workbenchContentPartViews.ts')),
		false,
	);

	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	assert.doesNotMatch(
		sessionsWorkbench,
		/SessionWorkbenchContentPartViews|workbenchContentPartViews|partViewProps/,
	);
	assert.match(sessionsWorkbench, /createInstance\(\s*SessionSidebarPartView\s*\)/);
	assert.match(sessionsWorkbench, /createInstance\(\s*SessionsTitlebarPart,/);
	assert.match(sessionsWorkbench, /createInstance\(\s*SessionsLayoutView,/);
	assert.match(
		sessionsWorkbench,
		/@ISessionsPartService private readonly sessionsPart: SessionsPart/,
	);
	assert.doesNotMatch(sessionsWorkbench, /setTitlebarActions|collapsedEditorTitlebarActions|sidebarFooterActionsProps/);
	assert.doesNotMatch(sessionsWorkbench, /titlebarPart\.sync|new SessionsTitlebarPart/);

	const layout = readSource('src/cs/sessions/browser/layout.ts');
	assert.doesNotMatch(layout, /ISessionsLayoutPartViews|partViews/);
	assert.match(layout, /private readonly sidebarPart: SessionSidebarPartView/);
	assert.match(layout, /private readonly sessionsPart: SessionsPart/);
	assert.match(layout, /private readonly editorPart: SessionsMainEditorPart/);

	const sidebar = readSource('src/cs/sessions/browser/parts/sidebar/sidebarPart.ts');
	assert.doesNotMatch(sidebar, /SessionSidebar(?:View)?Props|\bisCollapsed\b|setProps\(/);
	assert.match(sidebar, /@ISessionsLayoutService private readonly layoutService/);
	assert.match(sidebar, /createInstance\(SidebarTitlebarActionsView\)/);
	assert.match(sidebar, /createInstance\(SidebarFooterActionsView\)/);
	assert.doesNotMatch(sidebar, /titlebarActionsElement: HTMLElement|footerActionsElement: HTMLElement/);
	assert.match(sidebar, /@IWorkbenchLocaleService private readonly localeService/);
	assert.match(sidebar, /getLayoutState\(\)\.isSidebarVisible/);
	assert.doesNotMatch(sidebar, /tabActionsElement|comet-sidebar-tab-actions/);
	assert.equal(
		existsSync(path.join(Root, 'src/cs/sessions/browser/parts/auxiliarybar/auxiliaryBarPart.ts')),
		false,
	);
	assert.equal(
		existsSync(path.join(Root, 'src/cs/sessions/browser/parts/media/sessionView.css')),
		false,
	);
	const sessionsPart = readSource('src/cs/sessions/browser/parts/sessions/sessionsPart.ts');
	const sessionView = readSource('src/cs/sessions/browser/parts/sessions/sessionView.ts');
	assert.match(sessionsPart, /parts\/sessions\/media\/sessionsPart\.css/);
	assert.match(sessionView, /parts\/sessions\/media\/sessionView\.css/);

	const editorPart = readSource('src/cs/workbench/browser/parts/editor/editorPart.ts');
	const editorGroupView = readSource('src/cs/workbench/browser/parts/editor/editorGroupView.ts');
	const editorCss = readSource('src/cs/workbench/browser/parts/editor/media/editor.css');
	const statusbarCss = readSource('src/cs/workbench/browser/parts/statusbar/media/statusbar.css');
	assert.doesNotMatch(editorPart, /titlebarAuxiliaryActionsElements/);
	assert.doesNotMatch(editorGroupView, /titlebarAuxiliaryActionsElements/);
	assert.doesNotMatch(editorCss, /comet-editor-placeholder|comet-editor-statusbar/);
	assert.match(statusbarCss, /\.comet-editor-statusbar/);
	assert.equal(
		existsSync(path.join(Root, 'src/cs/workbench/browser/parts/editor/editorPlaceholder.ts')),
		false,
	);
	assert.equal(
		existsSync(path.join(Root, 'src/cs/workbench/browser/parts/editor/editorStatusView.ts')),
		false,
	);
});

test('Settings view owns its service state without a shell Props bus', () => {
	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	const workbenchCommon = readSource('src/cs/workbench/workbench.common.main.ts');
	assert.match(
		sessionsWorkbench,
		/@ISettingsModel private readonly settingsModel: SettingsModel/,
	);
	assert.doesNotMatch(
		sessionsWorkbench,
		/ISettingsController|ILibraryModel|IFetchService|IEditorDraftStyleService|createSettingsPartProps|settingsPartProps|settingsView\.setProps/,
	);
	assert.match(sessionsWorkbench, /createInstance\(SettingsPartView\)/);
	assert.doesNotMatch(sessionsWorkbench, /settingsOverlayBodyElement|getNavigationElement\(/);
	assert.match(
		sessionsWorkbench,
		/registerWorkbenchPartDomNode\(WORKBENCH_PART_IDS\.settings, null\)/,
	);
	assert.match(
		sessionsWorkbench,
		/registerWorkbenchPartDomNode\(\s*WORKBENCH_PART_IDS\.settings,\s*settingsView\.getElement\(\)/,
	);
	assert.match(workbenchCommon, /preferences\/browser\/settings\.contribution/);

	const settingsController = readSource(
		'src/cs/workbench/contrib/preferences/browser/settingsController.ts',
	);
	assert.doesNotMatch(
		settingsController,
		/SettingsControllerContext|CreateSettingsControllerParams|readonly setContext|readonly getSnapshot|readonly subscribe/,
	);
	assert.match(settingsController, /@INativeHostService private readonly nativeHostService/);
	assert.match(settingsController, /updateLocalePreference\(value, this\.getSettingsModelContext\(\)\)/);
	assert.match(settingsController, /registerSingleton\(\s*ISettingsController,/);
	assert.equal(
		existsSync(path.join(Root, 'src/cs/workbench/contrib/localization/browser/localizationsActions.ts')),
		false,
	);
	const settingsEditor = readSource(
		'src/cs/workbench/contrib/preferences/browser/settingsEditor.ts',
	);
	assert.doesNotMatch(
		settingsEditor,
		/createSettingsPartLabels|createSettingsPartProps|createSettingsPartView|setProps\(props|getNavigationElement|getContentElement|registerWorkbenchPartDomNode/,
	);
	assert.match(settingsEditor, /@ISettingsModel private readonly settingsModel/);
	assert.match(settingsEditor, /@ISettingsController private readonly settingsController/);
	assert.match(settingsEditor, /@ILibraryModel private readonly libraryModel/);
	assert.match(settingsEditor, /@IFetchService private readonly fetchService/);
	assert.match(settingsEditor, /@IEditorDraftStyleService private readonly editorDraftStyleService/);
	assert.match(settingsEditor, /@IWorkbenchLocaleService private readonly localeService/);
	assert.match(settingsEditor, /@IWorkbenchLanguageService private readonly languageService/);
	assert.match(settingsEditor, /@INativeHostService private readonly nativeHostService/);
	assert.match(settingsEditor, /@IContextViewService private readonly contextViewService/);
	assert.match(settingsEditor, /@IHoverService private readonly hoverService/);
	const settingsUiPrimitives = readSource(
		'src/cs/workbench/contrib/preferences/browser/settingsUiPrimitives.ts',
	);
	assert.doesNotMatch(settingsUiPrimitives, /getHoverService/);
	assert.match(settingsUiPrimitives, /new ButtonView/);
	assert.match(settingsUiPrimitives, /disposables\.add\(selectBox\)/);
	const llmWidget = readSource(
		'src/cs/workbench/contrib/preferences/browser/llmWidget.ts',
	);
	const translationWidget = readSource(
		'src/cs/workbench/contrib/preferences/browser/translationWidget.ts',
	);
	assert.doesNotMatch(llmWidget, /getHoverService/);
	assert.match(llmWidget, /class LlmModelSettingsSection extends Disposable/);
	assert.match(llmWidget, /class LlmApiKeySettingsSection extends Disposable/);
	assert.match(translationWidget, /class TranslationSettingsSection extends Disposable/);
	const settingsTypes = readSource(
		'src/cs/workbench/contrib/preferences/browser/settingsTypes.ts',
	);
	assert.doesNotMatch(settingsTypes, /SettingsPartProps|SettingsPartState|SettingsPartActions/);
});

test('Library model is a DI service without mutable shell context', () => {
	assert.equal(
		existsSync(path.join(Root, 'src/cs/workbench/browser/libraryModel.ts')),
		false,
	);

	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	const settingsEditor = readSource(
		'src/cs/workbench/contrib/preferences/browser/settingsEditor.ts',
	);
	const workbenchCommon = readSource('src/cs/workbench/workbench.common.main.ts');
	assert.match(
		settingsEditor,
		/@ILibraryModel private readonly libraryModel: LibraryModel/,
	);
	assert.doesNotMatch(
		sessionsWorkbench,
		/ILibraryModel|createLibraryModel|LibraryModelContext|getWorkbenchLibraryModel|libraryModelInstance\.setContext/,
	);
	assert.match(workbenchCommon, /services\/knowledgeBase\/libraryModel/);

	const libraryModel = readSource(
		'src/cs/workbench/services/knowledgeBase/libraryModel.ts',
	);
	assert.doesNotMatch(libraryModel, /LibraryModelContext|readonly setContext|readonly start/);
	assert.match(libraryModel, /@INativeHostService private readonly nativeHostService/);
	assert.match(libraryModel, /registerSingleton\(ILibraryModel, LibraryModel,/);
});

test('Article export is a DI service without mutable shell context', () => {
	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	const workbenchCommon = readSource('src/cs/workbench/workbench.common.main.ts');
	assert.doesNotMatch(
		sessionsWorkbench,
		/IArticleSummaryTranslationExportService|createArticleSummaryTranslationExportController|ArticleSummaryTranslationExportControllerContext|getWorkbenchArticleSummaryTranslationExportController|syncWorkbenchServicesContext/,
	);
	assert.match(
		workbenchCommon,
		/contrib\/translation\/browser\/articleSummaryTranslationExport/,
	);

	const articleExport = readSource(
		'src/cs/workbench/contrib/translation/browser/articleSummaryTranslationExport.ts',
	);
	assert.doesNotMatch(
		articleExport,
		/ArticleSummaryTranslationExportController|readonly setContext|readonly subscribe/,
	);
	assert.match(articleExport, /@INativeHostService private readonly nativeHostService/);
	assert.match(
		articleExport,
		/registerSingleton\(\s*IArticleSummaryTranslationExportService,/,
	);
});

test('Document actions are a DI service with explicit operation targets', () => {
	assert.equal(
		existsSync(path.join(Root, 'src/cs/workbench/browser/documentActionsModel.ts')),
		false,
	);
	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	const workbenchCommon = readSource('src/cs/workbench/workbench.common.main.ts');
	const documentActions = readSource(
		'src/cs/workbench/services/document/browser/documentActionsService.ts',
	);
	assert.doesNotMatch(
		sessionsWorkbench,
		/DocumentActionsController|DocumentActionsControllerContext|getWorkbenchDocumentActionsController|documentActionsController|setContext/,
	);
	assert.match(workbenchCommon, /services\/document\/browser\/documentActionsService/);
	assert.match(documentActions, /@INativeHostService private readonly nativeHostService/);
	assert.match(documentActions, /@ISettingsModel private readonly settingsModel/);
	assert.match(documentActions, /@IFetchService private readonly fetchService/);
	assert.match(documentActions, /@IArticleSummaryTranslationExportService/);
	assert.doesNotMatch(
		documentActions,
		/contrib\/translation\/browser\/articleSummaryTranslationExport/,
	);
	assert.match(documentActions, /registerSingleton\(IDocumentActionsService, DocumentActionsService,/);
	assert.doesNotMatch(documentActions, /ControllerContext|setContext|subscribe/);
	const chatInput = readSource(
		'src/cs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts',
	);
	const articlePresentation = readSource(
		'src/cs/workbench/contrib/fetch/browser/articleChatPresentations.ts',
	);
	assert.doesNotMatch(chatInput, /IDocumentActionsService|Article/);
	assert.match(articlePresentation, /@IDocumentActionsService documentActionsService/);
	assert.match(articlePresentation, /resource: this\.chatResource,[\s\S]*articleIds,/);
	assert.doesNotMatch(chatInput, /inputToolbarActions|renderChatInputToolbar/);
	assert.equal(
		existsSync(path.join(Root, 'src/cs/workbench/contrib/chat/browser/widget/input/chatInputToolbar.ts')),
		false,
	);
	assert.equal(
		existsSync(path.join(Root, 'src/cs/workbench/browser/articleBatchTask.ts')),
		false,
	);
});

test('Chat Article Browser opening binds the addressed desktop document without DOM inference', () => {
	const desktopMain = readSource('src/cs/sessions/sessions.desktop.main.ts');
	const webMain = readSource('src/cs/sessions/sessions.web.main.ts');
	const chatList = readSource('src/cs/workbench/contrib/chat/browser/widget/chatListWidget.ts');
	const articlePresentation = readSource(
		'src/cs/workbench/contrib/fetch/browser/articleChatPresentations.ts',
	);
	const desktopService = readSource(
		'src/cs/sessions/contrib/browserView/electron-browser/chatArticleBrowserService.ts',
	);
	assert.match(desktopMain, /browserView\/electron-browser\/chatArticleBrowserService/);
	assert.match(webMain, /browserView\/browser\/chatArticleBrowserService/);
	assert.doesNotMatch(chatList, /IChatArticleBrowserService|Article/);
	assert.match(articlePresentation, /@IChatArticleBrowserService browserService/);
	assert.match(articlePresentation, /chatResource: context\.chatResource/);
	assert.match(desktopService, /createBrowserDocumentTarget/);
	assert.match(desktopService, /addInteractionTargets\(target\.chatResource/);
	assert.doesNotMatch(desktopService, /activeEditor|querySelector|closest\(|children\[/);
});

test('Browser toolbar is owned by the addressed Browser editor without shell actions', () => {
	const removedFiles = [
		'src/cs/workbench/browser/parts/editor/editorModeToolbarRegistry.ts',
		'src/cs/workbench/contrib/browserView/common/browserEditorToolbarService.ts',
		'src/cs/workbench/contrib/browserView/browser/browserEditorToolbarService.ts',
		'src/cs/workbench/contrib/browserView/browser/browserToolbarActions.ts',
		'src/cs/workbench/contrib/browserView/browser/browserModeToolbarHost.ts',
		'src/cs/workbench/contrib/browserView/browser/browserModeToolbarContribution.ts',
		'src/cs/workbench/contrib/browserView/browser/browserModeToolbarModel.ts',
		'src/cs/workbench/contrib/browserView/browser/browserModeToolbarTypes.ts',
	];
	for (const relativePath of removedFiles) {
		assert.equal(existsSync(path.join(Root, relativePath)), false, relativePath);
	}

	const sessionsWorkbench = readSource('src/cs/sessions/browser/sessionsWorkbench.ts');
	assert.doesNotMatch(
		sessionsWorkbench,
		/IBrowserEditorToolbarService|createEditorBrowserToolbarActions|setActions\(|browserViewId|activeBrowserEditor/,
	);
	const editorGroup = readSource('src/cs/workbench/browser/parts/editor/editorGroupView.ts');
	assert.doesNotMatch(editorGroup, /modeToolbarHost|viewPartProps|EditorModeToolbar/);
	const browserEditor = readSource(
		'src/cs/workbench/contrib/browserView/electron-browser/browserEditor.ts',
	);
	assert.match(browserEditor, /override getToolbarElement\(\): HTMLElement/);
	assert.match(browserEditor, /requires one toolbar contribution/);
	assert.match(browserEditor, /getToolbarContribution\(\)/);
	assert.doesNotMatch(browserEditor, /browserStateByTabId|onDidChangeBrowserState|setHistoryFeature|setFavoritesFeature/);
	const browserToolbar = readSource(
		'src/cs/workbench/contrib/browserView/electron-browser/browserModeToolbar.ts',
	);
	assert.match(browserToolbar, /class BrowserModeToolbar extends BrowserEditorToolbarContribution/);
	assert.match(browserToolbar, /executeCommand\(commandId, this\.editor\)/);
	const browserToolbarActions = readSource(
		'src/cs/workbench/contrib/browserView/electron-browser/features/browserToolbarActions.ts',
	);
	assert.doesNotMatch(browserToolbarActions, /execCommand|activeEditorPane/);
	const pdfPane = readSource('src/cs/workbench/contrib/pdfEditor/browser/pdfEditorPane.ts');
	assert.doesNotMatch(pdfPane, /IBrowserEditorToolbarService|browserEditorToolbarService/);
	assert.match(pdfPane, /this\.editorService\.openEditor\(\{[\s\S]*BrowserViewUri\.forId/);
});
