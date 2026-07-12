/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { Event } from 'cs/base/common/event';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { isEqual } from 'cs/base/common/resources';
import type { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import { localize, localize2 } from 'cs/nls';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId, type IBrowserViewRect, type IElementAncestor, type IElementData } from 'cs/platform/browserView/common/browserView';
import { IConfigurationService } from 'cs/platform/configuration/common/configuration';
import { configurationRegistry, ConfigurationScope } from 'cs/platform/configuration/common/configurationRegistry';
import {
	ContextKeyExpr,
	IContextKeyService,
	RawContextKey,
	type ContextKey,
} from 'cs/platform/contextkey/common/contextkey';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { ILogService } from 'cs/platform/log/common/log';
import { ISessionsService } from 'cs/sessions/services/sessions/browser/sessionsService';
import { SessionsContextKeys } from 'cs/sessions/common/contextkeys';
import {
	ChatInteractivity,
	type IChat,
} from 'cs/sessions/services/sessions/common/session';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import {
	BrowserActionCategory,
	BrowserEditor,
	BrowserEditorContribution,
	BROWSER_EDITOR_ACTIVE,
	CONTEXT_BROWSER_HAS_ERROR,
	CONTEXT_BROWSER_HAS_URL,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import {
	createChatImageAttachment,
	type ChatImageMimeType,
	type IChatImageAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatImageAttachment';

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

function formatRect(rect: IBrowserViewRect): string {
	return [
		`- x: ${Math.round(rect.x)}px`,
		`- y: ${Math.round(rect.y)}px`,
		`- width: ${Math.round(rect.width)}px`,
		`- height: ${Math.round(rect.height)}px`,
	].join('\n');
}

function getElementDisplayName(elementData: IElementData): string {
	const lastAncestor = elementData.ancestors?.at(-1);
	if (!lastAncestor) {
		return localize('browser.element', "Element");
	}

	const id = lastAncestor.id ? `#${lastAncestor.id}` : '';
	const classes = lastAncestor.classNames?.length ? `.${lastAncestor.classNames.join('.')}` : '';
	return `${lastAncestor.tagName.toLowerCase()}${id}${classes}`;
}

function createElementContextValue(
	elementData: IElementData,
	displayName: string,
): string {
	const sections: string[] = [
		localize('browser.attachedElementContext', "Attached Element Context from Integrated Browser"),
		`${localize('browser.elementLabel', "Element")}: ${displayName}`,
	];

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

	sections.push(`${localize('browser.cssLabel', "CSS")}:\n\`\`\`css\n${elementData.computedStyle}\n\`\`\``);
	return sections.join('\n\n');
}

function requireBrowserEditorChatIntegration(candidate: unknown): BrowserEditorChatIntegration {
	if (!(candidate instanceof BrowserEditor)) {
		throw new Error('Browser Add to Chat requires an active Browser Editor.');
	}
	const editor = candidate;
	const integration = editor.getContribution(BrowserEditorChatIntegration);
	if (!integration) {
		throw new Error('The target Browser Editor has no Sessions Chat integration.');
	}
	return integration;
}

function toPromise<T>(event: Event<T>): Promise<T> {
	return new Promise<T>(resolve => Event.once(event)(resolve));
}

/** Adds Browser Editor context to one explicitly addressed Session Chat. */
export class BrowserEditorChatIntegration extends BrowserEditorContribution {
	private readonly elementSelectionActiveContext: ContextKey<boolean>;
	private readonly areaSelectionActiveContext: ContextKey<boolean>;
	private elementSelectionChatResource: URI | undefined;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ISessionsService private readonly sessionsService: ISessionsService,
		@IChatService private readonly chatService: IChatService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super(editor);
		this.elementSelectionActiveContext = CONTEXT_BROWSER_ELEMENT_SELECTION_ACTIVE.bindTo(contextKeyService);
		this.areaSelectionActiveContext = CONTEXT_BROWSER_AREA_SELECTION_ACTIVE.bindTo(contextKeyService);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.elementSelectionChatResource = undefined;
		this.elementSelectionActiveContext.set(model.isElementSelectionActive);
		this.areaSelectionActiveContext.set(model.isAreaSelectionActive);

		store.add(model.onDidChangeElementSelectionActive(active => {
			this.elementSelectionActiveContext.set(active);
		}));
		store.add(model.onDidChangeAreaSelectionActive(active => {
			this.areaSelectionActiveContext.set(active);
		}));
		store.add(model.onDidSelectElement(data => {
			const chatResource = this.elementSelectionChatResource;
			this.elementSelectionChatResource = undefined;
			if (!chatResource) {
				this.logService.error('BrowserEditor.addElementToChat: Selection has no addressed Chat resource.');
				return;
			}
			void this.attachElementDataToChat(data, model, chatResource).catch(error => {
				this.logService.error('BrowserEditor.addElementToChat: Failed to attach element', error);
			});
		}));
	}

	override onModelDetached(): void {
		this.elementSelectionChatResource = undefined;
		this.elementSelectionActiveContext.reset();
		this.areaSelectionActiveContext.reset();
	}

	async toggleElementSelection(): Promise<void> {
		const model = this.requireModel();
		const chat = this.requireActiveChat();
		this.elementSelectionChatResource = model.isElementSelectionActive ? undefined : chat.resource;
		this.editor.ensureBrowserFocus();
		try {
			await model.toggleElementSelection();
		} catch (error) {
			this.elementSelectionChatResource = undefined;
			throw error;
		}
	}

	async addConsoleLogsToChat(): Promise<void> {
		const model = this.requireModel();
		const chat = this.requireActiveChat();
		const logs = await model.getConsoleLogs();
		if (!logs.trim()) {
			return;
		}

		this.insertBrowserContext(
			chat,
			localize('browser.consoleLogsTitle', "Browser Console Logs"),
			[
				localize('browser.attachedConsoleLogs', "Attached Console Logs from Integrated Browser"),
				`${localize('browser.urlLabel', "URL")}: ${model.url}`,
				['```text', logs, '```'].join('\n'),
			].join('\n\n'),
			[],
		);
	}

	async addScreenshotToChat(): Promise<void> {
		await this.captureScreenshotToChat(
			this.requireModel(),
			this.requireActiveChat(),
			'viewport',
			localize('browser.screenshotTitle', "Browser Screenshot"),
			{ quality: 80 },
		);
	}

	async addAreaScreenshotToChat(): Promise<void> {
		const model = this.requireModel();
		const chat = this.requireActiveChat();
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
			model,
			chat,
			'area',
			localize('browser.areaScreenshotTitle', "Browser Area Screenshot"),
			{ quality: 80, pageRect: rect, awaitNextPaint: true },
		);
	}

	async addFullPageScreenshotToChat(): Promise<void> {
		await this.captureScreenshotToChat(
			this.requireModel(),
			this.requireActiveChat(),
			'fullPage',
			localize('browser.fullPageScreenshotTitle', "Browser Full Page Screenshot"),
			{ fullPage: true, format: 'png' },
		);
	}

	private async attachElementDataToChat(
		elementData: IElementData,
		model: IBrowserViewModel,
		chatResource: URI,
	): Promise<void> {
		const displayName = getElementDisplayName(elementData);
		const attachImages = this.configurationService.getValue<boolean>(BrowserSendElementsToChatAttachImagesSettingId);
		const screenshot = attachImages
			? await model.captureScreenshot({ quality: 90, pageRect: elementData.bounds })
			: undefined;
		const imageAttachments = screenshot
			? [createChatImageAttachment(
				generateUuid(),
				`${displayName}.jpeg`,
				'image/jpeg',
				screenshot,
			)]
			: [];
		const chat = this.requireChatResource(chatResource);

		this.insertBrowserContext(
			chat,
			localize('browser.elementContextTitle', "Browser Element"),
			createElementContextValue(elementData, displayName),
			imageAttachments,
		);
	}

	private async captureScreenshotToChat(
		model: IBrowserViewModel,
		chat: IChat,
		type: 'viewport' | 'area' | 'fullPage',
		title: string,
		options: NonNullable<Parameters<IBrowserViewModel['captureScreenshot']>[0]>,
	): Promise<void> {
		const screenshot = await model.captureScreenshot(options);
		const mimeType: ChatImageMimeType = options.format === 'png' ? 'image/png' : 'image/jpeg';
		const extension = mimeType === 'image/png' ? 'png' : 'jpeg';
		const image = createChatImageAttachment(
			generateUuid(),
			`${title}.${extension}`,
			mimeType,
			screenshot,
		);
		this.insertBrowserContext(
			chat,
			title,
			[
				localize('browser.attachedScreenshot', "Attached Screenshot from Integrated Browser"),
				`${localize('browser.screenshotTypeLabel', "Screenshot Type")}: ${type}`,
				`${localize('browser.urlLabel', "URL")}: ${model.url}`,
				`${localize('browser.screenshotSizeLabel', "Screenshot Size")}: ${screenshot.byteLength} bytes`,
			].join('\n\n'),
			[image],
		);
	}

	private insertBrowserContext(
		chat: IChat,
		title: string,
		content: string,
		imageAttachments: readonly IChatImageAttachment[],
	): void {
		if (chat.interactivity.get() !== ChatInteractivity.Full) {
			throw new Error('Browser Add to Chat requires a fully interactive Chat.');
		}
		this.chatService.insertContextMessage(
			chat.resource,
			`## ${title}\n\n${content}`,
			imageAttachments,
		);
	}

	private requireModel(): IBrowserViewModel {
		const model = this.editor.model;
		if (!model) {
			throw new Error('Browser Add to Chat requires an attached Browser page.');
		}
		return model;
	}

	private requireActiveChat(): IChat {
		const activeSession = this.sessionsService.activeSession.get();
		if (!activeSession) {
			throw new Error('Browser Add to Chat requires an active Session.');
		}
		const chat = activeSession.activeChat.get();
		if (chat.interactivity.get() !== ChatInteractivity.Full) {
			throw new Error('Browser Add to Chat requires a fully interactive Chat.');
		}
		return chat;
	}

	private requireChatResource(resource: URI): IChat {
		const activeSession = this.sessionsService.activeSession.get();
		const chat = activeSession?.chats.get().find(candidate =>
			isEqual(candidate.resource, resource),
		);
		if (!chat) {
			throw new Error('Browser Add to Chat target is no longer active.');
		}
		return chat;
	}
}

BrowserEditor.registerContribution(BrowserEditorChatIntegration);

const browserCanAddToChat = ContextKeyExpr.and(
	BROWSER_EDITOR_ACTIVE,
	CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
	CONTEXT_BROWSER_HAS_ERROR.isEqualTo(false),
	SessionsContextKeys.activeChatFullyInteractive.isEqualTo(true),
);

class AddElementToChatAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.AddElementToChat,
			title: localize2('browser.addElementToChatAction', "Add Element to Chat"),
			category: BrowserActionCategory,
			icon: Codicon.inspect,
			f1: true,
			precondition: browserCanAddToChat,
			toggled: CONTEXT_BROWSER_ELEMENT_SELECTION_ACTIVE.isEqualTo(true),
			keybinding: [
				{
					when: ActiveEditorFocusedContext.isEqualTo(true),
					weight: KeybindingWeight.WorkbenchContrib + 50,
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC,
				},
				{
					when: ContextKeyExpr.and(
						ActiveEditorFocusedContext.isEqualTo(true),
						CONTEXT_BROWSER_ELEMENT_SELECTION_ACTIVE.isEqualTo(true),
					),
					weight: KeybindingWeight.WorkbenchContrib,
					primary: KeyCode.Escape,
				},
			],
		});
	}

	async run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		await requireBrowserEditorChatIntegration(browserEditor).toggleElementSelection();
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
			precondition: browserCanAddToChat,
		});
	}

	async run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		await requireBrowserEditorChatIntegration(browserEditor).addConsoleLogsToChat();
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
			precondition: browserCanAddToChat,
		});
	}

	async run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		await requireBrowserEditorChatIntegration(browserEditor).addScreenshotToChat();
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
			precondition: browserCanAddToChat,
			toggled: CONTEXT_BROWSER_AREA_SELECTION_ACTIVE.isEqualTo(true),
		});
	}

	async run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		await requireBrowserEditorChatIntegration(browserEditor).addAreaScreenshotToChat();
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
			precondition: browserCanAddToChat,
		});
	}

	async run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		await requireBrowserEditorChatIntegration(browserEditor).addFullPageScreenshotToChat();
	}
}

registerAction2(AddElementToChatAction);
registerAction2(AddConsoleLogsToChatAction);
registerAction2(AddScreenshotToChatAction);
registerAction2(AddAreaScreenshotToChatAction);
registerAction2(AddFullPageScreenshotToChatAction);

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
