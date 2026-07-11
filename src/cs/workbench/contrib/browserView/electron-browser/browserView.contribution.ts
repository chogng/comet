/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'cs/base/common/lifecycle';
import {
	registerWorkbenchContribution,
} from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import { IBrowserViewCDPService, IBrowserViewWorkbenchService } from 'cs/workbench/contrib/browserView/common/browserView';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { Schemas } from 'cs/base/common/network';
import { IEditorResolverService, RegisteredEditorPriority } from 'cs/workbench/services/editor/common/editorResolverService';
import { localize } from 'cs/nls';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { BrowserViewWorkbenchService } from 'cs/workbench/contrib/browserView/electron-browser/browserViewWorkbenchService';
import { IPlaywrightService } from 'cs/platform/browserView/common/playwrightService';
import { PlaywrightWorkbenchService } from 'cs/workbench/services/browserView/electron-browser/playwrightWorkbenchService';
import { AgentNetworkDomainSettingId } from 'cs/platform/networkFilter/common/settings';
import { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import { IWorkbenchConfigurationService } from 'cs/workbench/services/configuration/common/configuration';
import { BrowserViewCDPService } from 'cs/workbench/contrib/browserView/electron-browser/browserViewCDPService';
import { BrowserEditor } from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import type { BrowserEditorProps } from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import {
	createEditorPaneDescriptor,
	registerEditorPaneDescriptor,
	type EditorPaneResolverContext,
} from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';

import 'cs/workbench/contrib/browserView/electron-browser/features/webContentsViewRendererFeature';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserWelcomeFeature';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserFavoritesFeature';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserHistoryFeature';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserPermissionsFeature';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserDataStorageFeatures';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserDevToolsFeature';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserEditorChatFeatures';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserEditorErrorFeatures';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserEditorZoomFeature';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserEditorEmulationFeatures';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserEditorFindFeature';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserSearchFeatures';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserTabManagementFeatures';
import 'cs/workbench/contrib/browserView/electron-browser/features/browserRemoteFeatures';

registerSingleton(IPlaywrightService, PlaywrightWorkbenchService, InstantiationType.Delayed);

function createBrowserEditorProps(
	context: EditorPaneResolverContext,
): BrowserEditorProps {
	return {
		labels: context.labels,
		nativeHost: context.nativeHost,
		onDidChangeBrowserState: context.onDidChangeBrowserState,
	};
}

registerEditorPaneDescriptor(createEditorPaneDescriptor({
	paneId: 'browser',
	contentClassNames: ['comet-is-mode-browser'] as const,
	acceptsInput: (input): input is BrowserEditorInput => input instanceof BrowserEditorInput,
	createPane: (input, context) => context.instantiationService.createInstance(
		BrowserEditor,
		input,
		createBrowserEditorProps(context),
	),
}));

export class BrowserEditorResolverContribution extends Disposable {
	static readonly ID = 'workbench.contrib.browserEditorResolver';

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

					void browserInput.resolve();

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

class SharedProcessNetworkFilterContribution extends Disposable {
	constructor(
		@IWorkbenchConfigurationService private readonly configurationService: IWorkbenchConfigurationService,
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
	) {
		super();
		this.update();
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (
				event.affectsConfiguration(AgentNetworkDomainSettingId.NetworkFilter) ||
				event.affectsConfiguration(AgentNetworkDomainSettingId.AllowedNetworkDomains) ||
				event.affectsConfiguration(AgentNetworkDomainSettingId.DeniedNetworkDomains)
			) {
				this.update();
			}
		}));
	}

	private update(): void {
		void this.mainProcessService.getChannel('networkFilter').call('update', [
			this.configurationService.getValue<boolean>(AgentNetworkDomainSettingId.NetworkFilter) ?? false,
			this.configurationService.getValue<string[]>(AgentNetworkDomainSettingId.AllowedNetworkDomains) ?? [],
			this.configurationService.getValue<string[]>(AgentNetworkDomainSettingId.DeniedNetworkDomains) ?? [],
		]).catch(error => {
			console.error('Failed to update shared network filter settings.', error);
		});
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(BrowserEditorResolverContribution),
);
registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(SharedProcessNetworkFilterContribution),
);

registerSingleton(IBrowserViewWorkbenchService, BrowserViewWorkbenchService, InstantiationType.Delayed);
registerSingleton(IBrowserViewCDPService, BrowserViewCDPService, InstantiationType.Delayed);
