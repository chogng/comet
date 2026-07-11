/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'cs/base/common/event';
import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';
import { Schemas } from 'cs/base/common/network';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import type { CDPEvent, CDPRequest, CDPResponse } from 'cs/platform/browserView/common/cdp/types';
import { BrowserHistoryStore } from 'cs/platform/browserView/common/browserHistory';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import type { ITunnelProxyInfo } from 'cs/platform/tunnel/common/tunnelProxy';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import {
	createEditorPaneDescriptor,
	registerEditorPaneDescriptor,
	type EditorPaneResolverContext,
} from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import { BrowserEditorInput, BrowserEditorSerializer } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import {
	IBrowserViewCDPService,
	IBrowserViewWorkbenchService,
	type IBrowserEditorViewState,
	type IBrowserViewContextualFilter,
	type IBrowserViewOpenHandler,
} from 'cs/workbench/contrib/browserView/common/browserView';
import type { PreferredGroup } from 'cs/workbench/services/editor/common/editorService';
import { IEditorResolverService, RegisteredEditorPriority } from 'cs/workbench/services/editor/common/editorResolverService';
import {
	getWorkbenchInstantiationService,
	registerWorkbenchDisposable,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { localize } from 'cs/nls';
import { editorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { createBrowserEditorPaneState } from 'cs/workbench/contrib/browserView/browser/browserEditorPaneState';
import type { BrowserEditorPaneLabels } from 'cs/workbench/contrib/browserView/browser/browserEditorPaneState';
import { registerStatusbarModeRenderer } from 'cs/workbench/browser/parts/statusbar/statusbarModeRenderers';
import { renderBrowserStatusbarMode } from 'cs/workbench/contrib/browserView/browser/browserStatusbarRenderer';
import { registerEditorModeToolbar } from 'cs/workbench/browser/parts/editor/editorModeToolbarRegistry';
import { createBrowserEditorModeToolbarHost } from 'cs/workbench/contrib/browserView/browser/browserEditorPane';
import 'cs/workbench/contrib/browserView/browser/media/browserHistoryAndFavoritesPanel.css';
import 'cs/workbench/contrib/browserView/browser/media/browserEditorTab.css';
import 'cs/workbench/contrib/browserView/browser/media/browserModeToolbar.css';
import { registerEditorCreationAction } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import 'cs/workbench/contrib/browserView/browser/browserEditorToolbarService';

const unavailableMessage = 'Integrated Browser is not available in web.';
registerStatusbarModeRenderer('browser', renderBrowserStatusbarMode);
registerEditorModeToolbar('browser', createBrowserEditorModeToolbarHost);
registerEditorCreationAction({
	commandId: BrowserViewCommandId.NewTab,
	icon: 'link-external',
	order: 20,
	getLabel: ui => ui.editorCreateBrowser,
});

function createBrowserEditorPaneLabels(context: EditorPaneResolverContext): BrowserEditorPaneLabels {
	return {
		sourceMode: context.ui.editorSourceMode,
		status: {
			statusbarAriaLabel: context.ui.editorStatusbarAriaLabel,
			url: context.ui.editorStatusUrl,
		},
	};
}

class WebBrowserViewWorkbenchService extends Disposable implements IBrowserViewWorkbenchService {
	declare readonly _serviceBrand: undefined;

	readonly browserHistory = this._register(new BrowserHistoryStore(0));
	readonly onDidChangeBrowserViews = Event.None;
	readonly onDidChangeSharingAvailable = Event.None;
	readonly isSharingAvailable = false;
	private readonly known = new Map<string, BrowserEditorInput>();

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this._register(editorInputSerializerRegistry.register(
			BrowserEditorInput.ID,
			new BrowserEditorSerializer(this),
		));
	}

	willUseRemoteProxy(): boolean {
		return false;
	}

	setRemoteProxyInfo(_info: ITunnelProxyInfo | undefined): void {}

	getKnownBrowserViews(): Map<string, BrowserEditorInput> {
		return this.known;
	}

	registerContextualFilter(_filter: IBrowserViewContextualFilter): IDisposable {
		return Disposable.None;
	}

	getContextualBrowserViews(): Map<string, BrowserEditorInput> {
		return this.known;
	}

	getPreferredGroup(preferredGroup?: PreferredGroup): Promise<PreferredGroup | undefined> {
		return Promise.resolve(preferredGroup);
	}

	registerOpenHandler(_handler: IBrowserViewOpenHandler): IDisposable {
		return Disposable.None;
	}

	getOrCreateLazy(id: string, initialState: IBrowserEditorViewState = {}): BrowserEditorInput {
		let input = this.known.get(id);
		if (!input) {
			input = this.instantiationService.createInstance(
				BrowserEditorInput,
				{ id, ...initialState },
				() => new Promise(() => {}),
			);
			this.known.set(id, input);
			this._register(input.onWillDispose(() => this.known.delete(id)));
		}
		return input;
	}

	clearGlobalStorage(): Promise<void> {
		return Promise.resolve();
	}

	clearWorkspaceStorage(): Promise<void> {
		return Promise.resolve();
	}
}

class WebBrowserViewCDPService implements IBrowserViewCDPService {
	declare readonly _serviceBrand: undefined;

	async createSessionGroup(_browserId: string): Promise<string> {
		throw new Error(unavailableMessage);
	}

	destroySessionGroup(_groupId: string): Promise<void> {
		return Promise.resolve();
	}

	sendCDPMessage(_groupId: string, _message: CDPRequest): Promise<void> {
		return Promise.resolve();
	}

	onCDPMessage(_groupId: string): Event<CDPResponse | CDPEvent> {
		return Event.None;
	}

	onDidDestroy(_groupId: string): Event<void> {
		return Event.None;
	}
}

class WebBrowserEditorPane extends EditorPane<BrowserEditorInput> {
	private readonly element = document.createElement('div');

	private input: BrowserEditorInput | undefined;

	constructor(private labels: BrowserEditorPaneLabels) {
		super();
		this.element.className = 'comet-editor-browser-pane';
	}

	override getElement(): HTMLElement {
		return this.element;
	}

	override setInput(input: BrowserEditorInput): void {
		this.input = input;
	}

	setLabels(labels: BrowserEditorPaneLabels): void {
		this.labels = labels;
	}

	override getRuntimeState() {
		if (!this.input) {
			return undefined;
		}
		return createBrowserEditorPaneState(this.input, this.labels);
	}

	override dispose(): void {
		this.input = undefined;
		this.element.replaceChildren();
	}
}

registerEditorPaneDescriptor(createEditorPaneDescriptor({
	paneId: 'browser',
	contentClassNames: ['comet-is-mode-browser'],
	acceptsInput: (input): input is BrowserEditorInput => input instanceof BrowserEditorInput,
	createPane: context => new WebBrowserEditorPane(createBrowserEditorPaneLabels(context)),
	updatePane: (pane, context) => pane.setLabels(createBrowserEditorPaneLabels(context)),
}));

class WebBrowserEditorResolverContribution extends Disposable {
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IBrowserViewWorkbenchService browserViewWorkbenchService: IBrowserViewWorkbenchService,
	) {
		super();

		this._register(editorResolverService.registerEditor(
			`${Schemas.vscodeBrowser}:/**`,
			{
				id: BrowserEditorInput.EDITOR_ID,
				label: localize('browser.editorLabel', "Browser"),
				priority: RegisteredEditorPriority.exclusive,
			},
			{
				canSupportResource: resource => resource.scheme === Schemas.vscodeBrowser,
				singlePerResource: true,
			},
			{
				createEditorInput: ({ resource, options }) => {
					const parsed = BrowserViewUri.parse(resource);
					if (!parsed) {
						throw new Error(`Invalid browser view resource: ${resource.toString()}`);
					}

					const browserInput = browserViewWorkbenchService.getOrCreateLazy(parsed.id, options?.viewState);
					return {
						editor: browserInput,
						options: {
							pinned: !!browserInput.url,
							...options,
						},
					};
				},
			},
		));
	}
}

registerSingleton(IBrowserViewWorkbenchService, WebBrowserViewWorkbenchService, InstantiationType.Delayed);
registerSingleton(IBrowserViewCDPService, WebBrowserViewCDPService, InstantiationType.Delayed);
registerWorkbenchDisposable(
	getWorkbenchInstantiationService().createInstance(WebBrowserEditorResolverContribution),
);
