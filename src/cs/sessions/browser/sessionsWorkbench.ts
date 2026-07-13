/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'cs/base/common/network';
import { $, addDisposableListener } from 'cs/base/browser/dom';
import { onUnexpectedError } from 'cs/base/common/errors';
import {
	registerWorkbenchPartDomNode,
} from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';
import { SessionsLayoutView } from 'cs/sessions/browser/layout';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import { ISessionsSettingsOverlayService } from 'cs/sessions/services/settings/browser/settingsOverlayService';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { generateUuid } from 'cs/base/common/uuid';

import { SessionsTitlebarPart } from 'cs/sessions/browser/parts/titlebar/titlebarPart';
import { syncWorkbenchWindowTitle } from 'cs/workbench/browser/parts/titlebar/windowTitle';
import { SettingsPartView } from 'cs/workbench/contrib/preferences/browser/settingsEditor';

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

import { setARIAContainer } from 'cs/base/browser/ui/aria/aria';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	toDisposable,
} from 'cs/base/common/lifecycle';
import { INotificationService } from 'cs/platform/notification/common/notification';
import {
	IStorageService,
	WillSaveStateReason,
} from 'cs/platform/storage/common/storage';
import {
	disposeWorkbenchInstantiationService,
	getWorkbenchInstantiationService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import {
	IEditorService,
} from 'cs/workbench/services/editor/common/editorService';
import { NotificationsAlerts } from 'cs/workbench/browser/parts/notifications/notificationsAlerts';
import { NotificationsCenter } from 'cs/workbench/browser/parts/notifications/notificationsCenter';
import { NotificationsStatus } from 'cs/workbench/browser/parts/notifications/notificationsStatus';
import { NotificationsToasts } from 'cs/workbench/browser/parts/notifications/notificationsToasts';
import { NotificationService } from 'cs/workbench/services/notification/common/notificationService';

import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import {
	getWindowStateSnapshot,
	subscribeWindowState,
} from 'cs/workbench/browser/window';

import { normalizeUrl } from 'cs/workbench/common/url';
import type { AppStartupLayout } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { IWorkbenchConfigurationService } from 'cs/workbench/services/configuration/common/configuration';
import { ISettingsModel, type SettingsModel } from 'cs/workbench/services/settings/settingsModel';
import {
	BrowserMaxHistoryEntriesSettingId,
	BrowserPageZoomSettingId,
	BrowserSearchEngineSettingId,
} from 'cs/base/parts/sandbox/common/browserSettings';
import { IOpenerService } from 'cs/platform/opener/common/opener';
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

class SessionsWorkbenchHost extends Disposable {
	private readonly rootElement: HTMLElement;
	private readonly containerElement: HTMLDivElement;
	private readonly shellElement: HTMLDivElement;
	private readonly pageMount: HTMLDivElement;
	private readonly settingsOverlayElement: HTMLDivElement;
	private readonly statusbarElement: HTMLElement;
	private readonly titlebarPart: SessionsTitlebarPart;
	private readonly notificationsDisposables = new DisposableStore();
	private readonly sessionsLayoutView = new MutableDisposable<SessionsLayoutView>();
	private readonly sidebarPart = new MutableDisposable<SessionSidebarPartView>();
	private readonly settingsView = new MutableDisposable<SettingsPartView>();
	private isDisposed = false;
	private hasStarted = false;
	private isRendering = false;
	private renderPending = false;
	private hasAppliedStartupLayoutPreference = false;
	private appliedBrowserSettings: {
		maxHistoryEntries: number;
		pageZoom: string;
		searchEngine: string;
	} | null = null;
	constructor(
		rootElement: HTMLElement,
		@INotificationService private readonly notificationService: NotificationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@ISettingsModel private readonly settingsModel: SettingsModel,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
		@ISessionsService private readonly sessionsService: ISessionsService,
		@ISessionsPartService private readonly sessionsPart: SessionsPart,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@ISessionsLayoutService private readonly sessionsLayoutService: ISessionsLayoutService,
		@IEditorGroupsService private readonly editorGroupsService: SessionsEditorParts,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkbenchConfigurationService private readonly configurationService: IWorkbenchConfigurationService,
		@ILifecycleService private readonly lifecycleService: IWorkbenchLifecycleService,
		@ISessionsSettingsOverlayService private readonly settingsOverlayService: ISessionsSettingsOverlayService,
		) {
		super();
		this.rootElement = rootElement;
		this.containerElement = $<HTMLDivElement>('div');
		this.shellElement = $<HTMLDivElement>('div');
		this.pageMount = $<HTMLDivElement>('div');
		this.settingsOverlayElement = $<HTMLDivElement>('div');
		this.statusbarElement = $<HTMLElementTagNameMap['section']>('section');
		this.settingsOverlayElement.className = 'comet-settings-overlay';
		this.settingsOverlayElement.hidden = true;
		this._register(this.notificationsDisposables);
		this.titlebarPart = this.instantiationService.createInstance(
			SessionsTitlebarPart,
			this.containerElement,
			this.shellElement,
			this.statusbarElement,
		);
		this._register(this.titlebarPart);
		this._register(this.settingsView);
		this._register(this.sidebarPart);
		this._register(this.sessionsLayoutView);
		this._register(addDisposableListener(this.settingsOverlayElement, 'click', event => {
			if (event.target === this.settingsOverlayElement) {
				this.settingsOverlayService.setVisible(false);
			}
		}));

		this.rootElement.replaceChildren(this.containerElement);
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

	start(): void {
		if (this.isDisposed) {
			throw new Error('Cannot start a disposed Sessions Workbench Host.');
		}
		if (this.hasStarted) {
			throw new Error('Sessions Workbench Host has already started.');
		}
		this.hasStarted = true;
		this.editorGroupsService.mainPart.initialize();
		this.openInitialDraftIfUnambiguous();
		this._register(toDisposable(this.localeService.subscribe(this.requestRender)));
		this._register(this.sessionsLayoutService.onDidChangeLayoutState(this.requestRender));
		this._register(toDisposable(subscribeWindowState(this.requestRender)));
		this._register(toDisposable(this.settingsModel.subscribe(this.requestRender)));
		this._register(this.editorGroupsService.onDidChange(this.requestRender));
		this._register(this.settingsOverlayService.onDidChangeVisibility(this.requestRender));

		this.requestRender();
	}

	override dispose(): void {
		if (this.isDisposed) {
			return;
		}

		this.isDisposed = true;
		try {
			super.dispose();
		} finally {
			registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.container, null);
			registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.settings, null);
			this.rootElement.replaceChildren();
		}
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

	private renderWorkbenchContentPage(isLayoutEdgeSnappingEnabled: boolean) {
		let sidebarPart = this.sidebarPart.value;
		if (!sidebarPart) {
			sidebarPart = this.instantiationService.createInstance(SessionSidebarPartView);
			this.sidebarPart.value = sidebarPart;
		}

		let sessionsLayoutView = this.sessionsLayoutView.value;
		if (!sessionsLayoutView) {
			sessionsLayoutView = this.instantiationService.createInstance(
				SessionsLayoutView,
				isLayoutEdgeSnappingEnabled,
				sidebarPart,
				this.sessionsPart,
				this.editorGroupsService.mainPart,
			);
			this.sessionsLayoutView.value = sessionsLayoutView;
		} else {
			sessionsLayoutView.setEdgeSnappingEnabled(
				isLayoutEdgeSnappingEnabled,
			);
		}

		const workbenchContentElement = sessionsLayoutView.getElement();
		if (this.pageMount.firstChild !== workbenchContentElement) {
			this.pageMount.replaceChildren(workbenchContentElement);
		}
		sessionsLayoutView.layout();
	}


	private renderSettingsOverlay() {
		if (!this.settingsOverlayService.isVisible()) {
			this.settingsOverlayElement.hidden = true;
			registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.settings, null);
			return;
		}

		let settingsView = this.settingsView.value;
		if (!settingsView) {
			settingsView = this.instantiationService.createInstance(SettingsPartView);
			this.settingsView.value = settingsView;
			this.settingsOverlayElement.replaceChildren(settingsView.getElement());
		}
		this.settingsOverlayElement.hidden = false;
		registerWorkbenchPartDomNode(
			WORKBENCH_PART_IDS.settings,
			settingsView.getElement(),
		);
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
		const locale = this.localeService.getLocale();
		const ui = this.languageService.getLocaleMessages(locale);
		const { isFullscreen: isWindowFullscreen } = getWindowStateSnapshot();
		const settingsSnapshot = this.settingsModel.getSnapshot();
		if (
			this.applyStartupLayoutPreferenceIfNeeded({
				hasLoadedSettings: settingsSnapshot.hasLoadedSettings,
				startupLayout: settingsSnapshot.startupLayout,
			})
		) {
			return;
		}
		const {
			browserMaxHistoryEntries,
			browserPageZoom,
			browserSearchEngine,
			theme,
			workbenchColorCustomizations,
		} = settingsSnapshot;
		this.syncBrowserSettings({
			browserMaxHistoryEntries,
			browserPageZoom,
			browserSearchEngine,
		});
		applyWorkbenchTheme(theme, workbenchColorCustomizations);
		applyWorkbenchBrowserStyles();
		const activeEditor = this.editorGroupsService.activeGroup.activeEditor;
		const browserPageTitle = activeEditor?.getName() ?? '';
		this.openerService.setDefaultExternalOpener({
			openExternal: async (href, { sourceUri }) => {
				if (sourceUri.scheme !== Schemas.http && sourceUri.scheme !== Schemas.https) {
					return false;
				}

				const browserLinkUrl = normalizeUrl(href);
				if (!browserLinkUrl) {
					return false;
				}

				void this.editorService.openEditor({
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
		syncWorkbenchWindowTitle({
			appName: ui.appName,
			activeEditor,
			browserPageTitle,
		});

		this.renderWorkbenchContentPage(isWindowFullscreen);
		this.renderSettingsOverlay();

		this.lifecycleService.setPhase(LifecyclePhase.Restored);

	}
}

type SessionsWorkbenchState = 'idle' | 'starting' | 'running' | 'disposed';

let sessionsWorkbenchState: SessionsWorkbenchState = 'idle';
let activeSessionsWorkbenchApplication: SessionsWorkbenchApplication | null = null;
let sessionsWorkbenchShutdownPromise: Promise<void> | null = null;

class SessionsWorkbenchApplication extends Disposable {
	private hasStarted = false;
	private isDisposed = false;
	private isShutdownRequested = false;
	private storageInitialized = false;
	private storageInitializationSettled: Promise<void> | null = null;
	private shutdownPromise: Promise<void> | null = null;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	async start(): Promise<void> {
		if (this.hasStarted) {
			throw new Error('Sessions Workbench Application has already started.');
		}
		this.hasStarted = true;
		const storageInitialization = this.storageService.init();
		this.storageInitializationSettled = storageInitialization.then(
			() => {
				this.storageInitialized = true;
			},
			() => undefined,
		);
		await storageInitialization;
		this.ensureStartupActive();

		this.editorGroupsService.initialize();
		this.ensureStartupActive();
		this._register(toDisposable(stopWorkbenchContributions));
		startWorkbenchContributions();
		this.ensureStartupActive();

		const host = this.createHost();
		this._register(host);
		this.ensureStartupActive();
		host.start();
		this.ensureStartupActive();
		this._register(addDisposableListener(window, 'beforeunload', () => {
			void disposeSessionsWorkbench().catch(onUnexpectedError);
		}));
		this.ensureStartupActive();
	}

	shutdown(): Promise<void> {
		this.isShutdownRequested = true;
		this.shutdownPromise ??= this.doShutdown();
		return this.shutdownPromise;
	}

	override dispose(): void {
		if (this.isDisposed) {
			return;
		}

		this.isDisposed = true;
		const disposeErrors: unknown[] = [];
		try {
			super.dispose();
		} catch (error) {
			disposeErrors.push(error);
		}

		try {
			disposeWorkbenchInstantiationService();
		} catch (error) {
			disposeErrors.push(error);
		}

		if (disposeErrors.length > 1) {
			throw new AggregateError(
				disposeErrors,
				'Failed to dispose the Sessions Workbench Application and its services.',
			);
		}
		if (disposeErrors.length === 1) {
			throw disposeErrors[0];
		}
	}

	private createHost(): SessionsWorkbenchHost {
		const rootElement = document.getElementById('root');
		if (!rootElement) {
			throw new Error('Root element #root was not found.');
		}

		applyWorkbenchTheme();
		applyWorkbenchBrowserStyles();
		setARIAContainer(document.body);
		return this.instantiationService.createInstance(SessionsWorkbenchHost, rootElement);
	}

	private ensureStartupActive(): void {
		if (this.isShutdownRequested || this.isDisposed) {
			throw new Error('Sessions Workbench Application was shut down during startup.');
		}
	}

	private async doShutdown(): Promise<void> {
		if (!this.storageInitialized) {
			await this.storageInitializationSettled;
		}

		const shutdownErrors: unknown[] = [];
		if (this.storageInitialized) {
			try {
				await this.storageService.flush(WillSaveStateReason.SHUTDOWN);
			} catch (error) {
				shutdownErrors.push(error);
			}
		}

		try {
			this.dispose();
		} catch (error) {
			shutdownErrors.push(error);
		}

		if (shutdownErrors.length > 1) {
			throw new AggregateError(
				shutdownErrors,
				'Failed to save and dispose the Sessions Workbench Application.',
			);
		}
		if (shutdownErrors.length === 1) {
			throw shutdownErrors[0];
		}
	}
}

export async function startSessionsWorkbench(): Promise<void> {
	if (sessionsWorkbenchState !== 'idle') {
		throw new Error(`Sessions Workbench cannot start from state '${sessionsWorkbenchState}'.`);
	}

	sessionsWorkbenchState = 'starting';
	let application: SessionsWorkbenchApplication | null = null;
	try {
		application = getWorkbenchInstantiationService().createInstance(
			SessionsWorkbenchApplication,
		);
		activeSessionsWorkbenchApplication = application;
		await application.start();
		if (
			sessionsWorkbenchState !== 'starting'
			|| activeSessionsWorkbenchApplication !== application
		) {
			throw new Error('Sessions Workbench shutdown started before startup completed.');
		}
		sessionsWorkbenchState = 'running';
	} catch (error) {
		activeSessionsWorkbenchApplication = null;
		sessionsWorkbenchState = 'disposed';
		if (!application) {
			try {
				disposeWorkbenchInstantiationService();
			} catch (disposeError) {
				throw new AggregateError(
					[error, disposeError],
					'Sessions Workbench construction and service disposal both failed.',
				);
			}
			throw error;
		}

		sessionsWorkbenchShutdownPromise ??= application.shutdown();
		try {
			await sessionsWorkbenchShutdownPromise;
		} catch (shutdownError) {
			throw new AggregateError(
				[error, shutdownError],
				'Sessions Workbench startup and shutdown both failed.',
			);
		}
		throw error;
	}
}

export function disposeSessionsWorkbench(): Promise<void> {
	if (sessionsWorkbenchShutdownPromise) {
		return sessionsWorkbenchShutdownPromise;
	}
	if (sessionsWorkbenchState === 'idle') {
		return Promise.resolve();
	}

	sessionsWorkbenchState = 'disposed';
	const application = activeSessionsWorkbenchApplication;
	activeSessionsWorkbenchApplication = null;
	sessionsWorkbenchShutdownPromise = application?.shutdown() ?? Promise.resolve();
	return sessionsWorkbenchShutdownPromise;
}
