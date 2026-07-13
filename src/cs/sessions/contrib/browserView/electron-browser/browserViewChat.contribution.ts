/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { Event } from 'cs/base/common/event';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { isEqual } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
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
import {
	ChatInteractivity,
	type IChat,
	type SessionId,
} from 'cs/sessions/services/sessions/common/session';
import { ISessionsManagementService } from 'cs/sessions/services/sessions/common/sessionsManagement';
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
import {
	BrowserChatAttachmentsContribution,
	createBrowserImageAttachment,
	createBrowserTextAttachment,
} from 'cs/sessions/contrib/browserView/electron-browser/browserChatAttachments';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

const BrowserSendElementsToChatAttachImagesSettingId = 'workbench.browser.sendElementsToChat.attachImages';

const CONTEXT_BROWSER_ELEMENT_SELECTION_ACTIVE = new RawContextKey<boolean>('browserElementSelectionActive', false);
const CONTEXT_BROWSER_AREA_SELECTION_ACTIVE = new RawContextKey<boolean>('browserAreaSelectionActive', false);

interface IBrowserCapturedImage {
	readonly name: string;
	readonly mediaType: 'image/jpeg' | 'image/png';
	readonly data: Awaited<ReturnType<IBrowserViewModel['captureScreenshot']>>;
}

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

/** Identifies one exact Session Chat addressed by a Browser action. */
export interface IBrowserChatTarget {
	readonly sessionId: SessionId;
	readonly chatResource: URI;
}

/** Carries the Browser source and exact Session Chat target for one action. */
export interface IBrowserChatActionContext extends IBrowserChatTarget {
	readonly browserEditor: BrowserEditor;
}

function requireBrowserChatActionContext(candidate: unknown): {
	readonly integration: BrowserEditorChatIntegration;
	readonly target: IBrowserChatTarget;
} {
	if (!candidate || typeof candidate !== 'object') {
		throw new Error('Browser Add to Chat requires an addressed Browser, Session, and Chat context.');
	}
	const context = candidate as Partial<IBrowserChatActionContext>;
	if (!(context.browserEditor instanceof BrowserEditor)
		|| typeof context.sessionId !== 'string'
		|| !context.sessionId
		|| !URI.isUri(context.chatResource)) {
		throw new Error('Browser Add to Chat requires an addressed Browser, Session, and Chat context.');
	}
	const integration = context.browserEditor.getContribution(BrowserEditorChatIntegration);
	if (!integration) {
		throw new Error('The target Browser Editor has no Sessions Chat integration.');
	}
	return {
		integration,
		target: Object.freeze({
			sessionId: context.sessionId,
			chatResource: context.chatResource,
		}),
	};
}

function toPromise<T>(event: Event<T>): Promise<T> {
	return new Promise<T>(resolve => Event.once(event)(resolve));
}

/** Adds Browser Editor context to one explicitly addressed Session Chat. */
export class BrowserEditorChatIntegration extends BrowserEditorContribution {
	private readonly elementSelectionActiveContext: ContextKey<boolean>;
	private readonly areaSelectionActiveContext: ContextKey<boolean>;
	private elementSelectionTarget: IBrowserChatTarget | undefined;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@IChatService private readonly chatService: IChatService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
	) {
		super(editor);
		this.elementSelectionActiveContext = CONTEXT_BROWSER_ELEMENT_SELECTION_ACTIVE.bindTo(contextKeyService);
		this.areaSelectionActiveContext = CONTEXT_BROWSER_AREA_SELECTION_ACTIVE.bindTo(contextKeyService);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.elementSelectionTarget = undefined;
		this.elementSelectionActiveContext.set(model.isElementSelectionActive);
		this.areaSelectionActiveContext.set(model.isAreaSelectionActive);

		store.add(model.onDidChangeElementSelectionActive(active => {
			this.elementSelectionActiveContext.set(active);
		}));
		store.add(model.onDidChangeAreaSelectionActive(active => {
			this.areaSelectionActiveContext.set(active);
		}));
		store.add(model.onDidSelectElement(data => {
			const target = this.elementSelectionTarget;
			this.elementSelectionTarget = undefined;
			if (!target) {
				this.logService.error('BrowserEditor.addElementToChat: Selection has no addressed Session Chat target.');
				return;
			}
			void this.attachElementDataToChat(data, model, target).catch(error => {
				this.logService.error('BrowserEditor.addElementToChat: Failed to attach element', error);
			});
		}));
	}

	override onModelDetached(): void {
		this.elementSelectionTarget = undefined;
		this.elementSelectionActiveContext.reset();
		this.areaSelectionActiveContext.reset();
	}

	async toggleElementSelection(target: IBrowserChatTarget): Promise<void> {
		this.requireTargetChat(target);
		const model = this.requireModel();
		this.elementSelectionTarget = model.isElementSelectionActive ? undefined : target;
		this.editor.ensureBrowserFocus();
		try {
			await model.toggleElementSelection();
		} catch (error) {
			this.elementSelectionTarget = undefined;
			throw error;
		}
	}

	async addConsoleLogsToChat(target: IBrowserChatTarget): Promise<void> {
		this.requireTargetChat(target);
		const model = this.requireModel();
		const logs = await model.getConsoleLogs();
		if (!logs.trim()) {
			return;
		}

		this.addBrowserContext(
			target,
			localize('browser.consoleLogsTitle', "Browser Console Logs"),
			[
				localize('browser.attachedConsoleLogs', "Attached Console Logs from Integrated Browser"),
				`${localize('browser.urlLabel', "URL")}: ${model.url}`,
				['```text', logs, '```'].join('\n'),
			].join('\n\n'),
			[],
		);
	}

	async addScreenshotToChat(target: IBrowserChatTarget): Promise<void> {
		this.requireTargetChat(target);
		await this.captureScreenshotToChat(
			this.requireModel(),
			target,
			'viewport',
			localize('browser.screenshotTitle', "Browser Screenshot"),
			{ quality: 80 },
		);
	}

	async addAreaScreenshotToChat(target: IBrowserChatTarget): Promise<void> {
		this.requireTargetChat(target);
		const model = this.requireModel();
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
			target,
			'area',
			localize('browser.areaScreenshotTitle', "Browser Area Screenshot"),
			{ quality: 80, pageRect: rect, awaitNextPaint: true },
		);
	}

	async addFullPageScreenshotToChat(target: IBrowserChatTarget): Promise<void> {
		this.requireTargetChat(target);
		await this.captureScreenshotToChat(
			this.requireModel(),
			target,
			'fullPage',
			localize('browser.fullPageScreenshotTitle', "Browser Full Page Screenshot"),
			{ fullPage: true, format: 'png' },
		);
	}

	private async attachElementDataToChat(
		elementData: IElementData,
		model: IBrowserViewModel,
		target: IBrowserChatTarget,
	): Promise<void> {
		this.requireTargetChat(target);
		const displayName = getElementDisplayName(elementData);
		const attachImages = this.configurationService.getValue<boolean>(BrowserSendElementsToChatAttachImagesSettingId);
		const screenshot = attachImages
			? await model.captureScreenshot({ quality: 90, pageRect: elementData.bounds })
			: undefined;
		const images: readonly IBrowserCapturedImage[] = screenshot
			? [{ name: `${displayName}.jpeg`, mediaType: 'image/jpeg', data: screenshot }]
			: [];
		this.addBrowserContext(
			target,
			localize('browser.elementContextTitle', "Browser Element"),
			createElementContextValue(elementData, displayName),
			images,
		);
	}

	private async captureScreenshotToChat(
		model: IBrowserViewModel,
		target: IBrowserChatTarget,
		type: 'viewport' | 'area' | 'fullPage',
		title: string,
		options: NonNullable<Parameters<IBrowserViewModel['captureScreenshot']>[0]>,
	): Promise<void> {
		const screenshot = await model.captureScreenshot(options);
		const mimeType: IBrowserCapturedImage['mediaType'] = options.format === 'png' ? 'image/png' : 'image/jpeg';
		const extension = mimeType === 'image/png' ? 'png' : 'jpeg';
		this.addBrowserContext(
			target,
			title,
			[
				localize('browser.attachedScreenshot', "Attached Screenshot from Integrated Browser"),
				`${localize('browser.screenshotTypeLabel', "Screenshot Type")}: ${type}`,
				`${localize('browser.urlLabel', "URL")}: ${model.url}`,
				`${localize('browser.screenshotSizeLabel', "Screenshot Size")}: ${screenshot.byteLength} bytes`,
			].join('\n\n'),
			[{ name: `${title}.${extension}`, mediaType: mimeType, data: screenshot }],
		);
	}

	private addBrowserContext(
		target: IBrowserChatTarget,
		title: string,
		content: string,
		images: readonly IBrowserCapturedImage[],
	): void {
		const chat = this.requireTargetChat(target);
		this.chatService.addPendingAttachments(chat.resource, [
			createBrowserTextAttachment(generateUuid(), title, `## ${title}\n\n${content}`),
			...images.map(image => createBrowserImageAttachment(
				generateUuid(),
				image.name,
				image.mediaType,
				image.data,
			)),
		]);
	}

	private requireModel(): IBrowserViewModel {
		const model = this.editor.model;
		if (!model) {
			throw new Error('Browser Add to Chat requires an attached Browser page.');
		}
		return model;
	}

	private requireTargetChat(target: IBrowserChatTarget): IChat {
		const draft = this.sessionsManagementService.draftSession.get();
		const sessions = draft
			? [...this.sessionsManagementService.getSessions(), draft]
			: this.sessionsManagementService.getSessions();
		const matchingSessions = sessions.filter(session => session.sessionId === target.sessionId);
		if (matchingSessions.length !== 1) {
			throw new Error(`Browser Add to Chat Session '${target.sessionId}' is not managed.`);
		}
		const chat = matchingSessions[0].chats.get().find(candidate =>
			isEqual(candidate.resource, target.chatResource),
		);
		if (!chat) {
			throw new Error(`Browser Add to Chat Chat '${target.chatResource.toString()}' is not owned by Session '${target.sessionId}'.`);
		}
		if (chat.interactivity.get() !== ChatInteractivity.Full) {
			throw new Error('Browser Add to Chat requires a fully interactive Chat.');
		}
		return chat;
	}
}

BrowserEditor.registerContribution(BrowserEditorChatIntegration);

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(BrowserChatAttachmentsContribution),
);

const browserCanAddToChat = ContextKeyExpr.and(
	BROWSER_EDITOR_ACTIVE,
	CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
	CONTEXT_BROWSER_HAS_ERROR.isEqualTo(false),
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

	async run(_accessor: ServicesAccessor, context?: IBrowserChatActionContext): Promise<void> {
		const { integration, target } = requireBrowserChatActionContext(context);
		await integration.toggleElementSelection(target);
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

	async run(_accessor: ServicesAccessor, context?: IBrowserChatActionContext): Promise<void> {
		const { integration, target } = requireBrowserChatActionContext(context);
		await integration.addConsoleLogsToChat(target);
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

	async run(_accessor: ServicesAccessor, context?: IBrowserChatActionContext): Promise<void> {
		const { integration, target } = requireBrowserChatActionContext(context);
		await integration.addScreenshotToChat(target);
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

	async run(_accessor: ServicesAccessor, context?: IBrowserChatActionContext): Promise<void> {
		const { integration, target } = requireBrowserChatActionContext(context);
		await integration.addAreaScreenshotToChat(target);
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

	async run(_accessor: ServicesAccessor, context?: IBrowserChatActionContext): Promise<void> {
		const { integration, target } = requireBrowserChatActionContext(context);
		await integration.addFullPageScreenshotToChat(target);
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
