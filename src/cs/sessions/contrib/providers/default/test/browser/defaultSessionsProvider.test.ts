/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import type { CancellationToken } from 'cs/base/common/cancellation';
import { errorHandler } from 'cs/base/common/errors';
import { Event } from 'cs/base/common/event';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { autorun } from 'cs/base/common/observable';
import type { ElectronInvoke } from 'cs/base/parts/sandbox/common/electronTypes';
import type {
	RunMainAgentTurnPayload,
	RunMainAgentTurnResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { URI } from 'cs/base/common/uri';
import {
	createWritingEditorDocumentFromPlainText,
	type WritingEditorDocument,
} from 'cs/editor/common/writingEditorDocument';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import type { LanguagePackLocale } from 'cs/platform/languagePacks/common/languagePacks';
import {
	StorageScope,
	StorageTarget,
	type IStorageService,
} from 'cs/platform/storage/common/storage';
import {
	DefaultSessionsProvider,
} from 'cs/sessions/contrib/providers/default/browser/defaultSessionsProvider';
import {
	DefaultSessionTypeId,
} from 'cs/sessions/contrib/providers/default/browser/defaultSessionResources';
import {
	SessionStatus,
	SessionWorkspaceKind,
} from 'cs/sessions/services/sessions/common/session';
import { SessionTransitionKind } from 'cs/sessions/services/sessions/common/sessionsProvider';
import { ChatRequestAttachmentKind, type IChatRequestAttachment } from 'cs/workbench/contrib/chat/common/chatRequest';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import type { IDraftEditorService } from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import { parseLlmModelOptionValue } from 'cs/workbench/services/llm/registry';
import {
	WorkbenchLanguageService,
} from 'cs/workbench/services/language/common/languageService';
import type {
	IWorkbenchLocaleService,
	LocaleServiceContext,
} from 'cs/workbench/services/localization/common/locale';
import type {
	ArticleDetail,
	ArticleId,
	ArticleListCatalog,
	ArticleListItem,
	ArticleListItemId,
	ArticleListSourceId,
	ArticlePage,
	ArticlePageId,
	ArticleRecord,
	FetchLoadState,
	IFetchService,
	JournalDescriptor,
	JournalId,
} from 'cs/workbench/services/fetch/common/fetch';
import { SettingsModel } from 'cs/workbench/services/settings/settingsModel';

const WorkspaceLess = Object.freeze({ kind: SessionWorkspaceKind.WorkspaceLess });

function createAgentResult(
	overrides: Partial<RunMainAgentTurnResult> = {},
): RunMainAgentTurnResult {
	return {
		stopReason: 'completed',
		finalText: 'Completed answer',
		llmProvider: 'glm',
		llmModel: 'test-model',
		lastEvidenceResult: null,
		lastPatchProposal: null,
		toolTrace: [],
		...overrides,
	};
}

class TestNativeHostService implements INativeHostService {
	declare readonly _serviceBrand: undefined;
	readonly ipc = undefined;
	readonly windowControls = undefined;
	readonly webContent = undefined;
	readonly document = undefined;
	readonly payloads: RunMainAgentTurnPayload[] = [];
	result = createAgentResult();
	error: Error | undefined;
	onInvoke: ((payload: RunMainAgentTurnPayload) => void) | undefined;

	canInvoke(): boolean {
		return true;
	}

	readonly invoke = (async (command: string, args?: Record<string, unknown>) => {
		if (command !== 'run_main_agent_turn') {
			throw new Error(`Unexpected native command '${command}'.`);
		}
		const payload = args as unknown as RunMainAgentTurnPayload;
		this.payloads.push(payload);
		this.onInvoke?.(payload);
		if (this.error) {
			throw this.error;
		}
		return this.result;
	}) as ElectronInvoke;
}

class TestDraftEditorService implements IDraftEditorService {
	declare readonly _serviceBrand: undefined;
	readonly activeInput = undefined;

	canSaveActive(): boolean {
		return false;
	}

	saveActive(): boolean {
		return false;
	}

	getDocument(_resource: URI): null {
		return null;
	}

	setDocument(_resource: URI, _value: WritingEditorDocument): void {
		throw new Error('No Draft document is open in this provider test.');
	}

	getActiveRequestAttachment(): undefined {
		return undefined;
	}
}

class TestFetchService implements IFetchService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeCatalog = Event.None;
	readonly onDidChangeSource = Event.None;
	readonly onDidChangeArticle = Event.None;
	article: ArticleRecord | undefined;
	articleDetail: ArticleDetail | undefined;
	fetchedArticleDetail: ArticleDetail | undefined;
	readonly fetchedArticleIds: ArticleId[] = [];

	getJournals(): readonly JournalDescriptor[] {
		return [];
	}

	getJournal(_journalId: JournalId): undefined {
		return undefined;
	}

	getArticleListCatalog(_journalId: JournalId): ArticleListCatalog | undefined {
		return undefined;
	}

	getArticlePage(_pageId: ArticlePageId): ArticlePage | undefined {
		return undefined;
	}

	getArticlePages(_sourceId: ArticleListSourceId): readonly ArticlePage[] {
		return [];
	}

	getArticleListItem(_itemId: ArticleListItemId): ArticleListItem | undefined {
		return undefined;
	}

	getArticle(articleId: ArticleId): ArticleRecord | undefined {
		return this.article?.id === articleId ? this.article : undefined;
	}

	getArticleDetail(articleId: ArticleId): ArticleDetail | undefined {
		return this.articleDetail?.articleId === articleId ? this.articleDetail : undefined;
	}

	getCatalogLoadState(_journalId: JournalId): FetchLoadState {
		return { status: 'idle' };
	}

	getSourceLoadState(_sourceId: ArticleListSourceId): FetchLoadState {
		return { status: 'idle' };
	}

	getArticleLoadState(_articleId: ArticleId): FetchLoadState {
		return { status: 'idle' };
	}

	async discoverArticleListSources(_journalId: JournalId, _token: CancellationToken): Promise<void> {
		throw new Error('Unexpected catalog discovery in provider test.');
	}

	async fetchArticleListSource(_sourceId: ArticleListSourceId, _token: CancellationToken): Promise<void> {
		throw new Error('Unexpected article-list fetch in provider test.');
	}

	async fetchNextPage(_sourceId: ArticleListSourceId, _token: CancellationToken): Promise<void> {
		throw new Error('Unexpected next-page fetch in provider test.');
	}

	async fetchArticle(articleId: ArticleId, _token: CancellationToken): Promise<ArticleDetail> {
		this.fetchedArticleIds.push(articleId);
		if (!this.fetchedArticleDetail) {
			throw new Error(`No test Article detail exists for '${articleId}'.`);
		}
		return this.fetchedArticleDetail;
	}

	async refreshJournal(_journalId: JournalId, _token: CancellationToken): Promise<void> {
		throw new Error('Unexpected journal refresh in provider test.');
	}

	async refreshArticleListSource(_sourceId: ArticleListSourceId, _token: CancellationToken): Promise<void> {
		throw new Error('Unexpected article-list refresh in provider test.');
	}
}

class TestWorkbenchLocaleService implements IWorkbenchLocaleService {
	declare readonly _serviceBrand: undefined;

	private readonly listeners = new Set<() => void>();

	constructor(private locale: LanguagePackLocale = 'en') {}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	getLocale(): LanguagePackLocale {
		return this.locale;
	}

	applyLocale(locale: LanguagePackLocale): void {
		if (locale === this.locale) {
			return;
		}
		this.locale = locale;
		for (const listener of this.listeners) {
			listener();
		}
	}

	async updateLocalePreference(locale: LanguagePackLocale, _context: LocaleServiceContext): Promise<void> {
		this.applyLocale(locale);
	}

	syncDocumentLanguage(): void {}

	async initialize(_context: LocaleServiceContext): Promise<LanguagePackLocale> {
		return this.locale;
	}
}

function createStorageService() {
	const values = new Map<string, string>();
	const storeErrors: Error[] = [];
	const keyFor = (key: string, scope: StorageScope) => `${scope}:${key}`;
	const service = {
		_serviceBrand: undefined,
		applicationStorage: undefined,
		onDidChangeValue: Event.None,
		onDidChangeTarget: Event.None,
		onWillSaveState: Event.None,
		init: async () => {},
		close: async () => {},
		get: (key: string, scope: StorageScope, fallbackValue?: string) =>
			values.get(keyFor(key, scope)) ?? fallbackValue,
		getBoolean: (_key: string, _scope: StorageScope, fallbackValue?: boolean) => fallbackValue,
		getNumber: (_key: string, _scope: StorageScope, fallbackValue?: number) => fallbackValue,
		getObject: <T extends object>(_key: string, _scope: StorageScope, fallbackValue?: T) => fallbackValue,
		store: (key: string, value: string | number | boolean | object | undefined | null, scope: StorageScope, _target: StorageTarget) => {
			if (storeErrors.length > 0) {
				const error = storeErrors.shift()!;
				throw error;
			}
			if (typeof value !== 'string') {
				throw new Error('Default Sessions provider tests store only serialized values.');
			}
			values.set(keyFor(key, scope), value);
		},
		storeAll() {},
		remove: (key: string, scope: StorageScope) => values.delete(keyFor(key, scope)),
		keys: (scope: StorageScope, _target: StorageTarget) => [...values.keys()]
			.filter(key => key.startsWith(`${scope}:`))
			.map(key => key.slice(`${scope}:`.length)),
		log() {},
		optimize: async () => {},
		flush: async () => {},
		setRaw: (key: string, value: string) => values.set(keyFor(key, StorageScope.APPLICATION), value),
		getRaw: (key: string) => values.get(keyFor(key, StorageScope.APPLICATION)),
		failNextStore: (error: Error) => {
			storeErrors.push(error);
		},
		failNextStores: (...errors: readonly Error[]) => {
			storeErrors.push(...errors);
		},
	};
	return service as unknown as IStorageService & {
		readonly setRaw: (key: string, value: string) => void;
		readonly getRaw: (key: string) => string | undefined;
		readonly failNextStore: (error: Error) => void;
		readonly failNextStores: (...errors: readonly Error[]) => void;
	};
}

function createFixture(
	t: TestContext,
	storageService = createStorageService(),
	localeService = new TestWorkbenchLocaleService(),
) {
	const nativeHostService = new TestNativeHostService();
	const settingsModel = new SettingsModel();
	const fetchService = new TestFetchService();
	const chatService = new ChatService(
		new NoOpNotificationService(),
		new TestDraftEditorService(),
	);
	const provider = new DefaultSessionsProvider(
		nativeHostService,
		settingsModel,
		fetchService,
		chatService,
		storageService,
		localeService,
		new WorkbenchLanguageService(),
	);
	t.after(() => provider.dispose());
	return {
		provider,
		nativeHostService,
		settingsModel,
		fetchService,
		chatService,
		storageService,
		localeService,
	};
}

function createDraft(provider: DefaultSessionsProvider) {
	return provider.createSessionDraft({
		sessionType: DefaultSessionTypeId,
		workspace: WorkspaceLess,
	});
}

function requireFirstBlockId(document: WritingEditorDocument): string {
	const blockId = document.content?.[0]?.attrs?.blockId;
	if (typeof blockId !== 'string') {
		throw new Error('Expected the test Editor document to contain a stable first block ID.');
	}
	return blockId;
}

test('DefaultSessionsProvider localizes its presentation and only the active draft title at runtime', async t => {
	const localeService = new TestWorkbenchLocaleService('en');
	const { provider } = createFixture(t, createStorageService(), localeService);
	let sessionTypeEvents = 0;
	const sessionTypesListener = provider.onDidChangeSessionTypes(() => sessionTypeEvents += 1);
	t.after(() => sessionTypesListener.dispose());
	const initialSessionTypes = provider.sessionTypes;
	const draft = createDraft(provider);
	const draftChat = draft.mainChat.get();
	const initialUpdatedAt = draft.updatedAt.get().getTime();

	assert.equal(draft.title.get(), 'New chat');
	assert.equal(draftChat.title.get(), 'New chat');
	assert.equal(provider.label, 'Comet Agent');
	assert.equal(provider.sessionTypes[0]?.label, 'Agent');
	assert.equal(provider.sessionTypes, initialSessionTypes);

	localeService.applyLocale('zh');
	assert.equal(draft.title.get(), '新对话');
	assert.equal(draftChat.title.get(), '新对话');
	assert.equal(draft.updatedAt.get().getTime(), initialUpdatedAt);
	assert.equal(provider.label, 'Comet 智能体');
	assert.equal(provider.sessionTypes[0]?.label, '智能体');
	assert.notEqual(provider.sessionTypes, initialSessionTypes);
	assert.equal(sessionTypeEvents, 1);

	await provider.sendRequest(draft, draftChat, {
		prompt: 'Durable conversation title',
		attachments: [],
	});
	const committed = provider.getSessions()[0];
	assert.ok(committed);
	const committedTitle = committed.title.get();
	const committedChatTitle = committed.mainChat.get().title.get();

	localeService.applyLocale('en');
	assert.equal(committed.title.get(), committedTitle);
	assert.equal(committed.mainChat.get().title.get(), committedChatTitle);
	assert.equal(provider.label, 'Comet Agent');
	assert.equal(provider.sessionTypes[0]?.label, 'Agent');
	assert.equal(sessionTypeEvents, 2);
});

test('DefaultSessionsProvider atomically replaces its first draft and completes the addressed Chat', async t => {
	const { provider, nativeHostService, fetchService, chatService } = createFixture(t);
	const draft = createDraft(provider);
	const draftChat = draft.mainChat.get();
	const chatModelReference = chatService.acquireModel(draftChat.resource);
	t.after(() => chatModelReference.dispose());
	assert.deepEqual(provider.getSessions(), []);
	assert.equal(draft.resource.toString(), draftChat.resource.toString());
	assert.equal(draft.status.get(), SessionStatus.Draft);

	const editorDocument = createWritingEditorDocumentFromPlainText('Original target paragraph.');
	const blockId = requireFirstBlockId(editorDocument);
	const editorResource = URI.parse('draft:/target');
	fetchService.article = {
		id: 'article-1',
		journalId: 'journal-1',
		url: URI.parse('https://example.com/article-1'),
		doi: '10.1/example',
	};
	fetchService.fetchedArticleDetail = {
		articleId: 'article-1',
		journalId: 'journal-1',
		url: URI.parse('https://example.com/article-1'),
		doi: '10.1/example',
		title: 'Article title',
		abstract: 'Article abstract',
		subjects: ['Subject'],
		publishedAt: '2026-07-12',
		authors: [{ name: 'Ada Author' }],
		publication: { title: 'Journal title' },
	};
	nativeHostService.result = createAgentResult({
		lastPatchProposal: {
			patch: {
				label: 'Revise target',
				operations: [{
					kind: 'text-edit',
					edit: {
						blockId,
						kind: 'replaceBlock',
						text: 'Revised target paragraph.',
					},
				}],
			},
			accepted: true,
			operationsValidated: 1,
			failedOperationIndex: null,
			requiresCustomExecutor: false,
			validationError: null,
		},
	});

	const transitionKinds: SessionTransitionKind[] = [];
	provider.onDidChangeSessions(event => {
		for (const transition of event.transitions) {
			transitionKinds.push(transition.kind);
			if (transition.kind === SessionTransitionKind.Replaced) {
				assert.equal(transition.from, draft);
				assert.deepEqual(provider.getSessions(), [transition.to]);
				assert.equal(
					chatModelReference.object.getSnapshot().activeRequest?.prompt,
					'Use every attachment',
				);
			}
		}
	});
	nativeHostService.onInvoke = payload => {
		assert.deepEqual(transitionKinds, [SessionTransitionKind.Replaced]);
		assert.equal(provider.getSessions()[0]?.status.get(), SessionStatus.Running);
		assert.equal(provider.getSessions()[0]?.capabilities.get().supportsDelete, false);
		assert.equal(payload.messages?.at(-1)?.role, 'user');
		assert.deepEqual(payload.messages?.at(-1)?.parts, [
			{ type: 'text', text: 'Use every attachment' },
			{
				type: 'image',
				id: 'image-1',
				name: 'Browser.jpeg',
				mimeType: 'image/jpeg',
				data: 'aW1hZ2U=',
			},
		]);
	};

	await provider.sendRequest(draft, draftChat, {
		prompt: 'Use every attachment',
		attachments: [{
			kind: ChatRequestAttachmentKind.Text,
			id: 'text-1',
			name: 'Research note',
			content: '  Preserve this spacing.  ',
			mimeType: 'text/plain',
		}, {
			kind: ChatRequestAttachmentKind.Editor,
			id: 'editor-1',
			name: 'Draft',
			resource: editorResource,
			document: editorDocument,
			selection: { blockId, startOffset: 0, endOffset: 8 },
		}, {
			kind: ChatRequestAttachmentKind.Article,
			id: 'article-attachment-1',
			name: 'Article title',
			articleId: 'article-1',
		}, {
			kind: ChatRequestAttachmentKind.Image,
			id: 'image-1',
			name: 'Browser.jpeg',
			mimeType: 'image/jpeg',
			data: 'aW1hZ2U=',
		}],
	});

	const committed = provider.getSessions()[0];
	assert.ok(committed);
	const committedChat = committed.mainChat.get();
	assert.notEqual(committed, draft);
	assert.notEqual(committedChat, draftChat);
	assert.equal(committed.resource.toString(), draft.resource.toString());
	assert.equal(committedChat.resource.toString(), draftChat.resource.toString());
	assert.equal(committed.status.get(), SessionStatus.Completed);
	assert.equal(committed.capabilities.get().supportsDelete, true);
	assert.equal(committedChat.status.get(), SessionStatus.Completed);
	assert.deepEqual(transitionKinds, [SessionTransitionKind.Replaced, SessionTransitionKind.Changed]);
	assert.deepEqual(fetchService.fetchedArticleIds, ['article-1']);

	const payload = nativeHostService.payloads[0];
	assert.ok(payload);
	assert.match(payload.writingContext ?? '', /  Preserve this spacing\.  /);
	assert.doesNotMatch(payload.writingContext ?? '', /Original target paragraph/);
	assert.deepEqual(payload.editorSelection, {
		blockId,
		startOffset: 0,
		endOffset: 8,
	});
	assert.equal(payload.editorDocument, editorDocument);
	assert.deepEqual(payload.availableTools, [
		'get_selection_context',
		'list_text_units',
		'apply_editor_patch',
		'retrieve_evidence',
	]);
	assert.deepEqual(payload.articleContexts, [{
		sourceUrl: 'https://example.com/article-1',
		doi: '10.1/example',
		title: 'Article title',
		authors: ['Ada Author'],
		abstract: 'Article abstract',
		journalTitle: 'Journal title',
		publishedAt: '2026-07-12',
	}]);
	assert.equal(
		payload.llm?.providers[payload.llm.activeProvider].selectedModelOption,
		'',
	);

	const snapshot = chatModelReference.object.getSnapshot();
	assert.equal(snapshot.activeRequest, undefined);
	assert.equal(snapshot.errorMessage, undefined);
	assert.deepEqual(snapshot.messages.map(message => [message.role, message.content]), [
		['user', 'Use every attachment'],
		['assistant', 'Completed answer'],
	]);
	assert.deepEqual(snapshot.messages[0]?.imageAttachments, [{
		id: 'image-1',
		name: 'Browser.jpeg',
		mimeType: 'image/jpeg',
		data: 'aW1hZ2U=',
	}]);
	const assistantMessage = snapshot.messages.at(-1);
	assert.equal(assistantMessage?.role, 'assistant');
	if (assistantMessage?.role === 'assistant') {
		assert.equal(assistantMessage.patchProposal?.target.resource.toString(), editorResource.toString());
		assert.deepEqual(assistantMessage.patchProposal?.target.document, editorDocument);
	}
});

test('DefaultSessionsProvider sends only the newest complete turns inside the selected model budget', async t => {
	const { provider, nativeHostService } = createFixture(t);
	const draft = createDraft(provider);
	const draftChat = draft.mainChat.get();
	const model = provider.getModels(draft, draftChat).find(candidate => {
		return parseLlmModelOptionValue(candidate.identifier)?.modelId === 'glm-4.7-flash';
	});
	assert.ok(model);
	await provider.setChatModel(draft, draftChat, model.identifier);

	const firstPrompt = `first-${'u'.repeat(160_000)}`;
	nativeHostService.result = createAgentResult({ finalText: `first-${'a'.repeat(160_000)}` });
	await provider.sendRequest(draft, draftChat, { prompt: firstPrompt, attachments: [] });
	const committed = provider.getSessions()[0];
	assert.ok(committed);

	nativeHostService.result = createAgentResult({ finalText: 'Second answer' });
	await provider.sendRequest(committed, committed.mainChat.get(), {
		prompt: 'Second prompt',
		attachments: [],
	});

	assert.deepEqual(nativeHostService.payloads[1]?.messages, [{
		role: 'user',
		parts: [{ type: 'text', text: 'Second prompt' }],
	}]);
});

test('DefaultSessionsProvider commits and visibly fails an empty native response', async t => {
	const { provider, nativeHostService, chatService } = createFixture(t);
	nativeHostService.result = createAgentResult({ finalText: '   ' });
	const draft = createDraft(provider);
	const draftChat = draft.mainChat.get();
	const chatModelReference = chatService.acquireModel(draftChat.resource);
	t.after(() => chatModelReference.dispose());
	const transitionKinds: SessionTransitionKind[] = [];
	provider.onDidChangeSessions(event => {
		transitionKinds.push(...event.transitions.map(transition => transition.kind));
	});

	await assert.rejects(
		provider.sendRequest(draft, draftChat, { prompt: 'Fail visibly', attachments: [] }),
		/empty response/i,
	);

	const committed = provider.getSessions()[0];
	assert.ok(committed);
	assert.equal(committed.status.get(), SessionStatus.Failed);
	assert.equal(committed.mainChat.get().status.get(), SessionStatus.Failed);
	assert.deepEqual(transitionKinds, [SessionTransitionKind.Replaced, SessionTransitionKind.Changed]);
	const snapshot = chatModelReference.object.getSnapshot();
	assert.equal(snapshot.activeRequest, undefined);
	assert.equal(snapshot.input, 'Fail visibly');
	assert.match(snapshot.errorMessage ?? '', /empty response/i);
});

test('DefaultSessionsProvider records a native exception and rethrows the original error', async t => {
	const { provider, nativeHostService, chatService } = createFixture(t);
	const nativeError = new Error('Native request failed exactly once.');
	nativeHostService.error = nativeError;
	const draft = createDraft(provider);
	const draftChat = draft.mainChat.get();
	const chatModelReference = chatService.acquireModel(draftChat.resource);
	t.after(() => chatModelReference.dispose());
	const transitionKinds: SessionTransitionKind[] = [];
	provider.onDidChangeSessions(event => {
		transitionKinds.push(...event.transitions.map(transition => transition.kind));
	});

	let caughtError: unknown;
	try {
		await provider.sendRequest(draft, draftChat, { prompt: 'Propagate native failure', attachments: [] });
	} catch (error) {
		caughtError = error;
	}

	assert.equal(caughtError, nativeError);
	assert.equal(provider.getSessions()[0]?.status.get(), SessionStatus.Failed);
	assert.deepEqual(transitionKinds, [SessionTransitionKind.Replaced, SessionTransitionKind.Changed]);
	const snapshot = chatModelReference.object.getSnapshot();
	assert.equal(snapshot.activeRequest, undefined);
	assert.equal(snapshot.input, 'Propagate native failure');
	assert.equal(snapshot.errorMessage, nativeError.message);
});

test('DefaultSessionsProvider persists a failure before publishing it when completion storage fails', async t => {
	const storageService = createStorageService();
	const { provider, chatService } = createFixture(t, storageService);
	const draft = createDraft(provider);
	const chatResource = draft.mainChat.get().resource;
	const chatModelReference = chatService.acquireModel(chatResource);
	t.after(() => chatModelReference.dispose());
	const storageError = new Error('Completion storage rejected.');
	storageService.failNextStore(storageError);

	let caughtError: unknown;
	try {
		await provider.sendRequest(draft, draft.mainChat.get(), {
			prompt: 'Do not publish an unpersisted answer',
			attachments: [],
		});
	} catch (error) {
		caughtError = error;
	}

	assert.equal(caughtError, storageError);
	const committed = provider.getSessions()[0];
	assert.ok(committed);
	assert.equal(committed.status.get(), SessionStatus.Failed);
	assert.equal(committed.capabilities.get().supportsDelete, true);
	const snapshot = chatModelReference.object.getSnapshot();
	assert.equal(snapshot.activeRequest, undefined);
	assert.equal(snapshot.messages.some(message => message.role === 'assistant'), false);
	assert.equal(snapshot.errorMessage, storageError.message);

	provider.dispose();
	const restoredFixture = createFixture(t, storageService);
	const restored = restoredFixture.provider.getSessions()[0];
	assert.ok(restored);
	assert.equal(restored.status.get(), SessionStatus.Failed);
	const restoredChatReference = restoredFixture.chatService.acquireModel(restored.mainChat.get().resource);
	try {
		const restoredSnapshot = restoredChatReference.object.getSnapshot();
		assert.equal(restoredSnapshot.messages.some(message => message.role === 'assistant'), false);
		assert.equal(restoredSnapshot.errorMessage, storageError.message);
	} finally {
		restoredChatReference.dispose();
	}
});

test('DefaultSessionsProvider removes a new Session when neither terminal state can be persisted', async t => {
	const storageService = createStorageService();
	const { provider, chatService } = createFixture(t, storageService);
	const draft = createDraft(provider);
	const chatResource = draft.mainChat.get().resource;
	const chatReference = chatService.acquireModel(chatResource);
	t.after(() => chatReference.dispose());
	const initialSnapshot = chatReference.object.getSnapshot();
	const transitions: SessionTransitionKind[] = [];
	provider.onDidChangeSessions(event => {
		transitions.push(...event.transitions.map(transition => transition.kind));
	});
	const completionStorageError = new Error('Completion storage failed.');
	const failureStorageError = new Error('Failure storage failed.');
	const rollbackObserverError = new Error('Rollback observer failed.');
	const rollbackObserver = provider.onDidChangeSessions(event => {
		if (event.transitions.some(transition => transition.kind === SessionTransitionKind.Removed)) {
			throw rollbackObserverError;
		}
	});
	t.after(() => rollbackObserver.dispose());
	storageService.failNextStores(completionStorageError, failureStorageError);

	await assert.rejects(
		provider.sendRequest(draft, draft.mainChat.get(), {
			prompt: 'Abort this unpersisted Session',
			attachments: [],
		}),
		error => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [
				completionStorageError,
				failureStorageError,
				rollbackObserverError,
			]);
			return true;
		},
	);

	assert.deepEqual(provider.getSessions(), []);
	assert.deepEqual(transitions, [SessionTransitionKind.Replaced, SessionTransitionKind.Removed]);
	assert.equal(chatReference.object.getSnapshot(), initialSnapshot);
	assert.equal(chatReference.object.getSnapshot().activeRequest, undefined);
	assert.equal(storageService.getRaw('sessions.providers.default'), undefined);
	chatReference.dispose();
	assert.throws(() => chatService.acquireModel(chatResource), /does not exist/);

	provider.dispose();
	const restored = createFixture(t, storageService);
	assert.deepEqual(restored.provider.getSessions(), []);
	const retryDraft = createDraft(restored.provider);
	await restored.provider.sendRequest(retryDraft, retryDraft.mainChat.get(), {
		prompt: 'Persist a later Session',
		attachments: [],
	});
	assert.equal(restored.provider.getSessions()[0]?.status.get(), SessionStatus.Completed);
});

test('DefaultSessionsProvider restores an existing durable Session when neither terminal state can be persisted', async t => {
	const storageService = createStorageService();
	const { provider, chatService } = createFixture(t, storageService);
	const draft = createDraft(provider);
	await provider.sendRequest(draft, draft.mainChat.get(), {
		prompt: 'Establish durable state',
		attachments: [],
	});
	const committed = provider.getSessions()[0];
	assert.ok(committed);
	const chatReference = chatService.acquireModel(committed.mainChat.get().resource);
	t.after(() => chatReference.dispose());
	const initialSnapshot = chatReference.object.getSnapshot();
	const initialUpdatedAt = committed.updatedAt.get().getTime();
	const initialStoredState = storageService.getRaw('sessions.providers.default');
	const transitions: SessionTransitionKind[] = [];
	provider.onDidChangeSessions(event => {
		transitions.push(...event.transitions.map(transition => transition.kind));
	});
	const completionStorageError = new Error('Existing completion storage failed.');
	const failureStorageError = new Error('Existing failure storage failed.');
	storageService.failNextStores(completionStorageError, failureStorageError);

	await assert.rejects(
		provider.sendRequest(committed, committed.mainChat.get(), {
			prompt: 'Do not diverge from durable state',
			attachments: [],
		}),
		error => {
			assert.ok(error instanceof AggregateError);
			assert.deepEqual(error.errors, [completionStorageError, failureStorageError]);
			return true;
		},
	);

	assert.deepEqual(provider.getSessions(), [committed]);
	assert.equal(committed.status.get(), SessionStatus.Completed);
	assert.equal(committed.updatedAt.get().getTime(), initialUpdatedAt);
	assert.equal(chatReference.object.getSnapshot(), initialSnapshot);
	assert.equal(chatReference.object.getSnapshot().activeRequest, undefined);
	assert.equal(storageService.getRaw('sessions.providers.default'), initialStoredState);
	assert.deepEqual(transitions, [SessionTransitionKind.Changed, SessionTransitionKind.Changed]);

	await provider.sendRequest(committed, committed.mainChat.get(), {
		prompt: 'Retry after rollback',
		attachments: [],
	});
	assert.equal(committed.status.get(), SessionStatus.Completed);
	assert.equal(chatReference.object.getSnapshot().activeRequest, undefined);
	assert.equal(chatReference.object.getSnapshot().messages.at(-1)?.content, 'Completed answer');
});

test('DefaultSessionsProvider reports model observer errors without interrupting terminal commit', async t => {
	const storageService = createStorageService();
	const { provider, chatService } = createFixture(t, storageService);
	const draft = createDraft(provider);
	await provider.sendRequest(draft, draft.mainChat.get(), {
		prompt: 'Establish observer test state',
		attachments: [],
	});
	const committed = provider.getSessions()[0];
	assert.ok(committed);
	const chatReference = chatService.acquireModel(committed.mainChat.get().resource);
	t.after(() => chatReference.dispose());
	const chatObserverError = new Error('Chat observer failed.');
	const sessionObserverError = new Error('Session observer failed.');
	const observerErrors: unknown[] = [];
	const listener = chatReference.object.onDidChange(() => {
		throw chatObserverError;
	});
	t.after(() => listener.dispose());
	const sessionObservers = new DisposableStore();
	t.after(() => sessionObservers.dispose());
	let sessionObserverArmed = false;
	sessionObservers.add(autorun(reader => {
		const status = committed.status.read(reader);
		if (sessionObserverArmed && status === SessionStatus.Completed) {
			throw sessionObserverError;
		}
	}));
	sessionObserverArmed = true;
	const observedStatuses: SessionStatus[] = [];
	sessionObservers.add(autorun(reader => observedStatuses.push(committed.status.read(reader))));
	const previousUnexpectedErrorHandler = errorHandler.getUnexpectedErrorHandler();
	errorHandler.setUnexpectedErrorHandler(error => observerErrors.push(error));
	try {
		await provider.sendRequest(committed, committed.mainChat.get(), {
			prompt: 'Complete despite observer failure',
			attachments: [],
		});
	} finally {
		errorHandler.setUnexpectedErrorHandler(previousUnexpectedErrorHandler);
	}

	assert.equal(committed.status.get(), SessionStatus.Completed);
	assert.equal(committed.mainChat.get().status.get(), SessionStatus.Completed);
	assert.equal(committed.capabilities.get().supportsDelete, true);
	assert.equal(committed.updatedAt.get().getTime(), committed.mainChat.get().updatedAt.get().getTime());
	assert.equal(chatReference.object.getSnapshot().activeRequest, undefined);
	assert.equal(chatReference.object.getSnapshot().messages.at(-1)?.content, 'Completed answer');
	assert.deepEqual(observedStatuses, [SessionStatus.Completed, SessionStatus.Running, SessionStatus.Completed]);
	assert.deepEqual(observerErrors, [chatObserverError, chatObserverError, sessionObserverError]);

	provider.dispose();
	const restored = createFixture(t, storageService).provider.getSessions()[0];
	assert.ok(restored);
	assert.equal(restored.status.get(), SessionStatus.Completed);
});

test('DefaultSessionsProvider fails a manually selected model that becomes disabled', async t => {
	const { provider, nativeHostService, settingsModel, chatService } = createFixture(t);
	const draft = createDraft(provider);
	const draftChat = draft.mainChat.get();
	const selectedModel = provider.getModels(draft, draftChat)[0];
	assert.ok(selectedModel);
	const parsedModel = parseLlmModelOptionValue(selectedModel.identifier);
	assert.ok(parsedModel);
	await provider.setChatModel(draft, draftChat, selectedModel.identifier);
	settingsModel.setLlmProviderModelEnabled(parsedModel.providerId, selectedModel.identifier, false);
	const chatModelReference = chatService.acquireModel(draftChat.resource);
	t.after(() => chatModelReference.dispose());

	await assert.rejects(
		provider.sendRequest(draft, draftChat, { prompt: 'Use the selected model', attachments: [] }),
		/no longer enabled/i,
	);

	assert.equal(nativeHostService.payloads.length, 0);
	const committed = provider.getSessions()[0];
	assert.ok(committed);
	assert.equal(committed.status.get(), SessionStatus.Failed);
	assert.equal(committed.mainChat.get().modelId.get(), selectedModel.identifier);
	assert.match(chatModelReference.object.getSnapshot().errorMessage ?? '', /no longer enabled/i);
});

test('DefaultSessionsProvider rejects unsupported and malformed attachments without invoking native', async t => {
	const validDocument = createWritingEditorDocumentFromPlainText('Short block');
	const blockId = requireFirstBlockId(validDocument);
	const editorResource = URI.parse('draft:/strict-attachment');
	const cases: readonly {
		readonly name: string;
		readonly attachments: readonly IChatRequestAttachment[];
		readonly error: RegExp;
	}[] = [{
		name: 'Resource',
		attachments: [{
			kind: ChatRequestAttachmentKind.Resource,
			id: 'resource',
			name: 'Resource',
			resource: URI.parse('file:/resource.txt'),
			mimeType: 'text/plain',
		}],
		error: /cannot read Resource attachments/,
	}, {
		name: 'empty Text',
		attachments: [{
			kind: ChatRequestAttachmentKind.Text,
			id: 'text',
			name: 'Text',
			content: '   ',
			mimeType: 'text/plain',
		}],
		error: /non-empty content/,
	}, {
		name: 'multiple Editors',
		attachments: [0, 1].map(index => ({
			kind: ChatRequestAttachmentKind.Editor,
			id: `editor-${index}`,
			name: `Editor ${index}`,
			resource: URI.parse(`draft:/editor-${index}`),
			document: validDocument,
			selection: null,
		})),
		error: /at most one Editor attachment/,
	}, {
		name: 'out-of-bounds Editor selection',
		attachments: [{
			kind: ChatRequestAttachmentKind.Editor,
			id: 'editor',
			name: 'Editor',
			resource: editorResource,
			document: validDocument,
			selection: { blockId, startOffset: 0, endOffset: 100 },
		}],
		error: /exceeds its text block/,
	}, {
		name: 'invalid Editor document',
		attachments: [{
			kind: ChatRequestAttachmentKind.Editor,
			id: 'editor',
			name: 'Editor',
			resource: editorResource,
			document: { type: 'doc', content: [{ type: 'not-a-schema-node' }] },
			selection: null,
		}],
		error: /invalid document/,
	}, {
		name: 'Editor block without a stable ID',
		attachments: [{
			kind: ChatRequestAttachmentKind.Editor,
			id: 'editor',
			name: 'Editor',
			resource: editorResource,
			document: {
				type: 'doc',
				content: [{
					type: 'paragraph',
					content: [{ type: 'text', text: 'Missing ID' }],
				}],
			},
			selection: null,
		}],
		error: /without a stable ID/,
	}, {
		name: 'unavailable Article',
		attachments: [{
			kind: ChatRequestAttachmentKind.Article,
			id: 'article',
			name: 'Article',
			articleId: 'missing-article',
		}],
		error: /unavailable/,
	}];

	for (const testCase of cases) {
		await t.test(testCase.name, async subtest => {
			const { provider, nativeHostService, chatService } = createFixture(subtest);
			const draft = createDraft(provider);
			if (testCase.name === 'unavailable Article') {
				chatService.setArticleChecked(draft.mainChat.get().resource, 'missing-article', true);
			}
			await assert.rejects(
				provider.sendRequest(draft, draft.mainChat.get(), {
					prompt: `Reject ${testCase.name}`,
					attachments: testCase.attachments,
				}),
				testCase.error,
			);
			assert.equal(nativeHostService.payloads.length, 0);
			assert.equal(provider.getSessions()[0]?.status.get(), SessionStatus.Failed);
			if (testCase.name === 'unavailable Article') {
				const chatModelReference = chatService.acquireModel(draft.mainChat.get().resource);
				try {
					assert.deepEqual(chatModelReference.object.getSnapshot().checkedArticleIds, []);
				} finally {
					chatModelReference.dispose();
				}
			}
		});
	}
});

test('DefaultSessionsProvider explicitly rejects every unsupported operation', async t => {
	const { provider } = createFixture(t);
	const draft = createDraft(provider);
	const draftChat = draft.mainChat.get();
	await provider.sendRequest(draft, draftChat, { prompt: 'Commit this Session', attachments: [] });
	const committed = provider.getSessions()[0];
	assert.ok(committed);
	const committedChat = committed.mainChat.get();

	await assert.rejects(provider.createChat(committed), /does not support additional Chats/);
	await assert.rejects(provider.forkChat(committed, committedChat, 'turn-1'), /does not support Chat forks/);
	await assert.rejects(provider.setSessionArchived(committed, true), /does not support archiving/);
	await assert.rejects(provider.deleteChat(committed, committedChat), /cannot delete its main Chat/);
});

test('DefaultSessionsProvider rejects oversized derived Article context before native invocation', async t => {
	const { provider, nativeHostService, fetchService } = createFixture(t);
	const draft = createDraft(provider);
	fetchService.article = {
		id: 'article-many-authors',
		journalId: 'journal-1',
		url: URI.parse('https://example.test/article-many-authors'),
	};
	fetchService.articleDetail = {
		articleId: 'article-many-authors',
		journalId: 'journal-1',
		url: URI.parse('https://example.test/article-many-authors'),
		title: 'Article with too many authors',
		subjects: [],
		authors: Array.from({ length: 257 }, (_, index) => ({ name: `Author ${index}` })),
		publication: { title: 'Journal' },
	};

	await assert.rejects(provider.sendRequest(draft, draft.mainChat.get(), {
		prompt: 'Use the oversized Article context',
		attachments: [{
			kind: ChatRequestAttachmentKind.Article,
			id: 'article-attachment',
			name: 'Article',
			articleId: 'article-many-authors',
		}],
	}), /author count.*256/i);
	assert.equal(nativeHostService.payloads.length, 0);
});

test('DefaultSessionsProvider reload round-trips duplicate Article occurrences without persisting transient selection', async t => {
	const storageService = createStorageService();
	const first = createFixture(t, storageService);
	const draft = createDraft(first.provider);
	await first.provider.sendRequest(draft, draft.mainChat.get(), {
		prompt: 'Persist this conversation',
		attachments: [{
			kind: ChatRequestAttachmentKind.Image,
			id: 'persisted-image',
			name: 'Persisted.jpeg',
			mimeType: 'image/jpeg',
			data: 'aW1hZ2U=',
		}],
	});
	const committed = first.provider.getSessions()[0];
	assert.ok(committed);
	const committedChat = committed.mainChat.get();
	first.chatService.setInput(committedChat.resource, 'Unsent follow-up');
	first.chatService.setArticleChecked(committedChat.resource, 'article-persisted', true);
	first.chatService.insertArticleList(
		committedChat.resource,
		'Duplicate occurrences',
		['article-occurrence', 'article-occurrence'],
		'Two occurrences of one Article',
	);
	const transientReference = first.chatService.acquireModel(committedChat.resource);
	try {
		assert.deepEqual(transientReference.object.getSnapshot().checkedArticleIds, ['article-persisted']);
	} finally {
		transientReference.dispose();
	}
	assert.doesNotMatch(
		storageService.getRaw('sessions.providers.default') ?? '',
		/checkedArticleIds/,
	);
	await first.provider.renameSession(committed, 'Persisted Session');
	await first.provider.renameChat(committed, committedChat, 'Persisted Chat');
	const sessionId = committed.sessionId;
	const resource = committed.resource.toString();
	first.provider.dispose();

	const second = createFixture(t, storageService);
	const restored = second.provider.getSessions()[0];
	assert.ok(restored);
	const restoredChat = restored.mainChat.get();
	const reference = second.chatService.acquireModel(restoredChat.resource);
	try {
		const snapshot = reference.object.getSnapshot();
		const lastMessage = snapshot.messages.at(-1);
		const articleOccurrenceIds = lastMessage?.role === 'assistant'
			? lastMessage.articleList?.articleIds
			: undefined;
		const restoredImageAttachments = snapshot.messages[0]?.imageAttachments;
		assert.deepEqual({
			sessionId: restored.sessionId,
			resource: restored.resource.toString(),
			sessionTitle: restored.title.get(),
			chatTitle: restoredChat.title.get(),
			status: restored.status.get(),
			input: snapshot.input,
			messages: snapshot.messages.map(message => [message.role, message.content]),
			articleOccurrenceIds,
			restoredImageAttachments,
			checkedArticleIds: snapshot.checkedArticleIds,
			frozen: [snapshot, snapshot.messages, snapshot.checkedArticleIds].map(Object.isFrozen),
		}, {
			sessionId,
			resource,
			sessionTitle: 'Persisted Session',
			chatTitle: 'Persisted Chat',
			status: SessionStatus.Completed,
			input: 'Unsent follow-up',
			messages: [
				['user', 'Persist this conversation'],
				['assistant', 'Completed answer'],
				['assistant', 'Two occurrences of one Article'],
			],
			articleOccurrenceIds: ['article-occurrence', 'article-occurrence'],
			restoredImageAttachments: [{
				id: 'persisted-image',
				name: 'Persisted.jpeg',
				mimeType: 'image/jpeg',
				data: 'aW1hZ2U=',
			}],
			checkedArticleIds: [],
			frozen: [true, true, true],
		});
		assert.throws(() => (snapshot.checkedArticleIds as string[]).push('mutated'), TypeError);
	} finally {
		reference.dispose();
	}

	await second.provider.deleteSession(restored);
	second.provider.dispose();
	const third = createFixture(t, storageService);
	assert.deepEqual(third.provider.getSessions(), []);
});

test('DefaultSessionsProvider restores an exact failed Chat without fabricating completion', async t => {
	const storageService = createStorageService();
	const first = createFixture(t, storageService);
	const nativeError = new Error('Persisted native failure.');
	first.nativeHostService.error = nativeError;
	const draft = createDraft(first.provider);
	await assert.rejects(
		first.provider.sendRequest(draft, draft.mainChat.get(), {
			prompt: 'Restore this failed request',
			attachments: [],
		}),
		nativeError,
	);
	const failed = first.provider.getSessions()[0];
	assert.ok(failed);
	const resource = failed.resource;
	first.provider.dispose();

	const second = createFixture(t, storageService);
	const restored = second.provider.getSessions()[0];
	assert.ok(restored);
	assert.equal(restored.status.get(), SessionStatus.Failed);
	const reference = second.chatService.acquireModel(resource);
	try {
		const snapshot = reference.object.getSnapshot();
		assert.equal(snapshot.activeRequest, undefined);
		assert.equal(snapshot.input, 'Restore this failed request');
		assert.equal(snapshot.errorMessage, nativeError.message);
		assert.deepEqual(snapshot.messages.map(message => [message.role, message.content]), [
			['user', 'Restore this failed request'],
		]);
	} finally {
		reference.dispose();
	}
});

test('DefaultSessionsProvider leaves memory and durable state unchanged when rename persistence fails', async t => {
	const storageService = createStorageService();
	const first = createFixture(t, storageService);
	const draft = createDraft(first.provider);
	await first.provider.sendRequest(draft, draft.mainChat.get(), {
		prompt: 'Stable before failed rename',
		attachments: [],
	});
	const committed = first.provider.getSessions()[0];
	assert.ok(committed);
	const previousTitle = committed.title.get();
	const previousUpdatedAt = committed.updatedAt.get().getTime();
	const previousStoredState = storageService.getRaw('sessions.providers.default');
	const storageError = new Error('Storage write rejected.');
	storageService.failNextStore(storageError);

	let caughtError: unknown;
	try {
		await first.provider.renameSession(committed, 'Must not partially commit');
	} catch (error) {
		caughtError = error;
	}
	assert.equal(caughtError, storageError);
	assert.equal(committed.title.get(), previousTitle);
	assert.equal(committed.updatedAt.get().getTime(), previousUpdatedAt);
	assert.equal(storageService.getRaw('sessions.providers.default'), previousStoredState);
	first.provider.dispose();

	const second = createFixture(t, storageService);
	assert.equal(second.provider.getSessions()[0]?.title.get(), previousTitle);
});

test('DefaultSessionsProvider rejects a malformed versioned snapshot before creating Chat models', () => {
	const storageService = createStorageService();
	storageService.setRaw('sessions.providers.default', JSON.stringify({
		version: 3,
		sessions: [{ conversationId: 'partial' }],
	}));
	const chatService = new ChatService(
		new NoOpNotificationService(),
		new TestDraftEditorService(),
	);
	assert.throws(
		() => new DefaultSessionsProvider(
			new TestNativeHostService(),
			new SettingsModel(),
			new TestFetchService(),
			chatService,
			storageService,
			new TestWorkbenchLocaleService(),
			new WorkbenchLanguageService(),
		),
		/Stored default Sessions state/,
	);
	assert.throws(
		() => chatService.acquireModel(URI.parse('comet-default-session:/partial')),
		/does not exist/,
	);
});

test('DefaultSessionsProvider explicitly rejects the obsolete v1 persistence format', () => {
	const storageService = createStorageService();
	storageService.setRaw('sessions.providers.default', JSON.stringify({
		version: 1,
		sessions: [],
	}));
	assert.throws(
		() => new DefaultSessionsProvider(
			new TestNativeHostService(),
			new SettingsModel(),
			new TestFetchService(),
			new ChatService(
				new NoOpNotificationService(),
				new TestDraftEditorService(),
			),
			storageService,
			new TestWorkbenchLocaleService(),
			new WorkbenchLanguageService(),
		),
		/unsupported version/,
	);
});
