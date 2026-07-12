/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeBase64, VSBuffer } from 'cs/base/common/buffer';
import { Event } from 'cs/base/common/event';
import { observableValue } from 'cs/base/common/observable';
import { URI } from 'cs/base/common/uri';
import { MenuRegistry } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import { commandsRegistry } from 'cs/platform/commands/common/commands';
import { ConfigurationService } from 'cs/platform/configuration/common/configurationService';
import { configurationRegistry, ConfigurationScope } from 'cs/platform/configuration/common/configurationRegistry';
import { ContextKeyServiceImpl } from 'cs/platform/contextkey/common/contextkey';
import { KeybindingsRegistry } from 'cs/platform/keybinding/common/keybindingsRegistry';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import type { ILogService } from 'cs/platform/log/common/log';
import {
	BrowserEditorChatIntegration,
} from 'cs/sessions/contrib/browserView/electron-browser/browserViewChat.contribution';
import type { ISessionsService } from 'cs/sessions/services/sessions/browser/sessionsService';
import { SessionsContextKeys } from 'cs/sessions/common/contextkeys';
import {
	ChatInteractivity,
	type IChat,
} from 'cs/sessions/services/sessions/common/session';
import type { IActiveSession } from 'cs/sessions/services/sessions/common/sessionsView';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { BrowserEditor } from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import type { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type { IChatImageAttachment } from 'cs/workbench/contrib/chat/common/chatService/chatImageAttachment';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';

const throwingAccessor = {
	get(): never {
		throw new Error('Browser Chat actions must not read services from ServicesAccessor.');
	},
} as ServicesAccessor;

const testLogService = {
	_serviceBrand: undefined,
	trace() {},
	debug() {},
	info() {},
	warn() {},
	error() {},
} as ILogService;

interface IContextInsert {
	readonly resource: URI;
	readonly content: string;
	readonly imageAttachments: readonly IChatImageAttachment[];
}

interface IIntegrationHarness {
	readonly editor: BrowserEditor;
	readonly integration: BrowserEditorChatIntegration;
	readonly inserts: IContextInsert[];
	readonly screenshotOptions: unknown[];
	readonly consoleLogReads: { count: number };
}

function createHarness(activeChatResource: URI | undefined): IIntegrationHarness {
	const inserts: IContextInsert[] = [];
	const screenshotOptions: unknown[] = [];
	const consoleLogReads = { count: 0 };
	const mainChatResource = URI.parse('chat://main');
	const activeChat = {
		resource: activeChatResource,
		interactivity: observableValue('browserChatInteractivity', ChatInteractivity.Full),
	} as unknown as IChat;
	const activeSession = activeChatResource
		? {
			sessionId: 'default:session-resource',
			resource: URI.parse('session://resource'),
			mainChat: observableValue<IChat>('browserChatMainChat', { resource: mainChatResource } as IChat),
			chats: observableValue<readonly IChat[]>('browserChatChats', [activeChat]),
			activeChat: observableValue<IChat>('browserChatActiveChat', activeChat),
		} as unknown as IActiveSession
		: undefined;
	const sessionsService = {
		_serviceBrand: undefined,
		activeSession: observableValue<IActiveSession | undefined>('browserChatActiveSession', activeSession),
	} as unknown as ISessionsService;
	const chatService = {
		_serviceBrand: undefined,
		insertContextMessage(
			resource: URI,
			content: string,
			imageAttachments: readonly IChatImageAttachment[],
		): void {
			inserts.push({ resource, content, imageAttachments });
		},
	} as IChatService;
	const model = {
		url: 'https://example.com/article',
		isElementSelectionActive: false,
		isAreaSelectionActive: false,
		getConsoleLogs: async () => {
			consoleLogReads.count += 1;
			return 'console.log("addressed");';
		},
		captureScreenshot: async (options: unknown) => {
			screenshotOptions.push(options);
			return VSBuffer.fromString('jpeg-bytes');
		},
	} as IBrowserViewModel;

	let integration: BrowserEditorChatIntegration;
	const editor = Object.create(BrowserEditor.prototype) as BrowserEditor;
	Object.defineProperties(editor, {
		onDidChangeModel: { value: Event.None },
		model: { get: () => model },
		ensureBrowserFocus: { value: () => undefined },
		getContribution: {
			value: (constructor: unknown) => constructor === BrowserEditorChatIntegration ? integration : undefined,
		},
	});
	integration = new BrowserEditorChatIntegration(
		editor,
		new ContextKeyServiceImpl(),
		sessionsService,
		chatService,
		new ConfigurationService(),
		testLogService,
	);

	return { editor, integration, inserts, screenshotOptions, consoleLogReads };
}

function executeBrowserChatCommand(
	commandId: BrowserViewCommandId,
	editor?: BrowserEditor,
	activeEditorPane?: BrowserEditor | null,
): Promise<unknown> {
	const command = commandsRegistry.getCommand(commandId);
	assert.ok(command, `Expected '${commandId}' to be registered.`);
	const accessor = activeEditorPane !== undefined
		? {
			get(service: unknown) {
				assert.equal(service, IEditorService);
				return { activeEditorPane: activeEditorPane ?? undefined };
			},
		} as ServicesAccessor
		: throwingAccessor;
	return Promise.resolve(command.handler(accessor, editor));
}

test('Sessions Browser Chat contribution registers stable commands and configuration', () => {
	const commandIds = [
		BrowserViewCommandId.AddElementToChat,
		BrowserViewCommandId.AddConsoleLogsToChat,
		BrowserViewCommandId.AddScreenshotToChat,
		BrowserViewCommandId.AddAreaScreenshotToChat,
		BrowserViewCommandId.AddFullPageScreenshotToChat,
	];

	assert.deepEqual(commandIds.map(commandId => commandsRegistry.getCommand(commandId)?.id), commandIds);
	const properties = configurationRegistry.getConfigurationProperties();
	assert.deepEqual({
		enableChatTools: {
			type: properties['workbench.browser.enableChatTools'].type,
			default: properties['workbench.browser.enableChatTools'].default,
			scope: properties['workbench.browser.enableChatTools'].scope,
		},
		experimentalUserTools: {
			type: properties['workbench.browser.experimentalUserTools.enabled'].type,
			default: properties['workbench.browser.experimentalUserTools.enabled'].default,
			scope: properties['workbench.browser.experimentalUserTools.enabled'].scope,
			tags: properties['workbench.browser.experimentalUserTools.enabled'].tags,
		},
		attachImages: {
			type: properties['workbench.browser.sendElementsToChat.attachImages'].type,
			default: properties['workbench.browser.sendElementsToChat.attachImages'].default,
			scope: properties['workbench.browser.sendElementsToChat.attachImages'].scope,
		},
	}, {
		enableChatTools: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
		},
		experimentalUserTools: {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.APPLICATION,
			tags: ['experimental'],
		},
		attachImages: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
		},
	});
});

test('Browser Chat actions require an active Browser and a fully interactive Chat', () => {
	const command = MenuRegistry.getCommand(BrowserViewCommandId.AddScreenshotToChat);
	assert.ok(command?.precondition);
	const contextKeyService = new ContextKeyServiceImpl();
	contextKeyService.setContextKeyValue('activeEditor', BrowserEditorInput.EDITOR_ID);
	contextKeyService.setContextKeyValue('browserHasUrl', true);
	contextKeyService.setContextKeyValue('browserHasError', false);
	contextKeyService.setContextKeyValue(SessionsContextKeys.activeChatFullyInteractive.key, false);
	assert.equal(contextKeyService.contextMatchesRules(command.precondition), false);

	contextKeyService.setContextKeyValue(SessionsContextKeys.activeChatFullyInteractive.key, true);
	assert.equal(contextKeyService.contextMatchesRules(command.precondition), true);

	contextKeyService.setContextKeyValue('activeEditor', 'workbench.editor.draft');
	assert.equal(contextKeyService.contextMatchesRules(command.precondition), false);
});

test('Browser element selection shortcuts require Browser editor focus', () => {
	const keybindings = KeybindingsRegistry.getDefaultKeybindings().filter(
		keybinding => keybinding.command === BrowserViewCommandId.AddElementToChat,
	);
	assert.equal(keybindings.length, 2);

	const contextKeyService = new ContextKeyServiceImpl();
	contextKeyService.setContextKeyValue('activeEditor', BrowserEditorInput.EDITOR_ID);
	contextKeyService.setContextKeyValue('browserHasUrl', true);
	contextKeyService.setContextKeyValue('browserHasError', false);
	contextKeyService.setContextKeyValue(SessionsContextKeys.activeChatFullyInteractive.key, true);
	contextKeyService.setContextKeyValue('browserElementSelectionActive', true);
	contextKeyService.setContextKeyValue(ActiveEditorFocusedContext.key, false);
	assert.equal(
		keybindings.filter(keybinding => contextKeyService.contextMatchesRules(keybinding.when)).length,
		0,
	);

	contextKeyService.setContextKeyValue(ActiveEditorFocusedContext.key, true);
	assert.equal(
		keybindings.filter(keybinding => contextKeyService.contextMatchesRules(keybinding.when)).length,
		2,
	);

	contextKeyService.setContextKeyValue('browserElementSelectionActive', false);
	assert.equal(
		keybindings.filter(keybinding => contextKeyService.contextMatchesRules(keybinding.when)).length,
		1,
	);
});

test('console logs and screenshots address the active Session Chat resource', async () => {
	const activeChatResource = URI.parse('chat://active-peer');
	const harness = createHarness(activeChatResource);
	try {
		await executeBrowserChatCommand(
			BrowserViewCommandId.AddConsoleLogsToChat,
			undefined,
			harness.editor,
		);
		await executeBrowserChatCommand(BrowserViewCommandId.AddScreenshotToChat, harness.editor);

		assert.deepEqual(harness.inserts.map(insert => insert.resource.toString()), [
			activeChatResource.toString(),
			activeChatResource.toString(),
		]);
		assert.match(harness.inserts[0]?.content ?? '', /^## Browser Console Logs/m);
		assert.match(harness.inserts[0]?.content ?? '', /console\.log\("addressed"\);/);
		assert.match(harness.inserts[1]?.content ?? '', /^## Browser Screenshot/m);
		assert.match(harness.inserts[1]?.content ?? '', /Screenshot Type: viewport/);
		assert.match(harness.inserts[1]?.content ?? '', /Screenshot Size: 10 bytes/);
		assert.equal(harness.inserts[1]?.imageAttachments.length, 1);
		assert.equal(harness.inserts[1]?.imageAttachments[0]?.mimeType, 'image/jpeg');
		assert.equal(
			harness.inserts[1]?.imageAttachments[0]?.data,
			encodeBase64(VSBuffer.fromString('jpeg-bytes')),
		);
		assert.deepEqual(harness.screenshotOptions, [{ quality: 80 }]);
	} finally {
		harness.integration.dispose();
	}
});

test('Browser Chat actions fail explicitly without an active Session or Browser Editor target', async () => {
	const harness = createHarness(undefined);
	try {
		await assert.rejects(
			executeBrowserChatCommand(BrowserViewCommandId.AddConsoleLogsToChat, harness.editor),
			/Browser Add to Chat requires an active Session/,
		);
		assert.equal(harness.consoleLogReads.count, 0);
		assert.deepEqual(harness.inserts, []);
		await assert.rejects(
			executeBrowserChatCommand(BrowserViewCommandId.AddScreenshotToChat, undefined, null),
			/requires an active Browser Editor/,
		);
	} finally {
		harness.integration.dispose();
	}
});
