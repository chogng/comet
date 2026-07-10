/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { BrowserSearchEngineSettingId } from 'cs/base/parts/sandbox/common/browserSettings';
import { Codicon } from 'cs/base/common/codicons';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { MenuWorkbenchToolBar } from 'cs/platform/actions/browser/toolbar';
import { Action2, MenuId, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import { IConfigurationService } from 'cs/platform/configuration/common/configuration';
import {
	RawContextKey,
	type ContextKey,
	IContextKeyService,
} from 'cs/platform/contextkey/common/contextkey';
import { IHoverService } from 'cs/platform/hover/browser/hover';
import { IInstantiationService, type ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { IOpenerService } from 'cs/platform/opener/common/opener';
import { localize, localize2 } from 'cs/nls';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BROWSER_SEARCH_NONE,
	BrowserSearchEngineId,
	buildSearchUrl,
	getBrowserSearchEngineLabel,
	resolveAddressBarInputType,
} from 'cs/workbench/contrib/browserView/common/browserSearch';
import {
	BrowserActionCategory,
	BrowserActionGroup,
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	CONTEXT_BROWSER_FOCUSED,
	CONTEXT_BROWSER_HAS_URL,
	type IBrowserEditorWidget,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { BrowserUrlBarWidget, type IBrowserUrlBarHost, type IUrlPickerItem } from 'cs/workbench/contrib/browserView/electron-browser/widgets/browserUrlBarWidget';

const CONTEXT_BROWSER_CAN_GO_BACK = new RawContextKey<boolean>('browserCanGoBack', false);
const CONTEXT_BROWSER_CAN_GO_FORWARD = new RawContextKey<boolean>('browserCanGoForward', false);

class BrowserNavigationBar {
	readonly element: HTMLElement;
	private readonly navActionsContainer: HTMLElement;
	private readonly browserActionsContainer: HTMLElement;
	private readonly urlBar: BrowserUrlBarWidget;
	private readonly navToolbar: MenuWorkbenchToolBar;
	private readonly browserActionsToolbar: MenuWorkbenchToolBar;
	private readonly scopedInstantiationService: IInstantiationService;

	constructor(
		editor: BrowserEditor,
		instantiationService: IInstantiationService,
		scopedContextKeyService: IContextKeyService,
		private readonly configurationService: IConfigurationService,
		hoverService: IHoverService,
	) {
		this.element = $('.browser-navbar');
		this.navActionsContainer = $('.browser-nav-toolbar');
		this.browserActionsContainer = $('.browser-actions-toolbar');
		this.scopedInstantiationService = instantiationService.createChild(new ServiceCollection(
			[IContextKeyService, scopedContextKeyService],
		));

		const urlBarHost: IBrowserUrlBarHost = {
			get input() {
				return editor.input instanceof BrowserEditorInput ? editor.input : undefined;
			},
			ensureBrowserFocus: () => editor.ensureBrowserFocus(),
			getPrimaryActions: text => this.resolvePrimaryActions(text),
			getPlaceholder: () => this.searchEngine
				? localize({ key: 'browser.urlOrSearchPlaceholder', comment: ['Placeholder text shown in the integrated browser address bar when it is empty.'] }, "Search or enter URL")
				: localize('browser.urlPlaceholder', "Enter a URL"),
		};
		this.urlBar = instantiationService.createInstance(BrowserUrlBarWidget, urlBarHost);

		this.navToolbar = this.scopedInstantiationService.createInstance(
			MenuWorkbenchToolBar,
			this.navActionsContainer,
			MenuId.BrowserNavigationToolbar,
			{
				hoverDelegate: hoverService,
				highlightToggledItems: true,
				toolbarOptions: { primaryGroup: () => true, useSeparatorsInPrimaryActions: true },
				menuOptions: { shouldForwardArgs: true },
			},
		);
		this.navToolbar.context = editor;
		this.browserActionsToolbar = this.scopedInstantiationService.createInstance(
			MenuWorkbenchToolBar,
			this.browserActionsContainer,
			MenuId.BrowserActionsToolbar,
			{
				hoverDelegate: hoverService,
				highlightToggledItems: true,
				toolbarOptions: { primaryGroup: () => true, useSeparatorsInPrimaryActions: true },
				menuOptions: { shouldForwardArgs: true },
			},
		);
		this.browserActionsToolbar.context = editor;
		this.element.append(this.navActionsContainer, this.urlBar.element, this.browserActionsContainer);
	}

	dispose(): void {
		this.navToolbar.dispose();
		this.browserActionsToolbar.dispose();
		this.urlBar.dispose();
		this.scopedInstantiationService.dispose();
		this.element.replaceChildren();
	}

	mountContributions(contributions: readonly BrowserEditorContribution[]): void {
		this.urlBar.mountContributions(contributions);
	}

	refreshUrl(): void {
		this.urlBar.refreshUrl();
	}

	previewUrl(url: string): void {
		this.urlBar.previewUrl(url);
	}

	focusUrlInput(): void {
		this.urlBar.focusUrlInput();
	}

	openUrlPicker(): void {
		this.urlBar.openUrlPicker();
	}

	clear(): void {
		this.urlBar.clear();
	}

	private get searchEngine(): BrowserSearchEngineId | undefined {
		const value = this.configurationService.getValue<string>(BrowserSearchEngineSettingId);
		return value && value !== BROWSER_SEARCH_NONE ? value as BrowserSearchEngineId : undefined;
	}

	private resolvePrimaryActions(text: string): IUrlPickerItem[] {
		const goTo: IUrlPickerItem = {
			id: `goto:${text}`,
			label: text,
			apply: input => input.navigate(text),
		};
		const engineId = this.searchEngine;
		if (!engineId) {
			return [goTo];
		}

		const search: IUrlPickerItem = {
			id: `search:${text}`,
			label: localize('browser.searchFor', "{0} - {1} Search", text, getBrowserSearchEngineLabel(engineId)),
			apply: input => input.navigate(buildSearchUrl(text, engineId), { source: 'searchInput' }),
		};
		switch (resolveAddressBarInputType(text)) {
			case 'url':
				return [goTo, search];
			case 'query':
				return [search];
			default:
				return [search, goTo];
		}
	}

}

export class BrowserNavigationFeatures extends BrowserEditorContribution {
	private readonly navbar: BrowserNavigationBar;
	private readonly canGoBackContext: ContextKey<boolean>;
	private readonly canGoForwardContext: ContextKey<boolean>;

	constructor(
		editor: BrowserEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService scopedContextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IHoverService hoverService: IHoverService,
	) {
		super(editor);
		this.canGoBackContext = CONTEXT_BROWSER_CAN_GO_BACK.bindTo(scopedContextKeyService);
		this.canGoForwardContext = CONTEXT_BROWSER_CAN_GO_FORWARD.bindTo(scopedContextKeyService);
		this.navbar = this._register(new BrowserNavigationBar(editor, instantiationService, scopedContextKeyService, configurationService, hoverService));
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [{
			location: BrowserWidgetLocation.Toolbar,
			element: this.navbar.element,
			order: 0,
		}];
	}

	override prerenderInput(input: BrowserEditorInput): void {
		this.canGoBackContext.set(false);
		this.canGoForwardContext.set(false);
		this.navbar.refreshUrl();
		if (input.url) {
			this.navbar.previewUrl(input.url);
		}
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore, isNew: boolean): void {
		this.refreshNavigationState(model);
		this.navbar.refreshUrl();

		store.add(model.onWillNavigate(url => {
			this.navbar.previewUrl(url);
		}));
		store.add(model.onDidNavigate(() => {
			this.refreshNavigationState(model);
			this.navbar.refreshUrl();
		}));
		if (isNew && !model.url) {
			this.navbar.focusUrlInput();
		}
	}

	override onModelDetached(): void {
		this.canGoBackContext.reset();
		this.canGoForwardContext.reset();
		this.navbar.clear();
	}

	override onContainerCreated(): void {
		this.navbar.mountContributions([...this.editor.getContributions()]);
	}

	override tryFocus(): boolean {
		if (!this.editor.model?.url) {
			this.navbar.focusUrlInput();
			return true;
		}
		return false;
	}

	focusUrlInput(): void {
		this.navbar.focusUrlInput();
	}

	openUrlPicker(): void {
		this.navbar.openUrlPicker();
	}

	private refreshNavigationState(model: IBrowserViewModel): void {
		this.canGoBackContext.set(model.canGoBack);
		this.canGoForwardContext.set(model.canGoForward);
	}
}

BrowserEditor.registerContribution(BrowserNavigationFeatures);

function getBrowserEditor(candidate: unknown): BrowserEditor | undefined {
	return candidate instanceof BrowserEditor ? candidate : undefined;
}

class BrowserGoBackAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.GoBack,
			title: localize2('browser.goBackAction', "Back"),
			category: BrowserActionCategory,
			icon: Codicon.arrowLeft,
			menu: {
				id: MenuId.BrowserNavigationToolbar,
				group: BrowserActionGroup.Tabs,
				order: 10,
				when: CONTEXT_BROWSER_CAN_GO_BACK.isEqualTo(true),
			},
		});
	}

	run(_accessor: ServicesAccessor, browserEditor?: unknown): void {
		void getBrowserEditor(browserEditor)?.model?.goBack();
	}
}

class BrowserGoForwardAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.GoForward,
			title: localize2('browser.goForwardAction', "Forward"),
			category: BrowserActionCategory,
			icon: Codicon.arrowRight,
			menu: {
				id: MenuId.BrowserNavigationToolbar,
				group: BrowserActionGroup.Tabs,
				order: 20,
				when: CONTEXT_BROWSER_CAN_GO_FORWARD.isEqualTo(true),
			},
		});
	}

	run(_accessor: ServicesAccessor, browserEditor?: unknown): void {
		void getBrowserEditor(browserEditor)?.model?.goForward();
	}
}

class BrowserReloadAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.Reload,
			title: localize2('browser.reloadAction', "Reload"),
			category: BrowserActionCategory,
			icon: Codicon.refresh,
			menu: {
				id: MenuId.BrowserNavigationToolbar,
				group: BrowserActionGroup.Tabs,
				order: 30,
				when: CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyR,
				when: CONTEXT_BROWSER_FOCUSED.isEqualTo(true),
			},
		});
	}

	run(_accessor: ServicesAccessor, browserEditor?: unknown): void {
		void getBrowserEditor(browserEditor)?.model?.reload();
	}
}

class BrowserHardReloadAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.HardReload,
			title: localize2('browser.hardReloadAction', "Hard Reload"),
			category: BrowserActionCategory,
			icon: Codicon.debugRestart,
			menu: {
				id: MenuId.BrowserNavigationToolbar,
				group: BrowserActionGroup.Tabs,
				order: 40,
				when: CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyR,
				when: CONTEXT_BROWSER_FOCUSED.isEqualTo(true),
			},
		});
	}

	run(_accessor: ServicesAccessor, browserEditor?: unknown): void {
		void getBrowserEditor(browserEditor)?.model?.reload(true);
	}
}

class BrowserFocusUrlInputAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.FocusUrlInput,
			title: localize2('browser.focusUrlInputAction', "Focus URL Input"),
			category: BrowserActionCategory,
			icon: Codicon.search,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyL,
				when: CONTEXT_BROWSER_FOCUSED.isEqualTo(true),
			},
		});
	}

	run(_accessor: ServicesAccessor, browserEditor?: unknown): void {
		getBrowserEditor(browserEditor)?.getContribution(BrowserNavigationFeatures)?.openUrlPicker();
	}
}

class BrowserOpenExternalAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.OpenExternal,
			title: localize2('browser.openExternalAction', "Open in External Browser"),
			category: BrowserActionCategory,
			icon: Codicon.linkExternal,
			f1: true,
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Tools,
				order: 10,
				when: CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
			},
		});
	}

	async run(accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		const url = getBrowserEditor(browserEditor)?.model?.url;
		if (url) {
			await accessor.get(IOpenerService).open(url, { openExternal: true });
		}
	}
}

registerAction2(BrowserGoBackAction);
registerAction2(BrowserGoForwardAction);
registerAction2(BrowserReloadAction);
registerAction2(BrowserHardReloadAction);
registerAction2(BrowserFocusUrlInputAction);
registerAction2(BrowserOpenExternalAction);
