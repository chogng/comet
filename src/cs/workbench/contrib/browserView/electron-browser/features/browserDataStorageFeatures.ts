/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { Action2, MenuId, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId, BrowserViewStorageScope } from 'cs/platform/browserView/common/browserView';
import {
	configurationRegistry,
	ConfigurationScope,
} from 'cs/platform/configuration/common/configurationRegistry';
import {
	IContextKeyService,
	RawContextKey,
	type ContextKey,
} from 'cs/platform/contextkey/common/contextkey';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { localize, localize2 } from 'cs/nls';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { IBrowserViewWorkbenchService } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BrowserActionCategory,
	BrowserActionGroup,
	BrowserEditor,
	BrowserEditorContribution,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

export const CONTEXT_BROWSER_STORAGE_SCOPE = new RawContextKey<string>('browserStorageScope', '');

class BrowserEditorStorageScopeContribution extends BrowserEditorContribution {
	private readonly storageScopeContext: ContextKey<string>;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super(editor);
		this.storageScopeContext = CONTEXT_BROWSER_STORAGE_SCOPE.bindTo(contextKeyService);
	}

	protected override onModelAttached(model: IBrowserViewModel, _store: DisposableStore): void {
		this.storageScopeContext.set(model.storageScope);
	}

	override onModelDetached(): void {
		this.storageScopeContext.reset();
	}
}

BrowserEditor.registerContribution(BrowserEditorStorageScopeContribution);

class ClearGlobalBrowserStorageAction extends Action2 {
	static readonly ID = BrowserViewCommandId.ClearGlobalStorage;

	constructor() {
		super({
			id: ClearGlobalBrowserStorageAction.ID,
			title: localize2('browser.clearGlobalStorageAction', "Clear Storage (Global)"),
			category: BrowserActionCategory,
			icon: Codicon.clearAll,
			f1: true,
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Data,
				order: 20,
				when: CONTEXT_BROWSER_STORAGE_SCOPE.isEqualTo(BrowserViewStorageScope.Global),
				isHiddenByDefault: true,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IBrowserViewWorkbenchService).clearGlobalStorage();
	}
}

class ClearWorkspaceBrowserStorageAction extends Action2 {
	static readonly ID = BrowserViewCommandId.ClearWorkspaceStorage;

	constructor() {
		super({
			id: ClearWorkspaceBrowserStorageAction.ID,
			title: localize2('browser.clearWorkspaceStorageAction', "Clear Storage (Workspace)"),
			category: BrowserActionCategory,
			icon: Codicon.clearAll,
			f1: true,
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Data,
				order: 20,
				when: CONTEXT_BROWSER_STORAGE_SCOPE.isEqualTo(BrowserViewStorageScope.Workspace),
				isHiddenByDefault: true,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IBrowserViewWorkbenchService).clearWorkspaceStorage();
	}
}

class ClearEphemeralBrowserStorageAction extends Action2 {
	static readonly ID = BrowserViewCommandId.ClearEphemeralStorage;

	constructor() {
		super({
			id: ClearEphemeralBrowserStorageAction.ID,
			title: localize2('browser.clearEphemeralStorageAction', "Clear Storage (Ephemeral)"),
			category: BrowserActionCategory,
			icon: Codicon.clearAll,
			f1: true,
			precondition: CONTEXT_BROWSER_STORAGE_SCOPE.isEqualTo(BrowserViewStorageScope.Ephemeral),
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Data,
				order: 20,
				when: CONTEXT_BROWSER_STORAGE_SCOPE.isEqualTo(BrowserViewStorageScope.Ephemeral),
				isHiddenByDefault: true,
			},
		});
	}

	async run(_accessor: ServicesAccessor, browserEditor?: BrowserEditor): Promise<void> {
		if (browserEditor instanceof BrowserEditor) {
			await browserEditor.model?.clearStorage();
		}
	}
}

registerAction2(ClearGlobalBrowserStorageAction);
registerAction2(ClearWorkspaceBrowserStorageAction);
registerAction2(ClearEphemeralBrowserStorageAction);

configurationRegistry.registerConfigurationProperties({
	'workbench.browser.dataStorage': {
		type: 'string',
		enum: [
			'default',
			BrowserViewStorageScope.Global,
			BrowserViewStorageScope.Workspace,
			BrowserViewStorageScope.Ephemeral,
		],
		markdownEnumDescriptions: [
			localize(
				{ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'browser.dataStorage.default' },
				"`global` for local workspaces, `workspace` for remote workspaces.",
			),
			localize(
				{ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'browser.dataStorage.global' },
				"All browser views share a single persistent session across all workspaces. Incompatible with remote sessions.",
			),
			localize(
				{ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'browser.dataStorage.workspace' },
				"Browser views within the same workspace share a persistent session. If no workspace is opened, `ephemeral` storage is used.",
			),
			localize(
				{ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'browser.dataStorage.ephemeral' },
				"Each browser view has its own session that is cleaned up when closed.",
			),
		],
		restricted: true,
		default: 'default',
		markdownDescription: localize(
			{ comment: ['This is the description for a setting.'], key: 'browser.dataStorage' },
			"Controls how browser data (cookies, cache, storage) is shared between browser views.\n\n**Note**: In untrusted workspaces, this setting is ignored and `ephemeral` storage is always used.",
		),
		scope: ConfigurationScope.WINDOW,
	},
});
