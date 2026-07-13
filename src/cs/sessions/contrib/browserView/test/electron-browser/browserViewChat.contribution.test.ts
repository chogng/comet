/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeBase64, VSBuffer } from 'cs/base/common/buffer';
import { Emitter, type Event } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import { observableValue } from 'cs/base/common/observable';
import { URI } from 'cs/base/common/uri';
import { MenuRegistry } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId, type IElementData } from 'cs/platform/browserView/common/browserView';
import { commandsRegistry } from 'cs/platform/commands/common/commands';
import { ConfigurationService } from 'cs/platform/configuration/common/configurationService';
import { configurationRegistry, ConfigurationScope } from 'cs/platform/configuration/common/configurationRegistry';
import { ContextKeyServiceImpl } from 'cs/platform/contextkey/common/contextkey';
import { KeybindingsRegistry } from 'cs/platform/keybinding/common/keybindingsRegistry';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import type { ILogService } from 'cs/platform/log/common/log';
import {
	BrowserEditorChatIntegration,
	type IBrowserChatActionContext,
} from 'cs/sessions/contrib/browserView/electron-browser/browserViewChat.contribution';
import {
	ChatInteractivity,
	ChatOriginKind,
	type IChat,
	type ISession,
} from 'cs/sessions/services/sessions/common/session';
import type { ISessionsManagementService } from 'cs/sessions/services/sessions/common/sessionsManagement';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { BrowserEditor } from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import type { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type { IPendingChatAttachment } from 'cs/workbench/contrib/chat/common/chatService/chatComposer';

const throwingAccessor = {
	get(): never {
		throw new Error('Browser Chat actions must not read services from ServicesAccessor.');
	},
} as ServicesAccessor;

interface IContextInsert {
	readonly resource: URI;
	readonly attachments: readonly IPendingChatAttachment[];
}

interface IIntegrationHarness {
	readonly editor: BrowserEditor;
	readonly integration: BrowserEditorChatIntegration;
	readonly inserts: IContextInsert[];
	readonly screenshotOptions: unknown[];
	readonly consoleLogReads: { count: number };
	readonly onDidLogError: Event<readonly unknown[]>;
	readonly selectElement: (data: IElementData) => void;
	readonly setSessions: (sessions: readonly ISession[]) => void;
	readonly ownedEmitters: readonly IDisposable[];
}

function requireAttachmentStateString(
	attachment: IPendingChatAttachment | undefined,
	key: string,
): string {
	const state = attachment?.state;
	if (state === null || typeof state !== 'object' || Array.isArray(state)) {
		throw new Error('Expected a pending attachment state record.');
	}
	const value = (state as Readonly<Record<string, unknown>>)[key];
	if (typeof value !== 'string') {
		throw new Error(`Expected pending attachment state '${key}' to be a string.`);
	}
	return value;
}

function createChat(resource: URI, interactivity = ChatInteractivity.Full): IChat {
	return {
		resource,
		origin: { kind: ChatOriginKind.User },
		interactivity: observableValue('browserChatInteractivity', interactivity),
	} as unknown as IChat;
}

function createSession(sessionId: string, chats: readonly IChat[]): ISession {
	return {
		sessionId,
		chats: observableValue<readonly IChat[]>('browserChatChats', chats),
	} as unknown as ISession;
}

function createHarness(
	initialSessions: readonly ISession[],
	draftSession: ISession | undefined = undefined,
): IIntegrationHarness {
	const inserts: IContextInsert[] = [];
	const screenshotOptions: unknown[] = [];
	const consoleLogReads = { count: 0 };
	let sessions = initialSessions;
	const sessionsManagementService = {
		_serviceBrand: undefined,
		draftSession: observableValue<ISession | undefined>('browserChatDraftSession', draftSession),
		getSessions: () => sessions,
	} as unknown as ISessionsManagementService;
	const logErrorEmitter = new Emitter<readonly unknown[]>();
	const testLogService = {
		_serviceBrand: undefined,
		trace() {},
		debug() {},
		info() {},
		warn() {},
		error(...args: unknown[]) {
			logErrorEmitter.fire(args);
		},
	} as ILogService;
	const chatService = {
		_serviceBrand: undefined,
		addPendingAttachments(
			resource: URI,
			attachments: readonly IPendingChatAttachment[],
		): void {
			inserts.push({ resource, attachments });
		},
	} as IChatService;
	const elementSelectionActiveEmitter = new Emitter<boolean>();
	const areaSelectionActiveEmitter = new Emitter<boolean>();
	const selectElementEmitter = new Emitter<IElementData>();
	let elementSelectionActive = false;
	const model = {
		url: 'https://example.com/article',
		get isElementSelectionActive() {
			return elementSelectionActive;
		},
		isAreaSelectionActive: false,
		onDidChangeElementSelectionActive: elementSelectionActiveEmitter.event,
		onDidChangeAreaSelectionActive: areaSelectionActiveEmitter.event,
		onDidSelectElement: selectElementEmitter.event,
		toggleElementSelection: async () => {
			elementSelectionActive = !elementSelectionActive;
			elementSelectionActiveEmitter.fire(elementSelectionActive);
		},
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
	const modelChangeEmitter = new Emitter<{
		readonly model: IBrowserViewModel | undefined;
		readonly isNew: boolean;
		readonly detachReason: 'modelChanged';
	}>();
	const editor = Object.create(BrowserEditor.prototype) as BrowserEditor;
	Object.defineProperties(editor, {
		onDidChangeModel: { value: modelChangeEmitter.event },
		model: { get: () => model },
		ensureBrowserFocus: { value: () => undefined },
		getContribution: {
			value: (constructor: unknown) => constructor === BrowserEditorChatIntegration ? integration : undefined,
		},
	});
	integration = new BrowserEditorChatIntegration(
		editor,
		new ContextKeyServiceImpl(),
		sessionsManagementService,
		chatService,
		new ConfigurationService(),
		testLogService,
	);
	modelChangeEmitter.fire({ model, isNew: false, detachReason: 'modelChanged' });

	return {
		editor,
		integration,
		inserts,
		screenshotOptions,
		consoleLogReads,
		onDidLogError: logErrorEmitter.event,
		selectElement: data => selectElementEmitter.fire(data),
		setSessions: value => {
			sessions = value;
		},
		ownedEmitters: [
			logErrorEmitter,
			elementSelectionActiveEmitter,
			areaSelectionActiveEmitter,
			selectElementEmitter,
			modelChangeEmitter,
		],
	};
}

function executeBrowserChatCommand(
	commandId: BrowserViewCommandId,
	context?: IBrowserChatActionContext,
): Promise<unknown> {
	const command = commandsRegistry.getCommand(commandId);
	assert.ok(command, `Expected '${commandId}' to be registered.`);
	return Promise.resolve(command.handler(throwingAccessor, context));
}

function createActionContext(
	harness: IIntegrationHarness,
	sessionId: string,
	chatResource: URI,
): IBrowserChatActionContext {
	return {
		browserEditor: harness.editor,
		sessionId,
		chatResource,
	};
}

function once<T>(event: Event<T>): Promise<T> {
	return new Promise<T>(resolve => {
		const listener = event(value => {
			listener.dispose();
			resolve(value);
		});
	});
}

function disposeHarness(harness: IIntegrationHarness): void {
	harness.integration.dispose();
	for (const emitter of harness.ownedEmitters) {
		emitter.dispose();
	}
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

test('Browser Chat action preconditions describe only the Browser source', () => {
	const command = MenuRegistry.getCommand(BrowserViewCommandId.AddScreenshotToChat);
	assert.ok(command?.precondition);
	const contextKeyService = new ContextKeyServiceImpl();
	contextKeyService.setContextKeyValue('activeEditor', BrowserEditorInput.EDITOR_ID);
	contextKeyService.setContextKeyValue('browserHasUrl', true);
	contextKeyService.setContextKeyValue('browserHasError', false);
	assert.equal(contextKeyService.contextMatchesRules(command.precondition), true);

	contextKeyService.setContextKeyValue('browserHasError', true);
	assert.equal(contextKeyService.contextMatchesRules(command.precondition), false);
	contextKeyService.setContextKeyValue('browserHasError', false);
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

test('console logs and screenshots use the explicitly addressed Session Chat', async () => {
	const decoyChat = createChat(URI.parse('chat://decoy'));
	const addressedChat = createChat(URI.parse('chat://addressed-peer'));
	const decoySession = createSession('provider:decoy', [decoyChat]);
	const addressedSession = createSession('provider:addressed', [addressedChat]);
	const harness = createHarness([decoySession, addressedSession]);
	const context = createActionContext(harness, addressedSession.sessionId, addressedChat.resource);
	try {
		await executeBrowserChatCommand(BrowserViewCommandId.AddConsoleLogsToChat, context);
		await executeBrowserChatCommand(BrowserViewCommandId.AddScreenshotToChat, context);

		assert.deepEqual(harness.inserts.map(insert => insert.resource.toString()), [
			addressedChat.resource.toString(),
			addressedChat.resource.toString(),
		]);
		assert.match(
			requireAttachmentStateString(harness.inserts[0]?.attachments[0], 'text'),
			/^## Browser Console Logs[\s\S]*console\.log\("addressed"\);/,
		);
		assert.match(
			requireAttachmentStateString(harness.inserts[1]?.attachments[0], 'text'),
			/^## Browser Screenshot[\s\S]*Screenshot Type: viewport[\s\S]*Screenshot Size: 10 bytes/,
		);
		assert.equal(harness.inserts[1]?.attachments.length, 2);
		assert.deepEqual(harness.inserts[1]?.attachments[1]?.state, {
			name: 'Browser Screenshot.jpeg',
			mediaType: 'image/jpeg',
			base64: encodeBase64(VSBuffer.fromString('jpeg-bytes')),
		});
		assert.deepEqual(harness.screenshotOptions, [{ quality: 80 }]);
	} finally {
		disposeHarness(harness);
	}
});

test('Browser Chat actions reject missing and mismatched addressed targets before Browser reads', async () => {
	const firstChat = createChat(URI.parse('chat://first'));
	const secondChat = createChat(URI.parse('chat://second'));
	const firstSession = createSession('provider:first', [firstChat]);
	const secondSession = createSession('provider:second', [secondChat]);
	const harness = createHarness([firstSession, secondSession]);
	try {
		await assert.rejects(
			executeBrowserChatCommand(BrowserViewCommandId.AddConsoleLogsToChat),
			/requires an addressed Browser, Session, and Chat context/,
		);
		const mismatchedContext = createActionContext(harness, firstSession.sessionId, secondChat.resource);
		await assert.rejects(
			executeBrowserChatCommand(BrowserViewCommandId.AddConsoleLogsToChat, mismatchedContext),
			/not owned by Session 'provider:first'/,
		);
		await assert.rejects(
			executeBrowserChatCommand(BrowserViewCommandId.AddScreenshotToChat, mismatchedContext),
			/not owned by Session 'provider:first'/,
		);
		assert.equal(harness.consoleLogReads.count, 0);
		assert.deepEqual(harness.screenshotOptions, []);
		assert.deepEqual(harness.inserts, []);
		await assert.rejects(
			executeBrowserChatCommand(
				BrowserViewCommandId.AddScreenshotToChat,
				{ ...mismatchedContext, browserEditor: {} as BrowserEditor },
			),
			/requires an addressed Browser, Session, and Chat context/,
		);
	} finally {
		disposeHarness(harness);
	}
});

test('delayed element selection retains the exact Session and Chat pair', async () => {
	const chatResource = URI.parse('chat://element-target');
	const addressedSession = createSession('provider:addressed', [createChat(chatResource)]);
	const harness = createHarness([addressedSession]);
	const context = createActionContext(harness, addressedSession.sessionId, chatResource);
	try {
		await executeBrowserChatCommand(BrowserViewCommandId.AddElementToChat, context);
		harness.setSessions([
			createSession('provider:other', [createChat(chatResource)]),
		]);
		const loggedError = once(harness.onDidLogError);
		harness.selectElement({
			outerHTML: '<main>Addressed element</main>',
			computedStyle: 'display: block',
			bounds: { x: 0, y: 0, width: 100, height: 20 },
		});
		const errorArguments = await loggedError;

		assert.match(String(errorArguments[0]), /Failed to attach element/);
		assert.match(String(errorArguments[1]), /Session 'provider:addressed' is not managed/);
		assert.deepEqual(harness.screenshotOptions, []);
		assert.deepEqual(harness.inserts, []);
	} finally {
		disposeHarness(harness);
	}
});

test('Browser Chat actions resolve an explicitly addressed draft Chat', async () => {
	const draftChat = createChat(URI.parse('chat://draft'));
	const draftSession = createSession('provider:draft', [draftChat]);
	const harness = createHarness([], draftSession);
	try {
		await executeBrowserChatCommand(
			BrowserViewCommandId.AddConsoleLogsToChat,
			createActionContext(harness, draftSession.sessionId, draftChat.resource),
		);

		assert.deepEqual(harness.inserts.map(insert => insert.resource.toString()), [
			draftChat.resource.toString(),
		]);
	} finally {
		disposeHarness(harness);
	}
});
