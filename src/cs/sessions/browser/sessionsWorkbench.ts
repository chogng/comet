/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IChatService as IChatServiceDecorator } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { createDocumentActionsController } from 'cs/workbench/browser/documentActionsModel';
import type {
	DocumentActionsController,
	DocumentActionsControllerContext,
	IArticleSelectionSnapshot,
} from 'cs/workbench/browser/documentActionsModel';
import { createArticleSummaryTranslationExportController } from 'cs/workbench/contrib/translation/browser/articleSummaryTranslationExport';
import type {
	ArticleSummaryTranslationExportController,
	ArticleSummaryTranslationExportControllerContext,
} from 'cs/workbench/contrib/translation/browser/articleSummaryTranslationExport';
import { createLibraryModel } from 'cs/workbench/browser/libraryModel';
import type { LibraryModel, LibraryModelContext } from 'cs/workbench/browser/libraryModel';

import { Schemas } from 'cs/base/common/network';
import { $ } from 'cs/base/browser/dom';
import {
	registerWorkbenchPartDomNode,
} from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';
import { SessionsLayoutView } from 'cs/sessions/browser/layout';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import { SessionsLayoutCommandIds } from 'cs/sessions/common/layoutCommands';
import {
	SettingsController,
	type SettingsControllerContext,
} from 'cs/workbench/contrib/preferences/browser/settingsController';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import { generateUuid } from 'cs/base/common/uuid';

import { createEditorBrowserToolbarActions } from 'cs/workbench/contrib/browserView/browser/browserToolbarActions';
import { getEditorCreationActions } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import { SidebarFooterActionsView } from 'cs/workbench/browser/parts/sidebar/sidebarFooterActions';
import {
	createSidebarFooterTitlebarActionsProps,
	createTitlebarLeadingActionsProps,
} from 'cs/workbench/browser/parts/titlebar/titlebarActions';
import { createTitlebarPart } from 'cs/workbench/browser/parts/titlebar/titlebarPart';
import type { TitlebarPart } from 'cs/workbench/browser/parts/titlebar/titlebarPart';
import { syncWorkbenchWindowTitle } from 'cs/workbench/browser/parts/titlebar/windowTitle';
import {
	createSettingsPartView,
	createSettingsPartProps,
} from 'cs/workbench/contrib/preferences/browser/settingsEditor';

import { SessionSidebarPartView } from 'cs/sessions/browser/parts/sidebar/sidebarPart';
import { SessionsEditorParts } from 'cs/sessions/browser/parts/editor/editorParts';
import { SessionsPart } from 'cs/sessions/browser/parts/sessions/sessionsPart';
import { ISessionsPartService } from 'cs/sessions/services/sessions/browser/sessionsPartService';
import {
	ISessionsService,
	OpenNewSessionKind,
} from 'cs/sessions/services/sessions/browser/sessionsService';
import { ISessionsManagementService } from 'cs/sessions/services/sessions/common/sessionsManagement';
import { SessionWorkspaceKind } from 'cs/sessions/services/sessions/common/session';
import { isNewSessionSlot } from 'cs/sessions/services/sessions/common/sessionsView';

import { createEditorTitlebarActionsView } from 'cs/workbench/browser/parts/editor/editorTitlebarActionsView';
import { setARIAContainer } from 'cs/base/browser/ui/aria/aria';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { INotificationService } from 'cs/platform/notification/common/notification';
import {
	IStorageService,
	WillSaveStateReason,
} from 'cs/platform/storage/common/storage';
import {
	getWorkbenchInstantiationService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import {
	IEditorService,
	type EditorOpenHandler,
} from 'cs/workbench/services/editor/common/editorService';
import { IDraftEditorService } from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import { IBrowserEditorToolbarService } from 'cs/workbench/contrib/browserView/common/browserEditorToolbarService';
import { NotificationsAlerts } from 'cs/workbench/browser/parts/notifications/notificationsAlerts';
import { NotificationsCenter } from 'cs/workbench/browser/parts/notifications/notificationsCenter';
import { NotificationsStatus } from 'cs/workbench/browser/parts/notifications/notificationsStatus';
import { NotificationsToasts } from 'cs/workbench/browser/parts/notifications/notificationsToasts';
import { NotificationService } from 'cs/workbench/services/notification/common/notificationService';

import {
	localeService,
} from 'cs/workbench/services/localization/browser/localeService';
import {
	getWindowStateSnapshot,
	subscribeWindowState,
} from 'cs/workbench/browser/window';

import { getLocaleMessages } from 'language/i18n';
import { IFetchService } from 'cs/workbench/services/fetch/common/fetch';
import { normalizeUrl } from 'cs/workbench/common/url';
import type { AppStartupLayout } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { normalizeBrowserTabKeepAliveLimit } from 'cs/workbench/services/webContent/webContentRetentionConfig';
import { editorDraftStyleService } from 'cs/editor/browser/text/editorDraftStyleService';
import { INativeHostService } from 'cs/platform/native/common/native';
import { IWorkbenchConfigurationService } from 'cs/workbench/services/configuration/common/configuration';
import {
	BrowserMaxHistoryEntriesSettingId,
	BrowserPageZoomSettingId,
	BrowserSearchEngineSettingId,
	maxBrowserMaxHistoryEntries,
	minBrowserMaxHistoryEntries,
} from 'cs/base/parts/sandbox/common/browserSettings';
import { IOpenerService } from 'cs/platform/opener/common/opener';
import { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { applyWorkbenchTheme } from 'cs/workbench/services/themes/browser/workbenchThemeService';
import { applyWorkbenchBrowserStyles } from 'cs/workbench/browser/style';
import {
	ILifecycleService,
	LifecyclePhase,
	type IWorkbenchLifecycleService,
} from 'cs/workbench/services/lifecycle/common/lifecycle';
import {
	startWorkbenchContributions,
	stopWorkbenchContributions,
} from 'cs/workbench/common/contributions';

export type WorkbenchServicesSyncParams = {
	settingsController: SettingsController;
	settingsContext: SettingsControllerContext;
	libraryModel: LibraryModel;
	libraryContext: LibraryModelContext;
	articleSummaryTranslationExportController: ArticleSummaryTranslationExportController;
	articleSummaryTranslationExportContext: ArticleSummaryTranslationExportControllerContext;
	documentActionsController: DocumentActionsController;
	documentActionsContext: DocumentActionsControllerContext;
};

type DesktopInvokeArgs = Record<string, unknown> | undefined;

let settingsController: SettingsController | null = null;
let libraryModel: LibraryModel | null = null;
let articleSummaryTranslationExportController: ArticleSummaryTranslationExportController | null = null;
let documentActionsController: DocumentActionsController | null = null;
let activeSessionsWorkbenchHost: SessionsWorkbenchHost | null = null;

function resolveRuntimeState(nativeHost: INativeHostService) {
	const electronRuntime = nativeHost.canInvoke();

	return {
		electronRuntime,
		desktopRuntime: electronRuntime,
	};
}

class SessionsWorkbenchHost {
	private readonly rootElement: HTMLElement;
	private readonly containerElement: HTMLDivElement;
	private readonly shellElement: HTMLDivElement;
	private readonly pageMount: HTMLDivElement;
	private readonly settingsOverlayElement: HTMLDivElement;
	private readonly settingsOverlayBodyElement: HTMLDivElement;
	private readonly statusbarElement: HTMLElement;
	private readonly titlebarPart: TitlebarPart;
	private readonly notificationsDisposables = new DisposableStore();
	private sessionsLayoutView: SessionsLayoutView | null = null;
	private sidebarPart: SessionSidebarPartView | null = null;
	private readonly collapsedEditorTitlebarActionsView: ReturnType<typeof createEditorTitlebarActionsView>;
	private readonly sidebarFooterActionsView: SidebarFooterActionsView;
	private settingsView: ReturnType<typeof createSettingsPartView> | null = null;
	private readonly globalDisposables: Array<() => void> = [];
	private servicesSubscribed = false;
	private isDisposed = false;
	private isRendering = false;
	private renderPending = false;
	private settingsOverlayVisible = false;
	private hasAppliedStartupLayoutPreference = false;
	private appliedBrowserSettings: {
		maxHistoryEntries: number;
		pageZoom: string;
		searchEngine: string;
	} | null = null;
	constructor(
		rootElement: HTMLElement,
		@INotificationService private readonly notificationService: NotificationService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IDialogService private readonly dialogService: IDialogService,
		@IWorkbenchCommandService private readonly commandService: IWorkbenchCommandService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IChatServiceDecorator private readonly chatService: IChatService,
		@ISessionsService private readonly sessionsService: ISessionsService,
		@ISessionsPartService private readonly sessionsPart: SessionsPart,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@ISessionsLayoutService private readonly sessionsLayoutService: ISessionsLayoutService,
		@IEditorGroupsService private readonly editorGroupsService: SessionsEditorParts,
		@IEditorService private readonly editorService: IEditorService,
		@IDraftEditorService private readonly draftEditorService: IDraftEditorService,
		@IBrowserEditorToolbarService private readonly browserEditorToolbarService: IBrowserEditorToolbarService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFetchService private readonly fetchService: IFetchService,
		@IWorkbenchConfigurationService private readonly configurationService: IWorkbenchConfigurationService,
		@ILifecycleService private readonly lifecycleService: IWorkbenchLifecycleService,
		) {
			const initialUi = getLocaleMessages(localeService.getLocale());
			const dropdownServices = {
			contextMenuService: this.contextMenuService,
			contextViewProvider: this.contextViewService,
		};
			this.collapsedEditorTitlebarActionsView = createEditorTitlebarActionsView({
				...dropdownServices,
				isEditorCollapsed: true,
				labels: {
					headerAddAction: initialUi.editorHeaderAddAction,
					expandEditor: initialUi.editorExpand,
					collapseEditor: initialUi.editorCollapse,
				},
				creationActions: getEditorCreationActions(initialUi),
				commandService: this.commandService,
				onToggleEditorCollapse: this.toggleEditorCollapsed,
		});
		this.sidebarFooterActionsView = new SidebarFooterActionsView(dropdownServices);
		this.rootElement = rootElement;
		this.containerElement = $<HTMLDivElement>('div');
		this.shellElement = $<HTMLDivElement>('div');
		this.pageMount = $<HTMLDivElement>('div');
		this.settingsOverlayElement = $<HTMLDivElement>('div');
		this.settingsOverlayBodyElement = $<HTMLDivElement>('div');
		this.statusbarElement = $<HTMLElementTagNameMap['section']>('section');
		this.settingsOverlayElement.className = 'comet-settings-overlay';
		this.settingsOverlayElement.hidden = true;
		this.settingsOverlayBodyElement.className = 'comet-settings-body';
		this.settingsOverlayElement.append(this.settingsOverlayBodyElement);
		this.settingsOverlayElement.addEventListener('click', event => {
			if (event.target === this.settingsOverlayElement) {
				this.closeSettingsOverlay();
			}
		});
		this.titlebarPart = createTitlebarPart(
			this.containerElement,
			this.shellElement,
			this.statusbarElement,
			dropdownServices,
		);

		this.rootElement.replaceChildren(this.containerElement);
		this.containerElement.append(this.titlebarPart.getElement(), this.shellElement);
		this.shellElement.append(
			this.pageMount,
			this.settingsOverlayElement,
		);
		this.createNotificationsHandlers();

		registerWorkbenchPartDomNode(
			WORKBENCH_PART_IDS.container,
			this.containerElement,
		);
	}

	start() {
		this.editorGroupsService.mainPart.initialize();
		this.openInitialDraftIfUnambiguous();
		this.globalDisposables.push(
			localeService.subscribe(this.requestRender),
			this.sessionsLayoutService.onDidChangeLayoutState(this.requestRender),
			subscribeWindowState(this.requestRender),
			editorDraftStyleService.subscribe(this.requestRender),
			this.editorGroupsService.onDidChange(this.requestRender),
		);

		this.requestRender();
	}

	dispose() {
		if (this.isDisposed) {
			return;
		}

		this.isDisposed = true;
		while (this.globalDisposables.length > 0) {
			this.globalDisposables.pop()?.();
		}

		this.browserEditorToolbarService.setActions(null);
		this.titlebarPart.dispose();
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.container, null);

		this.sessionsLayoutView?.dispose();
		this.sessionsLayoutView = null;
		this.sidebarPart?.dispose();
		this.sidebarPart = null;
		this.collapsedEditorTitlebarActionsView.dispose();
		this.sidebarFooterActionsView.dispose();
		this.settingsView?.dispose();
		this.settingsView = null;
		this.notificationsDisposables.dispose();
		this.rootElement.replaceChildren();
	}

	private createNotificationsHandlers() {
		const notificationsCenter = this.notificationsDisposables.add(
			new NotificationsCenter(this.containerElement, this.notificationService.model),
		);
		this.notificationsDisposables.add(
			new NotificationsToasts(this.containerElement, this.notificationService.model),
		);
		this.notificationsDisposables.add(
			new NotificationsStatus(
				this.containerElement,
				this.notificationService.model,
				notificationsCenter,
			),
		);
		this.notificationsDisposables.add(
			new NotificationsAlerts(this.containerElement, this.notificationService.model),
		);
	}

	private readonly requestRender = () => {
		if (this.isDisposed) {
			return;
		}

		if (this.isRendering) {
			this.renderPending = true;
			return;
		}

		this.isRendering = true;
		try {
			do {
				this.renderPending = false;
				this.performRender();
			} while (this.renderPending && !this.isDisposed);
		} finally {
			this.isRendering = false;
		}
	};

	private syncBrowserSettings(settings: {
		browserMaxHistoryEntries: number;
		browserPageZoom: string;
		browserSearchEngine: string;
	}) {
		if (
			this.appliedBrowserSettings?.maxHistoryEntries === settings.browserMaxHistoryEntries &&
			this.appliedBrowserSettings?.pageZoom === settings.browserPageZoom &&
			this.appliedBrowserSettings?.searchEngine === settings.browserSearchEngine
		) {
			return;
		}

		this.appliedBrowserSettings = {
			maxHistoryEntries: settings.browserMaxHistoryEntries,
			pageZoom: settings.browserPageZoom,
			searchEngine: settings.browserSearchEngine,
		};
		void this.configurationService.updateValue(
			BrowserMaxHistoryEntriesSettingId,
			settings.browserMaxHistoryEntries,
		);
		void this.configurationService.updateValue(BrowserPageZoomSettingId, settings.browserPageZoom);
		void this.configurationService.updateValue(
			BrowserSearchEngineSettingId,
			settings.browserSearchEngine,
		);
	}

	private ensureServiceSubscriptions(services: {
		settingsController: SettingsController;
		libraryModel: LibraryModel;
		articleSummaryTranslationExportController: ArticleSummaryTranslationExportController;
		documentActionsController: DocumentActionsController;
	}) {
		if (this.servicesSubscribed) {
			return;
		}

		this.servicesSubscribed = true;
		this.globalDisposables.push(
			services.settingsController.subscribe(this.requestRender),
			services.libraryModel.subscribe(this.requestRender),
			services.articleSummaryTranslationExportController.subscribe(this.requestRender),
			services.documentActionsController.subscribe(this.requestRender),
		);
	}

	private readonly getActiveChatArticleSelection = (): IArticleSelectionSnapshot | undefined => {
		const activeSession = this.sessionsService.activeSession.get();
		if (!activeSession) {
			return undefined;
		}

		const resource = activeSession.activeChat.get().resource;
		const modelReference = this.chatService.acquireModel(resource);
		try {
			return {
				resource,
				articleIds: [...modelReference.object.getSnapshot().checkedArticleIds],
			};
		} finally {
			modelReference.dispose();
		}
	};

	private readonly removeChatArticleChecks = (
		resource: IArticleSelectionSnapshot['resource'],
		articleIds: IArticleSelectionSnapshot['articleIds'],
	) => {
		this.chatService.removeArticleChecks(resource, articleIds);
	};

	private readonly togglePrimarySidebarVisibility = () => {
		this.commandService.executeCommand(
			SessionsLayoutCommandIds.toggleSidebarVisibility,
		);
	};

	private readonly toggleEditorCollapsed = () => {
		this.commandService.executeCommand(
			SessionsLayoutCommandIds.toggleEditorCollapsed,
		);
	};

	private readonly applyAgentLayout = () => {
		this.commandService.executeCommand(SessionsLayoutCommandIds.applyAgentLayout);
	};

	private readonly applyFlowLayout = () => {
		this.commandService.executeCommand(SessionsLayoutCommandIds.applyFlowLayout);
	};

	private readonly toggleSettingsPage = () => {
		this.settingsOverlayVisible = !this.settingsOverlayVisible;
		this.requestRender();
	};

	private readonly closeSettingsOverlay = () => {
		if (!this.settingsOverlayVisible) {
			return;
		}
		this.settingsOverlayVisible = false;
		this.requestRender();
	};

	private openInitialDraftIfUnambiguous(): void {
		if (this.sessionsManagementService.draftSession.get()
			|| this.sessionsManagementService.getSessions().length > 0
			|| !this.sessionsService.visibleSessions.get().some(isNewSessionSlot)) {
			return;
		}

		const sessionTypes = this.sessionsManagementService.sessionTypes.get();
		if (sessionTypes.length !== 1 || !sessionTypes[0].sessionType.supportsWorkspaceLess) {
			return;
		}

		const [{ providerId, sessionType }] = sessionTypes;
		this.sessionsService.openNewSession({
			kind: OpenNewSessionKind.Draft,
			providerId,
			draft: {
				sessionType: sessionType.id,
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			},
			preserveFocus: true,
		});
	}

	private renderWorkbenchContentPage(props: {
		isLayoutEdgeSnappingEnabled: boolean;
		sidebarFooterActionsProps: ReturnType<
			typeof createSidebarFooterTitlebarActionsProps
		>;
		collapsedEditorTitlebarActionsElement: HTMLElement;
	}) {
		this.sidebarFooterActionsView.setProps(
			props.sidebarFooterActionsProps,
		);

		//#region Column titlebar routing

		if (!this.sidebarPart) {
			this.sidebarPart = this.instantiationService.createInstance(
				SessionSidebarPartView,
				this.titlebarPart.getLeadingActionsElement(),
				this.sidebarFooterActionsView.getElement(),
			);
		}

		//#endregion

		const { isEditorCollapsed } = this.sessionsLayoutService.getLayoutState();
		this.sessionsPart.setTitlebarActions(
			null,
			isEditorCollapsed
				? props.collapsedEditorTitlebarActionsElement
				: null,
		);

		if (!this.sessionsLayoutView) {
			this.sessionsLayoutView = this.instantiationService.createInstance(
				SessionsLayoutView,
				props.isLayoutEdgeSnappingEnabled,
				this.sidebarPart,
				this.sessionsPart,
				this.editorGroupsService.mainPart,
			);
		} else {
			this.sessionsLayoutView.setEdgeSnappingEnabled(
				props.isLayoutEdgeSnappingEnabled,
			);
		}

		const workbenchContentElement = this.sessionsLayoutView.getElement();
		if (this.pageMount.firstChild !== workbenchContentElement) {
			this.pageMount.replaceChildren(workbenchContentElement);
		}
		this.sessionsLayoutView.layout();
	}

	private renderSettingsOverlay(
		props: {
			settingsPartProps: ReturnType<typeof createSettingsPartProps>;
		},
	) {
		if (!this.settingsOverlayVisible) {
			this.settingsView?.dispose();
			this.settingsView = null;
			this.settingsOverlayBodyElement.replaceChildren();
			this.settingsOverlayElement.hidden = true;
			return;
		}

		if (!this.settingsView) {
			this.settingsView = createSettingsPartView(props.settingsPartProps, this.contextViewService);
		} else {
			this.settingsView.setProps(props.settingsPartProps);
		}
		this.settingsOverlayElement.hidden = false;
		const navigationElement = this.settingsView.getNavigationElement();
		const settingsElement = this.settingsView.getElement();
		if (
			this.settingsOverlayBodyElement.children[0] !== navigationElement ||
			this.settingsOverlayBodyElement.children[1] !== settingsElement ||
			this.settingsOverlayBodyElement.childElementCount !== 2
		) {
			this.settingsOverlayBodyElement.replaceChildren(
				navigationElement,
				settingsElement,
			);
		}
	}

	private applyStartupLayoutPreferenceIfNeeded(params: {
		hasLoadedSettings: boolean;
		startupLayout: AppStartupLayout;
	}) {
		if (this.hasAppliedStartupLayoutPreference || !params.hasLoadedSettings) {
			return false;
		}

		this.hasAppliedStartupLayoutPreference = true;
		return this.sessionsLayoutService.applyStartupLayoutMode(params.startupLayout);
	}

	private performRender() {
		const locale = localeService.getLocale();
		const ui = getLocaleMessages(locale);
		const {
			mode: layoutMode,
			isSidebarVisible,
			isEditorCollapsed,
		} = this.sessionsLayoutService.getLayoutState();
		const isAgentMode = layoutMode === 'agent';
		const { isFullscreen: isWindowFullscreen } = getWindowStateSnapshot();
		const nativeHost = this.nativeHostService;
		const { electronRuntime, desktopRuntime } =
			resolveRuntimeState(nativeHost);

		const invokeDesktop = async <T>(
			command: string,
			args?: DesktopInvokeArgs,
		): Promise<T> => {
			return nativeHost.invoke(command as never, args as never) as Promise<T>;
		};

		const settingsControllerInstance = getWorkbenchSettingsController(
			this.instantiationService,
			{
				desktopRuntime,
				invokeDesktop,
				notificationService: this.notificationService,
				ui,
				locale,
			},
		);
		const settingsSnapshot = settingsControllerInstance.getSnapshot();
		if (
			this.applyStartupLayoutPreferenceIfNeeded({
				hasLoadedSettings: settingsSnapshot.hasLoadedSettings,
				startupLayout: settingsSnapshot.startupLayout,
			})
		) {
			return;
		}
		const editorDraftStyleSnapshot = editorDraftStyleService.getSnapshot();
		const {
			hasLoadedSettings,
			systemNotificationsEnabled,
			warningNotificationsEnabled,
			menuBarIconEnabled,
			completionNotificationsEnabled,
			statusbarVisible,
			startupLayout,
			browserTabKeepAliveLimit,
			browserMaxHistoryEntries,
			browserPageZoom,
			browserSearchEngine,
			useMica,
			theme,
			workbenchColorCustomizations,
			knowledgeBaseEnabled,
			autoIndexDownloadedPdf,
			knowledgeBasePdfDownloadDir,
			libraryStorageMode,
			libraryDirectory,
			maxConcurrentIndexJobs,
			activeRagProvider,
			ragProviders,
			retrievalCandidateCount,
			retrievalTopK,
			pdfDownloadDir,
			pdfFileNameUseSelectionOrder,
			activeLlmProvider,
			llmProviders,
			activeTranslationProvider,
			translationProviders,
			configPath,
			defaultConfigPath,
			isSettingsLoading,
			isSettingsSaving,
			isTestingRagConnection,
			isTestingLlmConnection,
			isTestingTranslationConnection,
			isLoadingTranslationModels,
		} = settingsSnapshot;
		this.syncBrowserSettings({
			browserMaxHistoryEntries,
			browserPageZoom,
			browserSearchEngine,
		});
		applyWorkbenchTheme(theme, workbenchColorCustomizations);
		applyWorkbenchBrowserStyles();
		const libraryModelInstance = getWorkbenchLibraryModel({
			desktopRuntime,
			invokeDesktop,
		});
		const { librarySnapshot, isLibraryLoading } =
			libraryModelInstance.getSnapshot();
		const refreshLibrary = () => {
			void libraryModelInstance.refresh();
		};

		const activeEditor = this.editorGroupsService.activeGroup.activeEditor;
		const activeBrowserEditor = activeEditor instanceof BrowserEditorInput
			? activeEditor
			: undefined;
		const browserViewId = activeBrowserEditor?.id ?? '';
		const browserUrl = activeBrowserEditor?.url ?? '';
		const browserPageTitle = activeEditor?.getName() ?? '';
		const handleOpenEditor: EditorOpenHandler = (input, options) =>
			this.editorService.openEditor(input, options);

		const activeDraftInput = this.draftEditorService.activeInput;
		const activeDraftDocument = activeDraftInput
			? this.draftEditorService.getDocument(activeDraftInput.resource)
			: null;
		const activeDraftExport =
			activeDraftDocument
				? {
					title: activeEditor?.getName() ?? '',
					document: activeDraftDocument,
					editorDraftStyle: {
						defaultBodyStyle: {
							...editorDraftStyleSnapshot.defaultBodyStyle,
							inlineStyleDefaults: {
								...editorDraftStyleSnapshot.defaultBodyStyle.inlineStyleDefaults,
							},
						},
					},
				}
				: null;

		this.openerService.setDefaultExternalOpener({
			openExternal: async (href, { sourceUri }) => {
				if (sourceUri.scheme !== Schemas.http && sourceUri.scheme !== Schemas.https) {
					return false;
				}

				const browserLinkUrl = normalizeUrl(href);
				if (!browserLinkUrl) {
					return false;
				}

				handleOpenEditor({
					resource: BrowserViewUri.forId(generateUuid()),
					options: {
						viewState: {
							url: browserLinkUrl,
						},
					},
				});
				return true;
			},
		});
		const articleSummaryTranslationExportControllerInstance =
			getWorkbenchArticleSummaryTranslationExportController(
				{
					desktopRuntime,
					invokeDesktop,
					nativeHost,
					notificationService: this.notificationService,
					dialogService: this.dialogService,
					locale,
					ui,
					pdfDownloadDir,
				},
				this.fetchService,
			);

		const documentActionsControllerInstance =
			getWorkbenchDocumentActionsController(
				{
					desktopRuntime,
					invokeDesktop,
					notificationService: this.notificationService,
					locale,
					ui,
					knowledgeBaseEnabled,
					pdfDownloadDir,
					knowledgeBasePdfDownloadDir,
					pdfFileNameUseSelectionOrder,
					getExportableArticleSelection: this.getActiveChatArticleSelection,
					onUnavailableArticleIds: this.removeChatArticleChecks,
					onOpenEditor: handleOpenEditor,
					onExportArticleSummaries:
						articleSummaryTranslationExportControllerInstance.handleExportArticleSummaries,
					activeDraftExport,
					onLibraryDocumentUpserted:
						libraryModelInstance.upsertDocumentSummary,
					onLibraryUpdated: refreshLibrary,
				},
				this.fetchService,
			);

		const focusWorkbenchWebUrlInput = () => {
			handleOpenEditor({
				resource: BrowserViewUri.forId(generateUuid()),
			});
			this.editorGroupsService.mainPart.focusPrimaryInput();
		};
		const editorBrowserToolbarActions = createEditorBrowserToolbarActions({
			browserViewId,
			browserUrl,
			invokeDesktop,
			notificationService: this.notificationService,
			knowledgeBaseEnabled,
			ui,
			onLibraryUpdated: refreshLibrary,
			onOpenAddressBarSourceMenu: focusWorkbenchWebUrlInput,
			onToolbarExportDocx: () => {
				void documentActionsControllerInstance.handleExportDocx();
			},
		});
		this.browserEditorToolbarService.setActions(editorBrowserToolbarActions);
		this.collapsedEditorTitlebarActionsView.setProps({
			contextMenuService: this.contextMenuService,
				contextViewProvider: this.contextViewService,
				isEditorCollapsed: true,
				labels: {
				headerAddAction: ui.editorHeaderAddAction,
				expandEditor: ui.editorExpand,
				collapseEditor: ui.editorCollapse,
			},
			creationActions: getEditorCreationActions(ui),
			commandService: this.commandService,
			onToggleEditorCollapse: this.toggleEditorCollapsed,
		});

		syncWorkbenchServicesContext({
			settingsController: settingsControllerInstance,
			settingsContext: {
				desktopRuntime,
				invokeDesktop,
				notificationService: this.notificationService,
				ui,
				locale,
			},
			libraryModel: libraryModelInstance,
			libraryContext: {
				desktopRuntime,
				invokeDesktop,
			},
			articleSummaryTranslationExportController:
				articleSummaryTranslationExportControllerInstance,
			articleSummaryTranslationExportContext: {
				desktopRuntime,
				invokeDesktop,
				nativeHost,
				notificationService: this.notificationService,
				dialogService: this.dialogService,
				locale,
				ui,
				pdfDownloadDir,
			},
			documentActionsController: documentActionsControllerInstance,
			documentActionsContext: {
				desktopRuntime,
				invokeDesktop,
				notificationService: this.notificationService,
				locale,
				ui,
				knowledgeBaseEnabled,
				pdfDownloadDir,
				knowledgeBasePdfDownloadDir,
				pdfFileNameUseSelectionOrder,
				getExportableArticleSelection: this.getActiveChatArticleSelection,
				onUnavailableArticleIds: this.removeChatArticleChecks,
				onOpenEditor: handleOpenEditor,
				onExportArticleSummaries:
					articleSummaryTranslationExportControllerInstance.handleExportArticleSummaries,
				activeDraftExport,
				onLibraryUpdated: refreshLibrary,
			},
		});

		this.ensureServiceSubscriptions({
			settingsController: settingsControllerInstance,
			libraryModel: libraryModelInstance,
			articleSummaryTranslationExportController:
				articleSummaryTranslationExportControllerInstance,
			documentActionsController: documentActionsControllerInstance,
		});

		const titlebarLeadingActionsProps = createTitlebarLeadingActionsProps({
			ui,
			isPrimarySidebarVisible: isSidebarVisible,
			onTogglePrimarySidebar: this.togglePrimarySidebarVisibility,
			onFocusAddressBar: focusWorkbenchWebUrlInput,
		});
		const settingsPartProps = createSettingsPartProps({
			state: {
				ui,
				isSettingsLoading,
				locale,
				supportedSources: this.fetchService.getJournals(),
				systemNotificationsEnabled,
				warningNotificationsEnabled,
				menuBarIconEnabled,
				completionNotificationsEnabled,
				useMica,
				statusbarVisible,
				startupLayout,
				browserTabKeepAliveLimit,
				browserMaxHistoryEntries,
				browserPageZoom,
				browserSearchEngine,
				theme,
				editorDraftStyle: {
					defaultValue: {
						defaultBodyStyle: {
							...settingsSnapshot.editorDraftStyle.defaultValue.defaultBodyStyle,
							inlineStyleDefaults: {
								...settingsSnapshot.editorDraftStyle.defaultValue.defaultBodyStyle.inlineStyleDefaults,
							},
						},
					},
					userValue: settingsSnapshot.editorDraftStyle.userValue
						? {
							defaultBodyStyle: {
								...settingsSnapshot.editorDraftStyle.userValue.defaultBodyStyle,
								inlineStyleDefaults: {
									...settingsSnapshot.editorDraftStyle.userValue.defaultBodyStyle.inlineStyleDefaults,
								},
							},
						}
						: null,
					value: {
						defaultBodyStyle: {
							...editorDraftStyleSnapshot.defaultBodyStyle,
							inlineStyleDefaults: {
								...editorDraftStyleSnapshot.defaultBodyStyle.inlineStyleDefaults,
							},
						},
					},
				},
				editorDraftFontFamilyOptions: editorDraftStyleSnapshot.fontFamilyPresets,
				editorDraftFontSizeOptions: editorDraftStyleSnapshot.fontSizePresets,
				knowledgeBaseEnabled,
				autoIndexDownloadedPdf,
				knowledgeBasePdfDownloadDir,
				libraryStorageMode,
				libraryDirectory,
				maxConcurrentIndexJobs,
				activeRagProvider,
				ragProviders,
				retrievalCandidateCount,
				retrievalTopK,
				pdfDownloadDir,
				pdfFileNameUseSelectionOrder,
				activeLlmProvider,
				llmProviders,
				activeTranslationProvider,
				translationProviders,
				desktopRuntime,
				configPath,
				defaultConfigPath,
				isLibraryLoading,
				libraryDocumentCount: librarySnapshot.totalCount,
				libraryFileCount: librarySnapshot.fileCount,
				libraryQueuedJobCount: librarySnapshot.queuedJobCount,
				libraryDocuments: librarySnapshot.items,
				libraryDbFile: librarySnapshot.libraryDbFile,
				defaultManagedDirectory: librarySnapshot.defaultManagedDirectory,
				ragCacheDir: librarySnapshot.ragCacheDir,
				isSettingsSaving,
				isTestingRagConnection,
				isTestingLlmConnection,
				isTestingTranslationConnection,
				isLoadingTranslationModels,
			},
			actions: {
				onSystemNotificationsEnabledChange:
					settingsControllerInstance.setSystemNotificationsEnabled,
				onWarningNotificationsEnabledChange:
					settingsControllerInstance.setWarningNotificationsEnabled,
				onMenuBarIconEnabledChange:
					settingsControllerInstance.setMenuBarIconEnabled,
				onCompletionNotificationsEnabledChange:
					settingsControllerInstance.setCompletionNotificationsEnabled,
				onUseMicaChange: settingsControllerInstance.setUseMica,
				onStatusbarVisibleChange: settingsControllerInstance.setStatusbarVisible,
				onStartupLayoutChange: settingsControllerInstance.setStartupLayout,
				onBrowserTabKeepAliveLimitChange: (value) =>
					settingsControllerInstance.setBrowserTabKeepAliveLimit(
						normalizeBrowserTabKeepAliveLimit(value, browserTabKeepAliveLimit),
					),
				onBrowserMaxHistoryEntriesChange: (value) =>
					settingsControllerInstance.setBrowserMaxHistoryEntries(
						Math.min(
							maxBrowserMaxHistoryEntries,
							Math.max(
								minBrowserMaxHistoryEntries,
								Number.parseInt(String(value), 10) || minBrowserMaxHistoryEntries,
							),
						),
					),
				onBrowserPageZoomChange: settingsControllerInstance.setBrowserPageZoom,
				onBrowserSearchEngineChange: settingsControllerInstance.setBrowserSearchEngine,
				onThemeChange: settingsControllerInstance.setTheme,
				onEditorDraftFontFamilyChange:
					settingsControllerInstance.setEditorDraftFontFamily,
				onEditorDraftFontSizeChange:
					settingsControllerInstance.setEditorDraftFontSize,
				onEditorDraftLineHeightChange:
					settingsControllerInstance.setEditorDraftLineHeightFromInput,
				onEditorDraftParagraphSpacingBeforeChange:
					settingsControllerInstance.setEditorDraftParagraphSpacingBeforePtFromInput,
				onEditorDraftParagraphSpacingAfterChange:
					settingsControllerInstance.setEditorDraftParagraphSpacingAfterPtFromInput,
				onEditorDraftColorChange: settingsControllerInstance.setEditorDraftColor,
				onResetEditorDraftStyle:
					settingsControllerInstance.handleResetEditorDraftStyle,
				onKnowledgeBaseEnabledChange: settingsControllerInstance.setKnowledgeBaseEnabled,
				onAutoIndexDownloadedPdfChange:
					settingsControllerInstance.setAutoIndexDownloadedPdf,
				onKnowledgeBasePdfDownloadDirChange:
					settingsControllerInstance.setKnowledgeBasePdfDownloadDir,
				onChooseKnowledgeBasePdfDownloadDir:
					settingsControllerInstance.handleChooseKnowledgeBasePdfDownloadDir,
				onLibraryStorageModeChange:
					settingsControllerInstance.setLibraryStorageMode,
				onLibraryDirectoryChange: settingsControllerInstance.setLibraryDirectory,
				onMaxConcurrentIndexJobsChange: (value) =>
					settingsControllerInstance.setMaxConcurrentIndexJobs(
						Math.min(4, Math.max(1, Number.parseInt(String(value), 10) || 1)),
					),
				onRagProviderApiKeyChange: settingsControllerInstance.setRagProviderApiKey,
				onRagProviderBaseUrlChange:
					settingsControllerInstance.setRagProviderBaseUrl,
				onRagProviderEmbeddingModelChange:
					settingsControllerInstance.setRagProviderEmbeddingModel,
				onRagProviderRerankerModelChange:
					settingsControllerInstance.setRagProviderRerankerModel,
				onRagProviderEmbeddingPathChange:
					settingsControllerInstance.setRagProviderEmbeddingPath,
				onRagProviderRerankPathChange:
					settingsControllerInstance.setRagProviderRerankPath,
				onRetrievalCandidateCountChange: (value) =>
					settingsControllerInstance.setRetrievalCandidateCount(
						Math.min(
							20,
							Math.max(3, Number.parseInt(String(value), 10) || 10),
						),
					),
				onRetrievalTopKChange: (value) =>
					settingsControllerInstance.setRetrievalTopK(
						Math.min(
							retrievalCandidateCount,
							Math.max(1, Number.parseInt(String(value), 10) || 4),
						),
					),
				onPdfDownloadDirChange: settingsControllerInstance.setPdfDownloadDir,
				onPdfFileNameUseSelectionOrderChange:
					settingsControllerInstance.setPdfFileNameUseSelectionOrder,
				onChooseLibraryDirectory: () =>
					void settingsControllerInstance.handleChooseLibraryDirectory(),
				onChoosePdfDownloadDir: () =>
					void settingsControllerInstance.handleChoosePdfDownloadDir(),
				onActiveLlmProviderChange: settingsControllerInstance.setActiveLlmProvider,
				onLlmProviderApiKeyChange: settingsControllerInstance.setLlmProviderApiKey,
				onLlmProviderModelChange: settingsControllerInstance.setLlmProviderModel,
				onLlmProviderSelectedModelOption:
					settingsControllerInstance.setLlmProviderSelectedModelOption,
				onLlmProviderReasoningEffortChange:
					settingsControllerInstance.setLlmProviderReasoningEffort,
				onLlmProviderModelEnabledChange:
					settingsControllerInstance.setLlmProviderModelEnabled,
				onLlmProviderUseMaxContextWindowChange:
					settingsControllerInstance.setLlmProviderUseMaxContextWindow,
				onActiveTranslationProviderChange:
					settingsControllerInstance.setActiveTranslationProvider,
				onTranslationProviderApiKeyChange:
					settingsControllerInstance.setTranslationProviderApiKey,
				onTranslationProviderBaseUrlChange:
					settingsControllerInstance.setTranslationProviderBaseUrl,
				onTranslationProviderModelChange:
					settingsControllerInstance.setTranslationProviderModel,
				onTestRagConnection: () =>
					void settingsControllerInstance.handleTestRagConnection(),
				onTestLlmConnection: () =>
					void settingsControllerInstance.handleTestLlmConnection(),
				onFetchTranslationModels: () =>
					void settingsControllerInstance.handleFetchTranslationModels(),
				onTestTranslationConnection: () =>
					void settingsControllerInstance.handleTestTranslationConnection(),
				onChooseConfigPath: () =>
					void settingsControllerInstance.handleChooseConfigPath(),
				onResetConfigPath: settingsControllerInstance.handleResetConfigPath,
				onResetKnowledgeBaseSettings:
					settingsControllerInstance.handleResetKnowledgeBaseSettings,
				onResetDownloadDir: settingsControllerInstance.handleResetDownloadDir,
			},
		});

		syncWorkbenchWindowTitle({
			appName: ui.appName,
			activeEditor,
			browserPageTitle,
		});

		this.renderWorkbenchContentPage({
			isLayoutEdgeSnappingEnabled: isWindowFullscreen,
			sidebarFooterActionsProps: createSidebarFooterTitlebarActionsProps({
				ui,
				isSettingsActive: this.settingsOverlayVisible,
				isAgentSidebarVisible: isAgentMode,
				isEditorCollapsed,
				onApplyLayoutAgent: this.applyAgentLayout,
				onApplyLayoutFlow: this.applyFlowLayout,
				onOpenSettings: this.toggleSettingsPage,
			}),
			collapsedEditorTitlebarActionsElement:
				this.collapsedEditorTitlebarActionsView.getElement(),
		});
		this.renderSettingsOverlay({ settingsPartProps });

		this.titlebarPart.sync({
			electronRuntime,
			useMica,
			statusbarVisible: hasLoadedSettings && statusbarVisible,
			isEditorVisible: !isEditorCollapsed,
			leadingActions: titlebarLeadingActionsProps,
		});

		this.lifecycleService.setPhase(LifecyclePhase.Restored);

	}
}

class SessionsWorkbenchApplication {
	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
	) {}

	async start(): Promise<void> {
		await this.storageService.init();
		this.editorGroupsService.initialize();
		startWorkbenchContributions();
		window.addEventListener('beforeunload', () => {
			void this.storageService.flush(WillSaveStateReason.SHUTDOWN);
			stopWorkbenchContributions();
		}, {
			once: true,
		});
		renderSessionsWorkbench();
	}
}

export function disposeSessionsWorkbenchServices() {
	settingsController?.dispose();
	settingsController = null;

	libraryModel?.dispose();
	libraryModel = null;

	articleSummaryTranslationExportController?.dispose();
	articleSummaryTranslationExportController = null;

	documentActionsController?.dispose();
	documentActionsController = null;

}

export function getWorkbenchSettingsController(
	instantiationService: IInstantiationService,
	context: SettingsControllerContext,
) {
	if (!settingsController) {
		settingsController = instantiationService.createInstance(
			SettingsController,
			context,
		);
		settingsController.start();
	}
	return settingsController;
}

export function getWorkbenchLibraryModel(context: LibraryModelContext) {
	if (!libraryModel) {
		libraryModel = createLibraryModel(context);
		libraryModel.start();
	}
	return libraryModel;
}

export function getWorkbenchArticleSummaryTranslationExportController(
	context: ArticleSummaryTranslationExportControllerContext,
	fetchService: IFetchService,
) {
	articleSummaryTranslationExportController ??=
		createArticleSummaryTranslationExportController(context, fetchService);
	return articleSummaryTranslationExportController;
}

export function getWorkbenchDocumentActionsController(
	context: DocumentActionsControllerContext,
	fetchService: IFetchService,
) {
	documentActionsController ??= createDocumentActionsController(context, fetchService);
	return documentActionsController;
}

export function syncWorkbenchServicesContext({
	settingsController: settingsControllerInstance,
	settingsContext,
	libraryModel: libraryModelInstance,
	libraryContext,
	articleSummaryTranslationExportController:
	articleSummaryTranslationExportControllerInstance,
	articleSummaryTranslationExportContext,
	documentActionsController: documentActionsControllerInstance,
	documentActionsContext,
}: WorkbenchServicesSyncParams) {
	settingsControllerInstance.setContext(settingsContext);
	libraryModelInstance.setContext(libraryContext);
	articleSummaryTranslationExportControllerInstance.setContext(
		articleSummaryTranslationExportContext,
	);
	documentActionsControllerInstance.setContext(documentActionsContext);
}

export function disposeSessionsWorkbench(): void {
	activeSessionsWorkbenchHost?.dispose();
	activeSessionsWorkbenchHost = null;
	disposeSessionsWorkbenchServices();
}

function renderSessionsWorkbench() {
	const rootElement = document.getElementById('root');

	if (!rootElement) {
		throw new Error('Root element #root was not found.');
	}

	applyWorkbenchTheme();
	applyWorkbenchBrowserStyles();
	setARIAContainer(document.body);

	activeSessionsWorkbenchHost?.dispose();
	activeSessionsWorkbenchHost = null;

	activeSessionsWorkbenchHost = getWorkbenchInstantiationService().createInstance(
		SessionsWorkbenchHost,
		rootElement,
	);
	activeSessionsWorkbenchHost.start();
}

export async function startSessionsWorkbench(): Promise<void> {
	const application = getWorkbenchInstantiationService().createInstance(
		SessionsWorkbenchApplication,
	);
	await application.start();
}
