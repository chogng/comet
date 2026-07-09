/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'cs/base/common/event';
import { Codicon } from 'cs/base/common/codicons';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { localize, localize2 } from 'cs/nls';
import { Action2, MenuId, MenuRegistry, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId, type IBrowserViewRect, type IElementAncestor, type IElementData } from 'cs/platform/browserView/common/browserView';
import { IConfigurationService } from 'cs/platform/configuration/common/configuration';
import { configurationRegistry, ConfigurationScope } from 'cs/platform/configuration/common/configurationRegistry';
import {
	ContextKeyExpr,
	IContextKeyService,
	RawContextKey,
	type ContextKey,
} from 'cs/platform/contextkey/common/contextkey';
import { type ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { ILogService } from 'cs/platform/log/common/log';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BrowserActionCategory,
	BrowserActionGroup,
	BrowserEditor,
	BrowserEditorContribution,
	BROWSER_EDITOR_ACTIVE,
	CONTEXT_BROWSER_HAS_ERROR,
	CONTEXT_BROWSER_HAS_URL,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

const BrowserSendElementsToChatAttachImagesSettingId = 'workbench.browser.sendElementsToChat.attachImages';

const CONTEXT_BROWSER_ELEMENT_SELECTION_ACTIVE = new RawContextKey<boolean>('browserElementSelectionActive', false);
const CONTEXT_BROWSER_AREA_SELECTION_ACTIVE = new RawContextKey<boolean>('browserAreaSelectionActive', false);

function formatElementPath(ancestors: readonly IElementAncestor[] | undefined): string | undefined {
	if (!ancestors || ancestors.length === 0) {
		return undefined;
	}

	return ancestors
		.map(ancestor => {
			const id = ancestor.id ? `#${ancestor.id}` : '';
			const classes = ancestor.classNames?.length ? `.${ancestor.classNames.join('.')}` : '';
			return `${ancestor.tagName}${id}${classes}`;
		})
		.join(' > ');
}

function formatRect(rect: IBrowserViewRect) {
	return [
		`- x: ${Math.round(rect.x)}px`,
		`- y: ${Math.round(rect.y)}px`,
		`- width: ${Math.round(rect.width)}px`,
		`- height: ${Math.round(rect.height)}px`,
	].join('\n');
}

function getElementDisplayName(elementData: IElementData) {
	const lastAncestor = elementData.ancestors?.at(-1);
	if (!lastAncestor) {
		return localize('browser.element', "Element");
	}

	const id = lastAncestor.id ? `#${lastAncestor.id}` : '';
	const classes = lastAncestor.classNames?.length ? `.${lastAncestor.classNames.join('.')}` : '';
	return `${lastAncestor.tagName.toLowerCase()}${id}${classes}`;
}

function createElementContextValue(elementData: IElementData, displayName: string, screenshotByteLength: number | undefined): string {
	const sections: string[] = [];
	sections.push(localize('browser.attachedElementContext', "Attached Element Context from Integrated Browser"));
	sections.push(`${localize('browser.elementLabel', "Element")}: ${displayName}`);

	if (elementData.url) {
		sections.push(`${localize('browser.urlLabel', "URL")}: ${elementData.url}`);
	}

	const htmlPath = formatElementPath(elementData.ancestors);
	if (htmlPath) {
		sections.push(`${localize('browser.htmlPathLabel', "HTML Path")}: ${htmlPath}`);
	}

	sections.push(`${localize('browser.outerHtmlLabel', "Outer HTML")}:\n\`\`\`html\n${elementData.outerHTML}\n\`\`\``);

	if (elementData.dimensions) {
		sections.push(`${localize('browser.dimensionsLabel', "Dimensions")}:\n${formatRect({
			x: elementData.dimensions.left,
			y: elementData.dimensions.top,
			width: elementData.dimensions.width,
			height: elementData.dimensions.height,
		})}`);
	}

	if (screenshotByteLength !== undefined) {
		sections.push(`${localize('browser.elementScreenshotLabel', "Element Screenshot")}: ${screenshotByteLength} bytes`);
	}

	sections.push(`${localize('browser.cssLabel', "CSS")}:\n\`\`\`css\n${elementData.computedStyle}\n\`\`\``);

	return sections.join('\n\n');
}

function getBrowserEditor(candidate: unknown): BrowserEditor | undefined {
	return candidate instanceof BrowserEditor ? candidate : undefined;
}

function toPromise<T>(event: Event<T>): Promise<T> {
	return new Promise<T>(resolve => Event.once(event)(resolve));
}

class BrowserEditorChatIntegration extends BrowserEditorContribution {
	private readonly elementSelectionActiveContext: ContextKey<boolean>;
	private readonly areaSelectionActiveContext: ContextKey<boolean>;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IChatService private readonly chatService: IChatService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super(editor);
		this.elementSelectionActiveContext = CONTEXT_BROWSER_ELEMENT_SELECTION_ACTIVE.bindTo(contextKeyService);
		this.areaSelectionActiveContext = CONTEXT_BROWSER_AREA_SELECTION_ACTIVE.bindTo(contextKeyService);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.elementSelectionActiveContext.set(model.isElementSelectionActive);
		this.areaSelectionActiveContext.set(model.isAreaSelectionActive);

		store.add(model.onDidChangeElementSelectionActive(active => {
			this.elementSelectionActiveContext.set(active);
		}));
		store.add(model.onDidChangeAreaSelectionActive(active => {
			this.areaSelectionActiveContext.set(active);
		}));
		store.add(model.onDidSelectElement(data => {
			void this.attachElementDataToChat(data, model);
		}));
	}

	override onModelDetached(): void {
		this.elementSelectionActiveContext.reset();
		this.areaSelectionActiveContext.reset();
	}

	private insertBrowserContext(title: string, content: string): void {
		this.chatService.insertContextMessage(title, content);
	}

	private async attachElementDataToChat(elementData: IElementData, model: IBrowserViewModel): Promise<void> {
		const displayName = getElementDisplayName(elementData);
		const attachImages = this.configurationService.getValue<boolean>(BrowserSendElementsToChatAttachImagesSettingId);
		const screenshot = attachImages
			? await model.captureScreenshot({ quality: 90, pageRect: elementData.bounds })
			: undefined;

		this.insertBrowserContext(
			localize('browser.elementContextTitle', "Browser Element"),
			createElementContextValue(elementData, displayName, screenshot?.byteLength),
		);
	}

	async addConsoleLogsToChat(): Promise<void> {
		const model = this.editor.model;
		if (!model) {
			return;
		}

		try {
			const logs = await model.getConsoleLogs();
			if (!logs.trim()) {
				return;
			}

			this.insertBrowserContext(
				localize('browser.consoleLogsTitle', "Browser Console Logs"),
				[
					localize('browser.attachedConsoleLogs', "Attached Console Logs from Integrated Browser"),
					`${localize('browser.urlLabel', "URL")}: ${model.url}`,
					['```text', logs, '```'].join('\n'),
				].join('\n\n'),
			);
		} catch (error) {
			this.logService.error('BrowserEditor.addConsoleLogsToChat: Failed to get console logs', error);
		}
	}

	async addScreenshotToChat(): Promise<void> {
		await this.captureScreenshotToChat(
			'viewport',
			localize('browser.screenshotTitle', "Browser Screenshot"),
			{ quality: 80 },
		);
	}

	async addAreaScreenshotToChat(): Promise<void> {
		const model = this.editor.model;
		if (!model) {
			return;
		}

		if (model.isAreaSelectionActive) {
			await model.toggleAreaSelection(false);
			return;
		}

		this.editor.ensureBrowserFocus();
		const pickPromise = toPromise(model.onDidPickArea);
		await model.toggleAreaSelection(true);
		const rect = await pickPromise;
		if (!rect) {
			return;
		}

		await this.captureScreenshotToChat(
			'area',
			localize('browser.areaScreenshotTitle', "Browser Area Screenshot"),
			{ quality: 80, pageRect: rect, awaitNextPaint: true },
		);
	}

	async addFullPageScreenshotToChat(): Promise<void> {
		await this.captureScreenshotToChat(
			'fullPage',
			localize('browser.fullPageScreenshotTitle', "Browser Full Page Screenshot"),
			{ fullPage: true, format: 'png' },
		);
	}

	private async captureScreenshotToChat(
		type: 'viewport' | 'area' | 'fullPage',
		title: string,
		options: Parameters<IBrowserViewModel['captureScreenshot']>[0],
	): Promise<void> {
		const model = this.editor.model;
		if (!model) {
			return;
		}

		try {
			const screenshot = await model.captureScreenshot(options);
			this.insertBrowserContext(
				title,
				[
					localize('browser.attachedScreenshot', "Attached Screenshot from Integrated Browser"),
					`${localize('browser.screenshotTypeLabel', "Screenshot Type")}: ${type}`,
					`${localize('browser.urlLabel', "URL")}: ${model.url}`,
					`${localize('browser.screenshotSizeLabel', "Screenshot Size")}: ${screenshot.byteLength} bytes`,
				].join('\n\n'),
			);
		} catch (error) {
			this.logService.error('BrowserEditor.addScreenshotToChat: Failed to capture screenshot', error);
		}
	}
}

BrowserEditor.registerContribution(BrowserEditorChatIntegration);

class AddElementToChatAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.AddElementToChat,
			title: localize2('browser.addElementToChatAction', "Add Element to Chat"),
			category: BrowserActionCategory,
			icon: Codicon.inspect,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL.isEqualTo(true), CONTEXT_BROWSER_HAS_ERROR.isEqualTo(false)),
			toggled: CONTEXT_BROWSER_ELEMENT_SELECTION_ACTIVE.isEqualTo(true),
			menu: {
				id: MenuId.BrowserChatActionsMenu,
				group: '1_element',
				order: 1,
			},
			keybinding: [
				{
					weight: KeybindingWeight.WorkbenchContrib + 50,
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
				},
				{
					when: CONTEXT_BROWSER_ELEMENT_SELECTION_ACTIVE.isEqualTo(true),
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyCode.Escape,
				},
			],
		});
	}

	async run(_accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		const editor = getBrowserEditor(browserEditor);
		if (!editor) {
			return;
		}

		editor.ensureBrowserFocus();
		await editor.model?.toggleElementSelection();
	}
}

class AddConsoleLogsToChatAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.AddConsoleLogsToChat,
			title: localize2('browser.addConsoleLogsToChatAction', "Add Console Logs to Chat"),
			category: BrowserActionCategory,
			icon: Codicon.output,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL.isEqualTo(true), CONTEXT_BROWSER_HAS_ERROR.isEqualTo(false)),
			menu: {
				id: MenuId.BrowserChatActionsMenu,
				group: '1_element',
				order: 2,
			},
		});
	}

	async run(_accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		await getBrowserEditor(browserEditor)
			?.getContribution(BrowserEditorChatIntegration)
			?.addConsoleLogsToChat();
	}
}

class AddScreenshotToChatAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.AddScreenshotToChat,
			title: localize2('browser.addScreenshotToChatAction', "Add Screenshot to Chat"),
			category: BrowserActionCategory,
			icon: Codicon.deviceCamera,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL.isEqualTo(true), CONTEXT_BROWSER_HAS_ERROR.isEqualTo(false)),
			menu: {
				id: MenuId.BrowserChatActionsMenu,
				group: '2_screenshots',
				order: 1,
			},
		});
	}

	async run(_accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		await getBrowserEditor(browserEditor)
			?.getContribution(BrowserEditorChatIntegration)
			?.addScreenshotToChat();
	}
}

class AddAreaScreenshotToChatAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.AddAreaScreenshotToChat,
			title: localize2('browser.addAreaScreenshotToChatAction', "Add Area Screenshot to Chat"),
			category: BrowserActionCategory,
			icon: Codicon.screenFull,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL.isEqualTo(true), CONTEXT_BROWSER_HAS_ERROR.isEqualTo(false)),
			toggled: CONTEXT_BROWSER_AREA_SELECTION_ACTIVE.isEqualTo(true),
			menu: {
				id: MenuId.BrowserChatActionsMenu,
				group: '2_screenshots',
				order: 2,
			},
		});
	}

	async run(_accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		await getBrowserEditor(browserEditor)
			?.getContribution(BrowserEditorChatIntegration)
			?.addAreaScreenshotToChat();
	}
}

class AddFullPageScreenshotToChatAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.AddFullPageScreenshotToChat,
			title: localize2('browser.addFullPageScreenshotToChatAction', "Add Full Page Screenshot to Chat"),
			category: BrowserActionCategory,
			icon: Codicon.deviceCamera,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL.isEqualTo(true), CONTEXT_BROWSER_HAS_ERROR.isEqualTo(false)),
			menu: {
				id: MenuId.BrowserChatActionsMenu,
				group: '2_screenshots',
				order: 3,
			},
		});
	}

	async run(_accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		await getBrowserEditor(browserEditor)
			?.getContribution(BrowserEditorChatIntegration)
			?.addFullPageScreenshotToChat();
	}
}

registerAction2(AddElementToChatAction);
registerAction2(AddConsoleLogsToChatAction);
registerAction2(AddScreenshotToChatAction);
registerAction2(AddAreaScreenshotToChatAction);
registerAction2(AddFullPageScreenshotToChatAction);

MenuRegistry.appendMenuItem(MenuId.BrowserActionsToolbar, {
	submenu: MenuId.BrowserChatActionsMenu,
	title: localize2('browser.chatActionsSubmenu', "Add to Chat"),
	icon: Codicon.inspect,
	group: BrowserActionGroup.Tools,
	order: 1,
	isSplitButton: true,
});

configurationRegistry.registerConfigurationProperties({
	'workbench.browser.enableChatTools': {
		type: 'boolean',
		default: true,
		scope: ConfigurationScope.APPLICATION,
		markdownDescription: localize('browser.enableChatTools', "When enabled, chat agents can use browser tools to open and interact with pages in the Integrated Browser."),
	},
	'workbench.browser.experimentalUserTools.enabled': {
		type: 'boolean',
		default: false,
		scope: ConfigurationScope.APPLICATION,
		tags: ['experimental'],
		markdownDescription: localize('browser.experimentalUserTools.enabled', "When enabled, experimental user-facing tools are available in the Integrated Browser's Add to Chat menu."),
	},
	[BrowserSendElementsToChatAttachImagesSettingId]: {
		type: 'boolean',
		default: true,
		scope: ConfigurationScope.APPLICATION,
		markdownDescription: localize('workbench.browser.sendElementsToChat.attachImages', "Controls whether a screenshot of the selected element will be added to the chat."),
	},
});
