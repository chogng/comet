/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import { localize, localize2 } from 'cs/nls';
import { Action2, MenuId, MenuRegistry, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { ContextKeyExpr } from 'cs/platform/contextkey/common/contextkey';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { IQuickInputService, type IQuickPickItem } from 'cs/platform/quickinput/common/quickInput';
import { type ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import { IBrowserViewWorkbenchService } from 'cs/workbench/contrib/browserView/common/browserView';
import { BrowserEditorInput, EMPTY_BROWSER_EDITOR_URL } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

interface IOpenBrowserOptions {
	readonly url?: string;
	readonly reuseUrlFilter?: string;
}

interface IBrowserQuickPickItem extends IQuickPickItem {
	readonly tabId: string;
	readonly open: boolean;
	readonly url: string;
	readonly input: BrowserEditorInput;
}

function createBrowserResource(): URI {
	return BrowserViewUri.forId(generateUuid());
}

function getBrowserTabs(editorService: IEditorService) {
	return editorService.getEditors().filter(
		(identifier): identifier is typeof identifier & { editor: BrowserEditorInput } =>
			identifier.editor instanceof BrowserEditorInput,
	);
}

function openBrowserResource(editorService: IEditorService, resource: URI, url: string) {
	return editorService.openEditor({
		resource,
		options: { viewState: { url } },
	});
}

function matchesGlob(value: string, pattern: string): boolean {
	const expression = pattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*/g, '.*')
		.replace(/\?/g, '.');
	return new RegExp(`^${expression}$`).test(value);
}

function findReusableBrowserInput(
	browserViewService: IBrowserViewWorkbenchService,
	reuseUrlFilter: string | undefined,
) {
	if (!reuseUrlFilter) {
		return undefined;
	}

	const filterUri = URI.parse(reuseUrlFilter);
	return [...browserViewService.getContextualBrowserViews().values()].find(editor => {
		const editorUri = URI.parse(editor.url || '');
		if (
			filterUri.scheme &&
			reuseUrlFilter.startsWith(`${filterUri.scheme}:`) &&
			filterUri.scheme !== editorUri.scheme
		) {
			return false;
		}
		if (filterUri.authority && !matchesGlob(editorUri.authority, filterUri.authority)) {
			return false;
		}
		if (filterUri.path && !matchesGlob(editorUri.path, filterUri.path)) {
			return false;
		}
		if (filterUri.query) {
			const filterParameters = new URLSearchParams(filterUri.query);
			const editorParameters = new URLSearchParams(editorUri.query);
			if (![...filterParameters].every(([key, value]) =>
				matchesGlob(editorParameters.get(key) ?? '', value),
			)) {
				return false;
			}
		}
		return true;
	});
}

function getBrowserTabLabel(title: string, url: string) {
	const normalizedTitle = title.trim();
	if (normalizedTitle) {
		return normalizedTitle;
	}

	return url === EMPTY_BROWSER_EDITOR_URL
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
				when: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, ActiveEditorFocusedContext.isEqualTo(true)),
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const browserViewService = accessor.get(IBrowserViewWorkbenchService);

		const newTabItem: IQuickPickItem = {
			id: 'new',
			label: localize('browser.openNewTab', "New Integrated Browser Tab"),
			alwaysShow: true,
		};
		const openTabs = getBrowserTabs(editorService);
		const openTabIds = new Set(openTabs.map(tab => tab.editor.id));
		const tabItems: IBrowserQuickPickItem[] = openTabs.map(tab => ({
			id: tab.editor.id,
			tabId: tab.editor.id,
			open: true,
			url: tab.editor.url ?? EMPTY_BROWSER_EDITOR_URL,
			input: tab.editor,
			label: getBrowserTabLabel(tab.editor.getName(), tab.editor.url ?? EMPTY_BROWSER_EDITOR_URL),
			description: tab.editor.url === EMPTY_BROWSER_EDITOR_URL ? undefined : tab.editor.url,
		}));
		for (const input of browserViewService.getContextualBrowserViews().values()) {
			if (openTabIds.has(input.id)) {
				continue;
			}
			const url = input.url || EMPTY_BROWSER_EDITOR_URL;
			tabItems.push({
				id: input.id,
				tabId: input.id,
				open: false,
				url,
				input,
				label: getBrowserTabLabel(input.title ?? '', url),
				description: url === EMPTY_BROWSER_EDITOR_URL ? undefined : url,
			});
		}
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
			await openBrowserResource(editorService, createBrowserResource(), EMPTY_BROWSER_EDITOR_URL);
			return;
		}

		const selectedBrowser = selection as IBrowserQuickPickItem;
		if (selectedBrowser.open) {
			await editorService.activateEditor(selectedBrowser.input);
			return;
		}
		await editorService.openEditor(selectedBrowser.input);
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

	async run(accessor: ServicesAccessor, urlOrOptions?: string | IOpenBrowserOptions): Promise<void> {
		const editorService = accessor.get(IEditorService);

		const options = typeof urlOrOptions === 'string'
			? { url: urlOrOptions }
			: (urlOrOptions ?? {});
		const reusableInput = options.reuseUrlFilter
			? findReusableBrowserInput(
				accessor.get(IBrowserViewWorkbenchService),
				options.reuseUrlFilter,
			)
			: undefined;
		if (reusableInput) {
			if (options.url?.trim()) {
				reusableInput.navigate(options.url);
			}
			await editorService.openEditor(reusableInput);
			return;
		}

		await openBrowserResource(
			editorService,
			createBrowserResource(),
			options.url?.trim() || EMPTY_BROWSER_EDITOR_URL,
		);
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

	async run(accessor: ServicesAccessor, resource?: URI): Promise<void> {
		if (!resource) {
			return;
		}

		await openBrowserResource(accessor.get(IEditorService), createBrowserResource(), resource.toString());
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
		const browserViewService = accessor.get(IBrowserViewWorkbenchService);
		const commandService = accessor.get(IWorkbenchCommandService);
		const commandId = browserViewService.getContextualBrowserViews().size > 0
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
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 50,
				primary: KeyMod.CtrlCmd | KeyCode.KeyT,
				when: ActiveEditorFocusedContext.isEqualTo(true),
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await openBrowserResource(accessor.get(IEditorService), createBrowserResource(), EMPTY_BROWSER_EDITOR_URL);
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

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		for (const tab of getBrowserTabs(editorService)) {
			await editorService.closeEditor(tab.editor);
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

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const activeGroupId = editorService.getActiveGroupId();
		for (const tab of getBrowserTabs(editorService).filter(tab => tab.groupId === activeGroupId)) {
			await editorService.closeEditor(tab.editor);
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
