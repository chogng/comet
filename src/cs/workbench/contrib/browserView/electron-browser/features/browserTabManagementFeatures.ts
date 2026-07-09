/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { URI } from 'cs/base/common/uri';
import { localize, localize2 } from 'cs/nls';
import { Action2, MenuId, MenuRegistry, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { IQuickInputService, type IQuickPickItem } from 'cs/platform/quickinput/common/quickInput';
import { type ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import {
	EMPTY_BROWSER_TAB_URL,
	createEditorTabInputId,
	isEditorBrowserTabInput,
} from 'cs/workbench/browser/parts/editor/editorInput';
import { getWorkbenchEditorCommandHandlers } from 'cs/workbench/browser/editorCommands';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserActionGroup,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

interface IOpenBrowserOptions {
	readonly url?: string;
	readonly openToSide?: boolean;
	readonly reuseUrlFilter?: string;
}

interface IBrowserQuickPickItem extends IQuickPickItem {
	readonly tabId: string;
}

function createBrowserResource(): URI {
	return BrowserViewUri.forId(createEditorTabInputId('browser'));
}

function getEditorCommandHandlers() {
	const handlers = getWorkbenchEditorCommandHandlers();
	if (!handlers) {
		throw new Error('Workbench editor command handlers are not configured.');
	}

	return handlers;
}

function getBrowserTabs() {
	return getEditorCommandHandlers()
		.getTabs()
		.filter(isEditorBrowserTabInput);
}

function findReusableBrowserTab(reuseUrlFilter: string | undefined) {
	if (!reuseUrlFilter) {
		return undefined;
	}

	return getBrowserTabs().find(tab => tab.url === reuseUrlFilter);
}

function getBrowserTabLabel(title: string, url: string) {
	const normalizedTitle = title.trim();
	if (normalizedTitle) {
		return normalizedTitle;
	}

	return url === EMPTY_BROWSER_TAB_URL
		? localize('browser.emptyTabLabel', "New Tab")
		: url;
}

class QuickOpenBrowserAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.QuickOpen,
			title: localize2('browser.quickOpenAction', "Quick Open Browser Tab..."),
			icon: Codicon.globe,
			category: BrowserActionCategory,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA,
				when: BROWSER_EDITOR_ACTIVE,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const handlers = getEditorCommandHandlers();

		const newTabItem: IQuickPickItem = {
			id: 'new',
			label: localize('browser.openNewTab', "New Integrated Browser Tab"),
			alwaysShow: true,
		};
		const tabItems: IBrowserQuickPickItem[] = getBrowserTabs().map(tab => ({
			id: tab.id,
			tabId: tab.id,
			label: getBrowserTabLabel(tab.title, tab.url),
			description: tab.url === EMPTY_BROWSER_TAB_URL ? undefined : tab.url,
		}));
		const selection = await accessor.get(IQuickInputService).pick(
			[
				...tabItems,
				{ type: 'separator' },
				newTabItem,
			],
			{
				placeHolder: localize('browser.quickOpenPlaceholder', "Select a browser tab"),
				matchOnDescription: true,
			},
		);

		if (!selection) {
			return;
		}

		if (selection.id === newTabItem.id) {
			await handlers.openEditor({
				kind: 'browser',
				disposition: 'new-tab',
				resource: createBrowserResource(),
				options: {
					viewState: {
						url: EMPTY_BROWSER_TAB_URL,
					},
				},
			});
			return;
		}

		handlers.activateTab((selection as IBrowserQuickPickItem).tabId);
	}
}

class OpenIntegratedBrowserAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.Open,
			title: localize2('browser.openAction', "Open Integrated Browser"),
			category: BrowserActionCategory,
			icon: Codicon.globe,
			f1: true,
		});
	}

	async run(_accessor: ServicesAccessor, urlOrOptions?: string | IOpenBrowserOptions): Promise<void> {
		const handlers = getEditorCommandHandlers();

		const options = typeof urlOrOptions === 'string'
			? { url: urlOrOptions }
			: (urlOrOptions ?? {});
		const reusableTab = findReusableBrowserTab(options.reuseUrlFilter);
		if (reusableTab) {
			handlers.activateTab(reusableTab.id);
			if (options.url?.trim()) {
				await handlers.openEditor({
					kind: 'browser',
					disposition: 'current',
					resource: BrowserViewUri.forId(reusableTab.id),
					options: {
						viewState: {
							url: options.url,
						},
					},
				});
			}
			return;
		}

		if (options.url?.trim()) {
			await handlers.openEditor({
				kind: 'browser',
				disposition: 'new-tab',
				resource: createBrowserResource(),
				options: {
					viewState: {
						url: options.url,
					},
				},
			});
			return;
		}

		await handlers.openEditor({
			kind: 'browser',
			disposition: 'reveal-or-open',
		});
	}
}

class OpenFileInIntegratedBrowserAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.OpenFile,
			title: localize2('browser.openFileAction', "Open in Integrated Browser"),
			category: BrowserActionCategory,
			icon: Codicon.globe,
			f1: true,
		});
	}

	async run(_accessor: ServicesAccessor, resource?: URI): Promise<void> {
		if (!resource) {
			return;
		}

		await getEditorCommandHandlers().openEditor({
			kind: 'browser',
			disposition: 'new-tab',
			resource: createBrowserResource(),
			options: {
				viewState: {
					url: resource.toString(),
				},
			},
		});
	}
}

class OpenOrListBrowsersAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.OpenOrList,
			title: localize2('browser.openOrListAction', "Browser"),
			icon: Codicon.globe,
			f1: false,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Slash,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(IWorkbenchCommandService);
		const commandId = getBrowserTabs().length > 0
			? BrowserViewCommandId.QuickOpen
			: BrowserViewCommandId.Open;

		await commandService.executeCommand(commandId);
	}
}

class NewTabAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.NewTab,
			title: localize2('browser.newTabAction', "New Tab"),
			category: BrowserActionCategory,
			icon: Codicon.add,
			f1: true,
			precondition: BROWSER_EDITOR_ACTIVE,
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Tabs,
				order: 1,
				isHiddenByDefault: true,
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 50,
				primary: KeyMod.CtrlCmd | KeyCode.KeyT,
			},
		});
	}

	async run(): Promise<void> {
		await getEditorCommandHandlers().openEditor({
			kind: 'browser',
			disposition: 'new-tab',
			resource: createBrowserResource(),
			options: {
				viewState: {
					url: EMPTY_BROWSER_TAB_URL,
				},
			},
		});
	}
}

class CloseAllBrowserTabsAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.CloseAll,
			title: localize2('browser.closeAll', "Close All Browser Tabs"),
			category: BrowserActionCategory,
			f1: true,
		});
	}

	async run(): Promise<void> {
		const handlers = getEditorCommandHandlers();

		for (const tab of getBrowserTabs()) {
			await handlers.closeTab(tab.id);
		}
	}
}

class CloseAllBrowserTabsInGroupAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.CloseAllInGroup,
			title: localize2('browser.closeAllInGroup', "Close All Browser Tabs in Group"),
			category: BrowserActionCategory,
			f1: true,
			precondition: BROWSER_EDITOR_ACTIVE,
		});
	}

	async run(): Promise<void> {
		const handlers = getEditorCommandHandlers();

		for (const tab of getBrowserTabs()) {
			await handlers.closeTab(tab.id);
		}
	}
}

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '4_auxbar',
	command: {
		id: BrowserViewCommandId.OpenOrList,
		title: localize({ key: 'miOpenBrowser', comment: ['&& denotes a mnemonic'] }, "&&Browser"),
	},
	order: 2,
});

MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, {
	command: {
		id: BrowserViewCommandId.CloseAllInGroup,
		title: localize('browser.closeAllInGroupShort', "Close All Browser Tabs"),
	},
	group: '1_close',
	order: 55,
	when: BROWSER_EDITOR_ACTIVE,
});

registerAction2(QuickOpenBrowserAction);
registerAction2(OpenIntegratedBrowserAction);
registerAction2(OpenFileInIntegratedBrowserAction);
registerAction2(OpenOrListBrowsersAction);
registerAction2(NewTabAction);
registerAction2(CloseAllBrowserTabsAction);
registerAction2(CloseAllBrowserTabsInGroupAction);
