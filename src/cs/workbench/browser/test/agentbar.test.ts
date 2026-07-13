/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { Event as BaseEvent, EventEmitter } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type { IRenderedMarkdown, MarkdownRenderOptions } from 'cs/base/browser/markdownRenderer';
import type { IMarkdownString } from 'cs/base/common/htmlContent';
import { URI } from 'cs/base/common/uri';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { IMarkdownRendererService } from 'cs/platform/markdown/browser/markdownRenderer';
import type { INotificationService } from 'cs/platform/notification/common/notification';
import type { LanguagePackLocale } from 'cs/platform/languagePacks/common/languagePacks';
import {
	createAgentChatId,
	createAgentHostPayloadDigest,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolCallId,
	createAgentToolId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentHostChatState } from 'cs/platform/agentHost/common/protocol';
import { assertAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type { IChatWidgetPresentation } from 'cs/workbench/contrib/chat/browser/chat';
import type { ChatWidget as ChatWidgetType } from 'cs/workbench/contrib/chat/browser/widget/chatWidget';
import type {
	IChatModelReference,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import {
	ChatHostPresentationSchemaVersion,
} from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';
import { createTestChatStorageService } from 'cs/workbench/contrib/chat/test/common/testChatStorage';
import {
	ArticleChatPresentationState,
	ArticleChatPresentationsContribution,
	IArticleChatPresentationState,
} from 'cs/workbench/contrib/fetch/browser/articleChatPresentations';
import {
	ArticleHistoryChatPresentationType,
	createArticleHistoryChatPresentation,
	parseArticleListChatPresentation,
} from 'cs/workbench/contrib/fetch/common/articleChatPresentations';
import {
	IWorkbenchLanguageService,
	WorkbenchLanguageService,
} from 'cs/workbench/services/language/common/languageService';
import {
	IWorkbenchLocaleService,
	type LocaleServiceContext,
} from 'cs/workbench/services/localization/common/locale';
import type {
	ArticleListCatalog,
	ArticleListItem,
	ArticleListSource,
	ArticlePage,
	ArticleRecord,
	IFetchService,
	JournalDescriptor,
} from 'cs/workbench/services/fetch/common/fetch';
import type {
	IArticleSelectionSnapshot,
} from 'cs/workbench/services/document/common/documentActions';
import type { IChatArticleBrowserTarget } from 'cs/workbench/contrib/browserView/common/chatArticleBrowser';

let cleanupDomEnvironment: (() => void) | undefined;
let cleanupResizeObserver: (() => void) | undefined;
let ChatWidget: typeof ChatWidgetType;
let chatService: ChatService;
let fetchService: TestFetchService;
let createWidget: () => ChatWidgetType;
let localeService: TestWorkbenchLocaleService;
let articlePresentationState: ArticleChatPresentationState;
let articleContribution: IDisposable;
const articleExports: IArticleSelectionSnapshot[] = [];
const articleOpenTargets: IChatArticleBrowserTarget[] = [];
let desktopRuntime = true;

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
		if (this.locale === locale) {
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

class TestFetchService implements IFetchService {
	declare readonly _serviceBrand: undefined;
	private readonly catalogChange = new EventEmitter<string>();
	readonly onDidChangeCatalog = this.catalogChange.event;
	readonly onDidChangeSource = BaseEvent.None;
	readonly onDidChangeArticle = BaseEvent.None;

	private journals: readonly JournalDescriptor[] = [];
	private catalog: ArticleListCatalog | undefined;
	private pages: readonly ArticlePage[] = [];
	private readonly items = new Map<string, ArticleListItem>();
	private readonly articles = new Map<string, ArticleRecord>();
	private sourceFetch: DeferredPromise<void> | undefined;
	sourceFetchToken: CancellationToken | undefined;

	configureArticleSource(): DeferredPromise<void> {
		const journal: JournalDescriptor = {
			id: 'journal:test',
			title: 'Test Journal',
			homeUrl: URI.parse('https://example.com/journal'),
			discoveryUrl: URI.parse('https://example.com/journal/sources'),
			providerId: 'provider:test',
		};
		const source: ArticleListSource = {
			kind: 'source',
			id: 'source:test',
			journalId: journal.id,
			label: 'Latest Articles',
			url: URI.parse('https://example.com/journal/latest'),
		};
		const item: ArticleListItem = {
			id: 'item:test',
			articleId: 'article:test',
			title: 'Test Article',
			authors: [],
			relatedArticles: [],
		};
		const article: ArticleRecord = {
			id: item.articleId,
			journalId: journal.id,
			url: URI.parse('https://example.com/article'),
		};
		this.journals = [journal];
		this.catalog = { journalId: journal.id, entries: [source] };
		this.pages = [{
			id: 'page:test',
			sourceId: source.id,
			url: source.url,
			groups: [],
			ungroupedItemIds: [item.id],
		}];
		this.items.set(item.id, item);
		this.articles.set(article.id, article);
		this.sourceFetch = new DeferredPromise<void>();
		this.sourceFetchToken = undefined;
		return this.sourceFetch;
	}

	removeActiveSource(): void {
		const journalId = this.catalog?.journalId;
		if (!journalId) {
			throw new Error('The test Article source was not configured.');
		}
		this.catalog = { journalId, entries: [] };
		this.pages = [];
		this.catalogChange.fire(journalId);
	}

	reset(): void {
		if (this.sourceFetch && !this.sourceFetch.isSettled) {
			this.sourceFetch.complete();
		}
		this.journals = [];
		this.catalog = undefined;
		this.pages = [];
		this.items.clear();
		this.articles.clear();
		this.sourceFetch = undefined;
		this.sourceFetchToken = undefined;
	}

	getJournals(): readonly JournalDescriptor[] { return this.journals; }
	getJournal(journalId: string): JournalDescriptor | undefined { return this.journals.find(journal => journal.id === journalId); }
	getArticleListCatalog(journalId: string): ArticleListCatalog | undefined { return this.catalog?.journalId === journalId ? this.catalog : undefined; }
	getArticlePage(pageId: string): ArticlePage | undefined { return this.pages.find(page => page.id === pageId); }
	getArticlePages(sourceId: string): readonly ArticlePage[] { return this.pages.filter(page => page.sourceId === sourceId); }
	getArticleListItem(itemId: string): ArticleListItem | undefined { return this.items.get(itemId); }
	getArticle(articleId: string): ArticleRecord | undefined { return this.articles.get(articleId); }
	getArticleDetail(): undefined { return undefined; }
	getCatalogLoadState() { return { status: 'idle' as const }; }
	getSourceLoadState() { return { status: 'idle' as const }; }
	getArticleLoadState() { return { status: 'idle' as const }; }
	async discoverArticleListSources(): Promise<void> {}
	async fetchArticleListSource(_sourceId: string, token: CancellationToken): Promise<void> {
		this.sourceFetchToken = token;
		const sourceFetch = this.sourceFetch;
		if (!sourceFetch) {
			throw new Error('The test Article source was not configured.');
		}
		await sourceFetch.p;
	}
	async fetchNextPage(): Promise<void> {}
	async fetchArticle(): Promise<never> { throw new Error('No Article detail is available in this test.'); }
	async fetchArticleReadableContent(): Promise<never> { throw new Error('No Article body is available in this test.'); }
	async refreshJournal(): Promise<void> {}
	async refreshArticleListSource(): Promise<void> {}
}

function installResizeObserverStub(): () => void {
	const previousGlobal = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
	const previousWindow = Object.getOwnPropertyDescriptor(window, 'ResizeObserver');
	class TestResizeObserver implements ResizeObserver {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
		takeRecords(): ResizeObserverEntry[] { return []; }
	}
	Object.defineProperty(globalThis, 'ResizeObserver', {
		configurable: true,
		value: TestResizeObserver,
	});
	Object.defineProperty(window, 'ResizeObserver', {
		configurable: true,
		value: TestResizeObserver,
	});
	return () => {
		if (previousGlobal) {
			Object.defineProperty(globalThis, 'ResizeObserver', previousGlobal);
		} else {
			Reflect.deleteProperty(globalThis, 'ResizeObserver');
		}
		if (previousWindow) {
			Object.defineProperty(window, 'ResizeObserver', previousWindow);
		} else {
			Reflect.deleteProperty(window, 'ResizeObserver');
		}
	};
}

function presentation(resource: URI, readOnly = false): IChatWidgetPresentation {
	return {
		chatResource: resource,
		readOnly,
		modelOptions: [
			{ value: 'glm:model-a', label: 'Model A' },
			{ value: 'openai:model-b', label: 'Model B' },
		],
		selectedModelId: 'glm:model-a',
		activeModelLabel: 'Model A',
	};
}

function createWidgetHostState(
	label: string,
	text: string,
	turnState: 'running' | 'completed' = 'completed',
) {
	const session = createAgentSessionId(`session-${label}`);
	const chat = createAgentChatId(`chat-${label}`);
	const turn = createAgentTurnId(`turn-${label}`);
	const state: IAgentHostChatState = {
		id: chat,
		session,
		createdAt: 1,
		modifiedAt: 2,
		title: label,
		origin: { kind: 'user' },
		model: null,
		lifecycle: 'available',
		interactivity: 'full',
		status: turnState === 'completed' ? 'completed' : 'running',
		isRead: true,
		capabilities: {
			supportsRename: true,
			supportsSetModel: true,
			supportsFork: true,
			supportsRelease: true,
			supportsDelete: true,
			supportsSubmit: true,
			supportsCancel: turnState !== 'completed',
		},
		turns: [{
			id: turn,
			submission: createAgentSubmissionId(`submission-${label}`),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'c'.repeat(64)}`),
			state: turnState,
			user: { text, attachments: [], interactionTargets: [] },
			response: turnState === 'completed'
				? [{ kind: 'text', text: `${text} response` }]
				: [],
		}],
		...(turnState === 'completed' ? {} : { activeTurn: turn }),
	};
	return { identity: { session, chat }, state };
}

function disposeWidget(widget: ChatWidgetType, ...references: IChatModelReference[]) {
	widget.dispose();
	for (const reference of references) {
		reference.dispose();
	}
}

before(async () => {
	cleanupDomEnvironment = installDomTestEnvironment().cleanup;
	cleanupResizeObserver = installResizeObserverStub();
	await import('cs/platform/contextview/browser/contextViewService');
	await import('cs/platform/contextview/browser/contextMenuService');

	const [{ renderMarkdown }, markdownModule, chatModule, fetchModule, notificationModule, nativeHostModule, documentActionsModule, chatArticleBrowserModule, instantiationModule] = await Promise.all([
		import('cs/base/browser/markdownRenderer'),
		import('cs/platform/markdown/browser/markdownRenderer'),
		import('cs/workbench/contrib/chat/common/chatService/chatService'),
		import('cs/workbench/services/fetch/common/fetch'),
		import('cs/platform/notification/common/notification'),
		import('cs/platform/native/common/native'),
		import('cs/workbench/services/document/common/documentActions'),
		import('cs/workbench/contrib/browserView/common/chatArticleBrowser'),
		import('cs/workbench/services/instantiation/browser/workbenchInstantiationService'),
	]);

	const notificationService = {
		_serviceBrand: undefined,
		info() {},
		warn() {},
		error() {},
	} as unknown as INotificationService;
	chatService = new ChatService(createTestChatStorageService());
	articlePresentationState = new ArticleChatPresentationState(chatService);

	const markdownRendererService: IMarkdownRendererService = {
		_serviceBrand: undefined,
		render(
			markdown: IMarkdownString,
			options?: MarkdownRenderOptions,
			outElement?: HTMLElement,
		): IRenderedMarkdown {
			return renderMarkdown(markdown, options, outElement);
		},
	};
	fetchService = new TestFetchService();
	localeService = new TestWorkbenchLocaleService();

	instantiationModule.registerWorkbenchService(markdownModule.IMarkdownRendererService, markdownRendererService);
	instantiationModule.registerWorkbenchService(chatModule.IChatService, chatService);
	instantiationModule.registerWorkbenchService(fetchModule.IFetchService, fetchService);
	instantiationModule.registerWorkbenchService(IArticleChatPresentationState, articlePresentationState);
	instantiationModule.registerWorkbenchService(notificationModule.INotificationService, notificationService);
	instantiationModule.registerWorkbenchService(nativeHostModule.INativeHostService, {
		_serviceBrand: undefined,
		canInvoke: () => desktopRuntime,
	} as never);
	instantiationModule.registerWorkbenchService(documentActionsModule.IDocumentActionsService, {
		_serviceBrand: undefined,
		exportArticleSummaries: async (selection: IArticleSelectionSnapshot) => {
			articleExports.push({
				resource: selection.resource,
				articleIds: [...selection.articleIds],
			});
		},
	} as never);
	instantiationModule.registerWorkbenchService(chatArticleBrowserModule.IChatArticleBrowserService, {
		_serviceBrand: undefined,
		open: async (target: IChatArticleBrowserTarget) => {
			articleOpenTargets.push(target);
		},
	});
	instantiationModule.registerWorkbenchService(IWorkbenchLocaleService, localeService);
	instantiationModule.registerWorkbenchService(IWorkbenchLanguageService, new WorkbenchLanguageService());
	({ ChatWidget } = await import('cs/workbench/contrib/chat/browser/widget/chatWidget'));
	articleContribution = instantiationModule.getWorkbenchInstantiationService().createInstance(
		ArticleChatPresentationsContribution,
	);
	createWidget = () => instantiationModule.getWorkbenchInstantiationService().createInstance(ChatWidget);
});

after(() => {
	articleContribution.dispose();
	articlePresentationState.dispose();
	cleanupResizeObserver?.();
	cleanupDomEnvironment?.();
});

test('ChatWidget renders and follows exactly its addressed model', () => {
	const first = chatService.createModel(URI.parse('chat:/widget/first'));
	const second = chatService.createModel(URI.parse('chat:/widget/second'));
	const firstHost = createWidgetHostState('addressed-first', 'First message');
	const secondHost = createWidgetHostState('addressed-second', 'Second message');
	first.replaceHostState(firstHost.identity, firstHost.state);
	second.replaceHostState(secondHost.identity, secondHost.state);
	const widget = createWidget();
	document.body.append(widget.getElement());

	try {
		widget.setModel(first.object, presentation(first.object.resource));
		assert.match(widget.getElement().textContent ?? '', /First message/);
		assert.doesNotMatch(widget.getElement().textContent ?? '', /Second message/);

		const secondUpdate = createWidgetHostState('addressed-second', 'Still isolated');
		second.replaceHostState(secondUpdate.identity, secondUpdate.state);
		assert.doesNotMatch(widget.getElement().textContent ?? '', /Still isolated/);

		const firstUpdate = createWidgetHostState('addressed-first', 'First update');
		first.replaceHostState(firstUpdate.identity, firstUpdate.state);
		assert.match(widget.getElement().textContent ?? '', /First update/);
	} finally {
		disposeWidget(widget, first, second);
	}
});

test('ChatWidget refreshes transcript, composer, and model-picker labels on the same instance', () => {
	const reference = chatService.createModel(URI.parse('chat:/widget/locale'));
	const host = createWidgetHostState('localized', 'Localized response');
	reference.replaceHostState(host.identity, host.state);
	const articleValue = createArticleHistoryChatPresentation([], {
		answer: 'Localized response',
		evidence: [{
			rank: 1,
			title: 'Evidence title',
			journalTitle: null,
			publishedAt: null,
			sourceUrl: 'https://example.com/evidence',
			score: null,
			excerpt: 'Evidence excerpt',
		}],
		provider: 'moark',
		llmProvider: 'openai',
		llmModel: 'model-a',
		embeddingModel: 'embedding-a',
		rerankerModel: 'reranker-a',
		rerankApplied: true,
	});
	assertAgentHostProtocolValue(articleValue);
	reference.importHostPresentations(host.identity, [{
		schemaVersion: ChatHostPresentationSchemaVersion,
		...host.identity,
		turn: host.state.turns[0].id,
		responsePartIndex: 0,
		type: ArticleHistoryChatPresentationType,
		value: articleValue,
	}]);
	const widget = createWidget();
	const modelPresentation = {
		...presentation(reference.object.resource),
		selectedModelId: undefined,
		activeModelLabel: 'Auto',
	};
	widget.setModel(reference.object, modelPresentation);
	document.body.append(widget.getElement());

	try {
		assert.match(widget.getElement().textContent ?? '', /Answer/);
		assert.equal(
			widget.getElement().querySelector<HTMLTextAreaElement>('textarea')?.placeholder,
			'Ask about the fetched literature, compare findings, or draft a short evidence-backed answer.',
		);
		assert.equal(
			widget.getElement().querySelector('.comet-chat-model-switch-label')?.textContent,
			'Auto',
		);
		assert.equal(
			widget.getElement().querySelector('.comet-chat-thread-scroll-down')?.getAttribute('aria-label'),
			'Scroll to Bottom',
		);

		localeService.applyLocale('zh');

		assert.match(widget.getElement().textContent ?? '', /回答/);
		assert.match(widget.getElement().textContent ?? '', /已启用重排/);
		assert.match(widget.getElement().textContent ?? '', /证据/);
		assert.equal(
			widget.getElement().querySelector<HTMLTextAreaElement>('textarea')?.placeholder,
			'可以提问某个主题、比较几篇文献的结论，或者让它生成一段带证据的短回答。',
		);
		assert.equal(
			widget.getElement().querySelector('.comet-chat-model-switch-label')?.textContent,
			'自动',
		);
		assert.equal(
			widget.getElement().querySelector('.comet-chat-thread-scroll-down')?.getAttribute('aria-label'),
			'滚动到底部',
		);
		assert(widget.getElement().querySelector('button[aria-label="文献"]'));
	} finally {
		localeService.applyLocale('en');
		disposeWidget(widget, reference);
	}
});

test('ChatWidget keeps transcript scroll positions isolated by Chat resource', () => {
	const first = chatService.createModel(URI.parse('chat:/widget/scroll-first'));
	const second = chatService.createModel(URI.parse('chat:/widget/scroll-second'));
	const firstHost = createWidgetHostState('scroll-first', 'First long transcript');
	const secondHost = createWidgetHostState('scroll-second', 'Second long transcript');
	first.replaceHostState(firstHost.identity, firstHost.state);
	second.replaceHostState(secondHost.identity, secondHost.state);
	const widget = createWidget();
	document.body.append(widget.getElement());

	try {
		widget.setModel(first.object, presentation(first.object.resource));
		const thread = widget.getElement().querySelector<HTMLElement>('.comet-chat-thread');
		assert(thread);
		Object.defineProperties(thread, {
			clientHeight: { configurable: true, value: 200 },
			scrollHeight: { configurable: true, value: 1000 },
		});
		thread.scrollTop = 250;
		thread.dispatchEvent(new Event('scroll'));

		widget.setModel(second.object, presentation(second.object.resource));
		assert.equal(thread.scrollTop, 800);
		thread.scrollTop = 600;
		thread.dispatchEvent(new Event('scroll'));

		widget.setModel(first.object, presentation(first.object.resource));
		assert.equal(thread.scrollTop, 250);
	} finally {
		disposeWidget(widget, first, second);
	}
});

test('ChatWidget composer mutations and submission carry the bound resource', () => {
	const reference = chatService.createModel(URI.parse('chat:/widget/composer'));
	const widget = createWidget();
	widget.setModel(reference.object, presentation(reference.object.resource));
	document.body.append(widget.getElement());
	let submittedResource: URI | undefined;
	const listener = widget.onDidSubmitRequest(event => submittedResource = event.chatResource);

	try {
		const textarea = widget.getElement().querySelector('textarea');
		assert(textarea instanceof HTMLTextAreaElement);
		textarea.value = 'Addressed prompt';
		textarea.focus();
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
		assert.equal(reference.object.getSnapshot().input, 'Addressed prompt');
		assert.strictEqual(widget.getElement().querySelector('textarea'), textarea);
		assert.strictEqual(document.activeElement, textarea);
		assert.equal(textarea.selectionStart, 'Addressed prompt'.length);

		const currentTextarea = widget.getElement().querySelector('textarea');
		assert(currentTextarea instanceof HTMLTextAreaElement);
		currentTextarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.equal(submittedResource?.toString(), reference.object.resource.toString());
	} finally {
		listener.dispose();
		disposeWidget(widget, reference);
	}
});

test('ChatWidget send action enforces the same prompt and Host Turn guard as Enter', () => {
	const reference = chatService.createModel(URI.parse('chat:/widget/send-guard'));
	const widget = createWidget();
	widget.setModel(reference.object, presentation(reference.object.resource));
	document.body.append(widget.getElement());
	let submitCount = 0;
	const listener = widget.onDidSubmitRequest(() => submitCount += 1);

	try {
		let sendButton = widget.getElement().querySelector<HTMLButtonElement>('.comet-chat-composer-send-action');
		assert(sendButton);
		assert.equal(sendButton.disabled, true);
		sendButton.click();
		assert.equal(submitCount, 0);

		const textarea = widget.getElement().querySelector<HTMLTextAreaElement>('textarea');
		assert(textarea);
		textarea.value = 'Ready prompt';
		textarea.dispatchEvent(new Event('input', { bubbles: true }));
		sendButton = widget.getElement().querySelector<HTMLButtonElement>('.comet-chat-composer-send-action');
		assert(sendButton);
		assert.equal(sendButton.disabled, false);
		sendButton.click();
		assert.equal(submitCount, 1);

		const activeHost = createWidgetHostState('send-guard', 'Ready prompt', 'running');
		reference.replaceHostState(activeHost.identity, activeHost.state);
		sendButton = widget.getElement().querySelector<HTMLButtonElement>('.comet-chat-composer-send-action');
		assert(sendButton);
		assert.equal(sendButton.disabled, true);
		sendButton.click();
		assert.equal(submitCount, 1);
	} finally {
		listener.dispose();
		disposeWidget(widget, reference);
	}
});

test('ChatWidget rebind disposes old composer handlers and prevents cross-resource writes', () => {
	const first = chatService.createModel(URI.parse('chat:/widget/rebind-first'));
	const second = chatService.createModel(URI.parse('chat:/widget/rebind-second'));
	const widget = createWidget();
	widget.setModel(first.object, presentation(first.object.resource));
	const detachedTextarea = widget.getElement().querySelector('textarea');
	assert(detachedTextarea instanceof HTMLTextAreaElement);

	try {
		widget.setModel(second.object, presentation(second.object.resource));
		detachedTextarea.value = 'stale write';
		detachedTextarea.dispatchEvent(new Event('input', { bubbles: true }));
		assert.equal(first.object.getSnapshot().input, '');
		assert.equal(second.object.getSnapshot().input, '');

		const activeTextarea = widget.getElement().querySelector('textarea');
		assert(activeTextarea instanceof HTMLTextAreaElement);
		activeTextarea.value = 'current write';
		activeTextarea.dispatchEvent(new Event('input', { bubbles: true }));
		assert.equal(second.object.getSnapshot().input, 'current write');
	} finally {
		disposeWidget(widget, first, second);
	}
});

test('ChatWidget rejects a presentation for another resource', () => {
	const reference = chatService.createModel(URI.parse('chat:/widget/model'));
	const widget = createWidget();

	try {
		assert.throws(
			() => widget.setModel(reference.object, presentation(URI.parse('chat:/widget/other'))),
			/must address its bound Chat model/,
		);
	} finally {
		disposeWidget(widget, reference);
	}
});

test('ChatWidget read-only presentation omits the composer', () => {
	const reference = chatService.createModel(URI.parse('chat:/widget/read-only'));
	const host = createWidgetHostState('read-only', 'Archived transcript');
	reference.replaceHostState(host.identity, host.state);
	const widget = createWidget();
	widget.setModel(reference.object, presentation(reference.object.resource, true));

	try {
		assert.match(widget.getElement().textContent ?? '', /Archived transcript/);
		assert.equal(widget.getElement().querySelector('textarea'), null);
	} finally {
		disposeWidget(widget, reference);
	}
});

test('ChatWidget renders the authoritative typed Host transcript without serializing tool payloads', () => {
	const owner = chatService.createModel(URI.parse('chat:/widget/host-transcript'));
	const session = createAgentSessionId('session-host-transcript');
	const chat = createAgentChatId('chat-host-transcript');
	const call = createAgentToolCallId('tool-call-host-transcript');
	const state: IAgentHostChatState = {
		id: chat,
		session,
		createdAt: 1,
		modifiedAt: 2,
		title: 'Host transcript',
		origin: { kind: 'user' },
		model: null,
		lifecycle: 'available',
		interactivity: 'full',
		status: 'completed',
		isRead: true,
		capabilities: {
			supportsRename: true,
			supportsSetModel: true,
			supportsFork: true,
			supportsRelease: true,
			supportsDelete: true,
			supportsSubmit: true,
			supportsCancel: false,
		},
		turns: [{
			id: createAgentTurnId('turn-host-transcript'),
			submission: createAgentSubmissionId('submission-host-transcript'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`),
			state: 'completed',
			user: {
				text: 'Exact Host question',
				attachments: [],
				interactionTargets: [],
			},
			response: [
				{ kind: 'reasoning', text: 'Typed Host reasoning' },
				{
					kind: 'toolCall',
					call,
					tool: createAgentToolId('comet.search'),
					input: { privateQuery: 'must-not-render' },
				},
				{
					kind: 'toolResult',
					call,
					status: 'completed',
					output: { privateResult: 'must-not-render' },
				},
				{ kind: 'text', text: 'Exact Host answer' },
			],
		}],
	};
	owner.replaceHostState({ session, chat }, state);
	const widget = createWidget();

	try {
		widget.setModel(owner.object, presentation(owner.object.resource));
		const content = widget.getElement().textContent ?? '';
		assert.match(content, /Exact Host question/);
		assert.match(content, /Typed Host reasoning/);
		assert.match(content, /Tool call: comet\.search \(tool-call-host-transcript\)/);
		assert.match(content, /Tool result: tool-call-host-transcript — completed/);
		assert.match(content, /Exact Host answer/);
		assert.doesNotMatch(content, /must-not-render/);
	} finally {
		disposeWidget(widget, owner);
	}
});

test('ChatWidget renders durable Host presentation only after its exact canonical response part', () => {
	const owner = chatService.createModel(URI.parse('chat:/widget/host-turn-presentation'));
	const session = createAgentSessionId('session-host-presentation');
	const chat = createAgentChatId('chat-host-presentation');
	const turn = createAgentTurnId('turn-host-presentation');
	owner.replaceHostState({ session, chat }, {
		id: chat,
		session,
		createdAt: 1,
		modifiedAt: 2,
		title: 'Host presentation',
		origin: { kind: 'user' },
		model: null,
		lifecycle: 'available',
		interactivity: 'full',
		status: 'completed',
		isRead: true,
		capabilities: {
			supportsRename: true,
			supportsSetModel: true,
			supportsFork: true,
			supportsRelease: true,
			supportsDelete: true,
			supportsSubmit: true,
			supportsCancel: false,
		},
		turns: [{
			id: turn,
			submission: createAgentSubmissionId('submission-host-presentation'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'b'.repeat(64)}`),
			state: 'completed',
			user: {
				text: 'Which identical response owns the presentation?',
				attachments: [],
				interactionTargets: [],
			},
			response: [
				{ kind: 'text', text: 'Repeated canonical answer' },
				{ kind: 'text', text: 'Repeated canonical answer' },
			],
		}],
	});
	const result = {
		answer: 'Repeated canonical answer',
		evidence: [{
			rank: 1,
			title: 'Exact migrated evidence',
			journalTitle: 'Exact Journal',
			publishedAt: null,
			sourceUrl: 'https://example.com/exact-evidence',
			score: null,
			excerpt: 'Evidence attached to response part one.',
		}],
		provider: 'moark' as const,
		llmProvider: 'openai' as const,
		llmModel: 'model-exact',
		embeddingModel: 'embedding-exact',
		rerankerModel: 'reranker-exact',
		rerankApplied: true,
	};
	const articleValue = createArticleHistoryChatPresentation(['article:exact-migrated'], result);
	assertAgentHostProtocolValue(articleValue);
	owner.importHostPresentations({ session, chat }, [{
		schemaVersion: ChatHostPresentationSchemaVersion,
		session,
		chat,
		turn,
		responsePartIndex: 1,
		type: ArticleHistoryChatPresentationType,
		value: articleValue,
	}]);
	const widget = createWidget();
	widget.setModel(owner.object, presentation(owner.object.resource, true));
	document.body.append(widget.getElement());

	try {
		const textParts = widget.getElement().querySelectorAll<HTMLElement>(
			'.comet-chat-host-response > .rendered-markdown',
		);
		assert.equal(textParts.length, 2);
		const durablePresentation = widget.getElement().querySelector<HTMLElement>(
			'.comet-chat-host-turn-presentation',
		);
		assert(durablePresentation);
		assert.equal(durablePresentation.previousElementSibling, textParts[1]);
		assert.match(durablePresentation.textContent ?? '', /article:exact-migrated/);
		assert.match(durablePresentation.textContent ?? '', /Exact migrated evidence/);
		const checkbox = durablePresentation.querySelector<HTMLElement>(
			'.comet-chat-article-checkbox[role="checkbox"]',
		);
		assert(checkbox);
		checkbox.click();
		assert.deepEqual(
			articlePresentationState.getSelectedArticleIds(owner.object.resource),
			['article:exact-migrated'],
		);
	} finally {
		disposeWidget(widget, owner);
	}
});

function clickArticleSource(widget: ChatWidgetType): void {
	const articleAction = widget.getElement().querySelector<HTMLButtonElement>(
		'button[aria-label="Article"]',
	);
	assert(articleAction);
	articleAction.click();

	const journal = [...document.body.querySelectorAll<HTMLButtonElement>(
		'.comet-chat-composer-article-source',
	)].find(button => button.textContent === 'Test Journal');
	assert(journal);
	journal.click();

	const source = [...document.body.querySelectorAll<HTMLButtonElement>(
		'.comet-chat-composer-article-source',
	)].find(button => button.textContent === 'Latest Articles');
	assert(source);
	source.click();
}

function insertArticlePresentation(
	resource: URI,
	sourceLabel: string,
	items: readonly {
		readonly id: string;
		readonly articleId: string;
		readonly title: string;
		readonly url: string;
		readonly publishedAt?: string;
	}[],
): void {
	const records = new Map(items.map(item => [item.articleId, {
		id: item.articleId,
		journalId: 'journal:test',
		url: URI.parse(item.url),
	}]));
	articlePresentationState.addArticleList(
		resource,
		sourceLabel,
		items.map(item => ({
			id: item.id,
			articleId: item.articleId,
			title: item.title,
			authors: [],
			relatedArticles: [],
			publishedAt: item.publishedAt,
		})),
		{ getArticle: (articleId: string) => records.get(articleId) } as unknown as IFetchService,
	);
}

test('ChatWidget inserts a fetched Article page only into its addressed model', async () => {
	const sourceFetch = fetchService.configureArticleSource();
	const first = chatService.createModel(URI.parse('chat:/widget/article-first'));
	const second = chatService.createModel(URI.parse('chat:/widget/article-second'));
	const widget = createWidget();
	widget.setModel(first.object, presentation(first.object.resource));
	document.body.append(widget.getElement());

	try {
		clickArticleSource(widget);
		sourceFetch.complete();
		await sourceFetch.p;
		await Promise.resolve();

		assert.equal(articlePresentationState.getPresentations(first.object.resource).length, 1);
		assert.equal(articlePresentationState.getPresentations(second.object.resource).length, 0);
		assert.match(widget.getElement().textContent ?? '', /Test Article/);
	} finally {
		fetchService.reset();
		disposeWidget(widget, first, second);
	}
});

test('ChatWidget maps typed Article items by occurrence and opens the addressed target', async () => {
	const first = chatService.createModel(URI.parse('chat:/widget/article-checkbox-first'));
	const second = chatService.createModel(URI.parse('chat:/widget/article-checkbox-second'));
	insertArticlePresentation(
		first.object.resource,
		'First source',
		[
			{ id: 'item:first', articleId: 'article:first', title: 'First Article', url: 'https://example.com/first' },
			{ id: 'item:shared-featured', articleId: 'article:shared', title: 'Shared Article featured', url: 'https://example.com/shared' },
			{ id: 'item:shared-section', articleId: 'article:shared', title: 'Shared Article in section', url: 'https://example.com/shared' },
		],
	);
	insertArticlePresentation(
		second.object.resource,
		'Second source',
		[{ id: 'item:second', articleId: 'article:second', title: 'Second Article', url: 'https://example.com/second' }],
	);
	const widget = createWidget();
	widget.setModel(first.object, presentation(first.object.resource));
	document.body.append(widget.getElement());
	const checkboxes = () => [...widget.getElement().querySelectorAll<HTMLElement>(
		'.comet-chat-article-checkbox[role="checkbox"]',
	)];
	const checkedStates = () => checkboxes().map(checkbox => checkbox.getAttribute('aria-checked'));

	try {
		assert.deepEqual(checkedStates(), ['false', 'false', 'false']);
		const openCount = articleOpenTargets.length;
		const firstOpen = widget.getElement().querySelector<HTMLButtonElement>('.comet-chat-article-open');
		assert(firstOpen);
		firstOpen.click();
		await Promise.resolve();
		assert.equal(articleOpenTargets.length, openCount + 1);
		assert.equal(articleOpenTargets.at(-1)?.chatResource, first.object.resource);
		assert.equal(articleOpenTargets.at(-1)?.articleId, 'article:first');
		assert.equal(articleOpenTargets.at(-1)?.uri.toString(true), 'https://example.com/first');
		checkboxes()[1].click();
		assert.deepEqual(articlePresentationState.getSelectedArticleIds(first.object.resource), ['article:shared']);
		assert.deepEqual(articlePresentationState.getSelectedArticleIds(second.object.resource), []);
		assert.deepEqual(checkedStates(), ['false', 'true', 'true']);

		checkboxes()[0].click();
		assert.deepEqual(
			articlePresentationState.getSelectedArticleIds(first.object.resource),
			['article:shared', 'article:first'],
		);
		assert.deepEqual(checkedStates(), ['true', 'true', 'true']);

		const staleFirstCheckbox = checkboxes()[2];
		widget.setModel(second.object, presentation(second.object.resource));
		staleFirstCheckbox.click();
		assert.deepEqual(
			articlePresentationState.getSelectedArticleIds(first.object.resource),
			['article:shared', 'article:first'],
		);
		assert.deepEqual(articlePresentationState.getSelectedArticleIds(second.object.resource), []);

		checkboxes()[0].click();
		assert.deepEqual(articlePresentationState.getSelectedArticleIds(second.object.resource), ['article:second']);
		assert.deepEqual(
			articlePresentationState.getSelectedArticleIds(first.object.resource),
			['article:shared', 'article:first'],
		);
		widget.setModel(first.object, presentation(first.object.resource));
		assert.deepEqual(checkedStates(), ['true', 'true', 'true']);
	} finally {
		disposeWidget(widget, first, second);
	}
});

test('ChatWidget exports the checked Articles from its addressed Chat', async () => {
	const reference = chatService.createModel(URI.parse('chat:/widget/article-export'));
	articlePresentationState.setArticleSelected(reference.object.resource, 'article:first', true);
	articlePresentationState.setArticleSelected(reference.object.resource, 'article:second', true);
	const widget = createWidget();
	widget.setModel(reference.object, presentation(reference.object.resource));
	document.body.append(widget.getElement());
	const exportCountBefore = articleExports.length;

	try {
		const exportButton = widget.getElement().querySelector('[aria-label="Export DOCX"]');
		assert(exportButton instanceof HTMLButtonElement);
		assert.equal(exportButton.disabled, false);
		exportButton.click();
		await Promise.resolve();
		assert.deepEqual(articleExports.slice(exportCountBefore), [{
			resource: reference.object.resource,
			articleIds: ['article:first', 'article:second'],
		}]);
		assert.deepEqual(articlePresentationState.getSelectedArticleIds(reference.object.resource), []);
		articlePresentationState.setArticleSelected(reference.object.resource, 'article:first', true);
		desktopRuntime = false;
		widget.setPresentation(presentation(reference.object.resource));
		const webExportButton = widget.getElement().querySelector('[aria-label="Export DOCX"]');
		assert(webExportButton instanceof HTMLButtonElement);
		assert.equal(webExportButton.disabled, true);
	} finally {
		desktopRuntime = true;
		disposeWidget(widget, reference);
	}
});

test('Article Feature rejects duplicate typed occurrence identities', () => {
	assert.throws(() => parseArticleListChatPresentation({
		sourceLabel: 'Typed source',
		items: [
			{ id: 'item:duplicate', articleId: 'article:first', title: 'First', url: 'https://example.com/first', metadata: '' },
			{ id: 'item:duplicate', articleId: 'article:second', title: 'Second', url: 'https://example.com/second', metadata: '' },
		],
	}), /duplicate item ID 'item:duplicate'/);
});

test('ChatWidget cancels an Article fetch when rebound and never cross-routes its result', async () => {
	const sourceFetch = fetchService.configureArticleSource();
	const first = chatService.createModel(URI.parse('chat:/widget/article-rebind-first'));
	const second = chatService.createModel(URI.parse('chat:/widget/article-rebind-second'));
	const widget = createWidget();
	widget.setModel(first.object, presentation(first.object.resource));
	document.body.append(widget.getElement());

	try {
		clickArticleSource(widget);
		const token = fetchService.sourceFetchToken;
		assert(token);
		widget.setModel(second.object, presentation(second.object.resource));
		assert.equal(token.isCancellationRequested, true);
		sourceFetch.complete();
		await sourceFetch.p;
		await Promise.resolve();

		assert.equal(articlePresentationState.getPresentations(first.object.resource).length, 0);
		assert.equal(articlePresentationState.getPresentations(second.object.resource).length, 0);
	} finally {
		fetchService.reset();
		disposeWidget(widget, first, second);
	}
});

test('ChatWidget cancels an Article fetch when disposed', async () => {
	const sourceFetch = fetchService.configureArticleSource();
	const reference = chatService.createModel(URI.parse('chat:/widget/article-dispose'));
	const widget = createWidget();
	widget.setModel(reference.object, presentation(reference.object.resource));
	document.body.append(widget.getElement());

	try {
		clickArticleSource(widget);
		const token = fetchService.sourceFetchToken;
		assert(token);
		widget.dispose();
		assert.equal(token.isCancellationRequested, true);
		sourceFetch.complete();
		await sourceFetch.p;
		await Promise.resolve();
		assert.equal(articlePresentationState.getPresentations(reference.object.resource).length, 0);
	} finally {
		fetchService.reset();
		disposeWidget(widget, reference);
	}
});

test('ChatWidget cancels an Article fetch when its context view is externally hidden', async () => {
	const sourceFetch = fetchService.configureArticleSource();
	const reference = chatService.createModel(URI.parse('chat:/widget/article-context-hide'));
	const widget = createWidget();
	widget.setModel(reference.object, presentation(reference.object.resource));
	document.body.append(widget.getElement());

	try {
		clickArticleSource(widget);
		const token = fetchService.sourceFetchToken;
		assert(token);
		window.dispatchEvent(new Event('blur'));
		assert.equal(token.isCancellationRequested, true);
		sourceFetch.complete();
		await sourceFetch.p;
		await Promise.resolve();
		assert.equal(articlePresentationState.getPresentations(reference.object.resource).length, 0);
	} finally {
		fetchService.reset();
		disposeWidget(widget, reference);
	}
});

test('ChatWidget clears an active Article source when its Catalog no longer contains that source', async () => {
	const sourceFetch = fetchService.configureArticleSource();
	const reference = chatService.createModel(URI.parse('chat:/widget/article-reconcile'));
	const widget = createWidget();
	widget.setModel(reference.object, presentation(reference.object.resource));
	document.body.append(widget.getElement());

	try {
		clickArticleSource(widget);
		const token = fetchService.sourceFetchToken;
		assert(token);
		fetchService.removeActiveSource();
		assert.equal(token.isCancellationRequested, true);
		assert.equal(
			[...document.body.querySelectorAll<HTMLButtonElement>('.comet-chat-composer-article-source')]
				.some(button => button.textContent === 'Latest Articles'),
			false,
		);
		sourceFetch.complete();
		await sourceFetch.p;
		await Promise.resolve();
		assert.equal(articlePresentationState.getPresentations(reference.object.resource).length, 0);
	} finally {
		fetchService.reset();
		disposeWidget(widget, reference);
	}
});
