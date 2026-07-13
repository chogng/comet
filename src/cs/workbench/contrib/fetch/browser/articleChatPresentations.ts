/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	$,
	addDisposableListener,
	EventType,
	getDomNodePagePosition,
	getWindow,
} from 'cs/base/browser/dom';
import { createActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { Checkbox } from 'cs/base/browser/ui/toggle/toggle';
import { StandardMouseEvent } from 'cs/base/browser/mouseEvent';
import { DomScrollableElement } from 'cs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import { CancellationTokenSource, isCancellationError } from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Emitter, type Event } from 'cs/base/common/event';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	toDisposable,
} from 'cs/base/common/lifecycle';
import { getComparisonKey, isEqual } from 'cs/base/common/resources';
import type { URI } from 'cs/base/common/uri';
import { URI as Uri } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import { assertAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import {
	IContextViewService,
	type IOpenContextView,
} from 'cs/platform/contextview/browser/contextView';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { INativeHostService } from 'cs/platform/native/common/native';
import { INotificationService } from 'cs/platform/notification/common/notification';
import { IChatArticleBrowserService } from 'cs/workbench/contrib/browserView/common/chatArticleBrowser';
import {
	IChatBrowserPresentationService,
	type IChatBrowserPresentationRenderContext,
	type IChatBrowserPresentationRenderer,
	type IChatBrowserPresentationSource,
	type IChatFeaturePresentation,
} from 'cs/workbench/contrib/chat/browser/chatBrowserPresentations';
import {
	IChatComposerContributionService,
	type IChatComposerContributionView,
} from 'cs/workbench/contrib/chat/browser/composer/chatComposerContributions';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
	ArticleHistoryChatPresentationType,
	ArticleListChatPresentationType,
	ArticleSourceEmptyChatPresentationType,
	parseArticleHistoryChatPresentation,
	parseArticleListChatPresentation,
	parseArticleSourceEmptyChatPresentation,
	type IArticleEvidenceResult,
	type IArticleListChatPresentation,
} from 'cs/workbench/contrib/fetch/common/articleChatPresentations';
import {
	IDocumentActionsService,
	type IDocumentActionsService as IDocumentActionsServiceContract,
} from 'cs/workbench/services/document/common/documentActions';
import {
	IFetchService,
	type ArticleId,
	type ArticleListItem,
	type ArticleListSource,
	type JournalDescriptor,
} from 'cs/workbench/services/fetch/common/fetch';

import 'cs/workbench/contrib/fetch/browser/media/articleChat.css';

interface IArticleChatResourceState {
	readonly resource: URI;
	readonly selectedArticleIds: ArticleId[];
	readonly presentations: IChatFeaturePresentation[];
	menuOpen: boolean;
	activeJournalId: string | undefined;
	activeSourceId: string | undefined;
}

export const IArticleChatPresentationState =
	createDecorator<IArticleChatPresentationState>('articleChatPresentationState');

export interface IArticleChatPresentationState extends IChatBrowserPresentationSource {
	readonly _serviceBrand: undefined;
	getSelectedArticleIds(chatResource: URI): readonly ArticleId[];
	isArticleSelected(chatResource: URI, articleId: ArticleId): boolean;
	setArticleSelected(chatResource: URI, articleId: ArticleId, selected: boolean): void;
	clearResource(chatResource: URI): void;
	addArticleList(
		chatResource: URI,
		sourceLabel: string,
		items: readonly ArticleListItem[],
		fetchService: IFetchService,
	): void;
	addEmptySource(chatResource: URI, sourceLabel: string, message: string): void;
	getMenuState(chatResource: URI): Readonly<Pick<
		IArticleChatResourceState,
		'menuOpen' | 'activeJournalId' | 'activeSourceId'
	>>;
	setMenuState(
		chatResource: URI,
		state: Readonly<Pick<IArticleChatResourceState, 'menuOpen' | 'activeJournalId' | 'activeSourceId'>>,
	): void;
}

function captureProtocolPresentation(
	id: string,
	type: IChatFeaturePresentation['type'],
	value: object,
): IChatFeaturePresentation {
	assertAgentHostProtocolValue(value);
	return Object.freeze({ id, type, value });
}

export class ArticleChatPresentationState extends Disposable implements IArticleChatPresentationState {
	declare readonly _serviceBrand: undefined;
	readonly id = 'article';

	private readonly states = new Map<string, IArticleChatResourceState>();
	private readonly onDidChangeEmitter = this._register(new Emitter<URI>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChange: Event<URI> = this.onDidChangeEmitter.event;

	constructor(
		@IChatService chatService: IChatService,
	) {
		super();
		this._register(chatService.onDidDeleteModel(resource => this.clearResource(resource)));
	}

	getPresentations(chatResource: URI): readonly IChatFeaturePresentation[] {
		return Object.freeze([...(this.states.get(getComparisonKey(chatResource))?.presentations ?? [])]);
	}

	getSelectedArticleIds(chatResource: URI): readonly ArticleId[] {
		return Object.freeze([
			...(this.states.get(getComparisonKey(chatResource))?.selectedArticleIds ?? []),
		]);
	}

	isArticleSelected(chatResource: URI, articleId: ArticleId): boolean {
		return this.states.get(getComparisonKey(chatResource))?.selectedArticleIds.includes(articleId) ?? false;
	}

	setArticleSelected(chatResource: URI, articleId: ArticleId, selected: boolean): void {
		if (typeof articleId !== 'string' || articleId.length === 0 || articleId.length > 2_048) {
			throw new TypeError('Article selection requires a bounded Article ID.');
		}
		const state = this.getState(chatResource);
		const current = state.selectedArticleIds.includes(articleId);
		if (current === selected) {
			return;
		}
		if (selected) {
			state.selectedArticleIds.push(articleId);
		} else {
			state.selectedArticleIds.splice(state.selectedArticleIds.indexOf(articleId), 1);
		}
		this.onDidChangeEmitter.fire(state.resource);
	}

	clearResource(chatResource: URI): void {
		const state = this.states.get(getComparisonKey(chatResource));
		if (!state) {
			return;
		}
		this.states.delete(getComparisonKey(chatResource));
		this.onDidChangeEmitter.fire(state.resource);
	}

	addArticleList(
		chatResource: URI,
		sourceLabel: string,
		items: readonly ArticleListItem[],
		fetchService: IFetchService,
	): void {
		const value = parseArticleListChatPresentation({
			sourceLabel,
			items: items.map(item => {
				const article = fetchService.getArticle(item.articleId);
				if (!article) {
					throw new Error(`Article '${item.articleId}' is unavailable.`);
				}
				return {
					id: item.id,
					articleId: item.articleId,
					title: item.title,
					url: article.url.toString(true),
					metadata: [item.publishedAt, item.articleType]
						.filter((candidate): candidate is string => !!candidate)
						.join(' | '),
				};
			}),
		});
		const state = this.getState(chatResource);
		state.presentations.push(captureProtocolPresentation(
			generateUuid(),
			ArticleListChatPresentationType,
			value,
		));
		this.onDidChangeEmitter.fire(state.resource);
	}

	addEmptySource(chatResource: URI, sourceLabel: string, message: string): void {
		const value = parseArticleSourceEmptyChatPresentation({ sourceLabel, message });
		const state = this.getState(chatResource);
		state.presentations.push(captureProtocolPresentation(
			generateUuid(),
			ArticleSourceEmptyChatPresentationType,
			value,
		));
		this.onDidChangeEmitter.fire(state.resource);
	}

	getMenuState(chatResource: URI) {
		const state = this.getState(chatResource);
		return Object.freeze({
			menuOpen: state.menuOpen,
			activeJournalId: state.activeJournalId,
			activeSourceId: state.activeSourceId,
		});
	}

	setMenuState(
		chatResource: URI,
		menu: Readonly<Pick<IArticleChatResourceState, 'menuOpen' | 'activeJournalId' | 'activeSourceId'>>,
	): void {
		const state = this.getState(chatResource);
		state.menuOpen = menu.menuOpen;
		state.activeJournalId = menu.activeJournalId;
		state.activeSourceId = menu.activeSourceId;
	}

	private getState(chatResource: URI): IArticleChatResourceState {
		const key = getComparisonKey(chatResource);
		let state = this.states.get(key);
		if (!state) {
			state = {
				resource: chatResource,
				selectedArticleIds: [],
				presentations: [],
				menuOpen: false,
				activeJournalId: undefined,
				activeSourceId: undefined,
			};
			this.states.set(key, state);
		}
		return state;
	}
}

function formatEvidenceRankTitle(message: string, rank: number, title: string): string {
	return message
		.replace(/\{0\}/gu, () => String(rank))
		.replace(/\{1\}/gu, () => title);
}

class ArticleChatPresentationRenderer implements IChatBrowserPresentationRenderer {
	constructor(
		readonly type: IChatBrowserPresentationRenderer['type'],
		private readonly state: IArticleChatPresentationState,
		private readonly browserService: IChatArticleBrowserService,
	) { }

	render(context: IChatBrowserPresentationRenderContext): HTMLElement {
		if (this.type === ArticleListChatPresentationType) {
			return this.renderList(context, parseArticleListChatPresentation(context.presentation.value));
		}
		if (this.type === ArticleSourceEmptyChatPresentationType) {
			const value = parseArticleSourceEmptyChatPresentation(context.presentation.value);
			const empty = $<HTMLElementTagNameMap['div']>('div.comet-chat-article-empty');
			const message = $<HTMLElementTagNameMap['p']>('p');
			message.textContent = value.message;
			const source = $<HTMLElementTagNameMap['p']>('p');
			source.textContent = value.sourceLabel;
			empty.append(message, source);
			return empty;
		}
		if (this.type === ArticleHistoryChatPresentationType) {
			const value = parseArticleHistoryChatPresentation(context.presentation.value);
			const history = $<HTMLElementTagNameMap['div']>('div.comet-chat-host-turn-presentation');
			if (value.articleIds.length > 0) {
				history.append(this.renderArticleIds(context, value.articleIds));
			}
			if (value.evidenceResult) {
				const result = $<HTMLElementTagNameMap['div']>('div.comet-chat-result');
				result.append(this.renderEvidenceHeader(context, value.evidenceResult));
				if (value.evidenceResult.evidence.length > 0) {
					result.append(this.renderEvidence(context, value.evidenceResult));
				}
				history.append(result);
			}
			return history;
		}
		throw new Error(`Article renderer received presentation type '${context.presentation.type}'.`);
	}

	private renderList(
		context: IChatBrowserPresentationRenderContext,
		value: IArticleListChatPresentation,
	): HTMLElement {
		const container = $<HTMLElementTagNameMap['section']>('section.comet-chat-article-list');
		const source = $<HTMLElementTagNameMap['strong']>('strong.comet-chat-article-list-source');
		source.textContent = value.sourceLabel;
		const list = $<HTMLElementTagNameMap['ul']>('ul.comet-chat-article-items');
		for (const item of value.items) {
			const row = $<HTMLElementTagNameMap['li']>('li.comet-chat-article-choice');
			const checkbox = context.disposables.add(new Checkbox(
				context.ui.chatArticleSelectionCheckbox,
				this.state.isArticleSelected(context.chatResource, item.articleId),
			));
			checkbox.domNode.classList.add('comet-chat-article-checkbox');
			const content = $<HTMLElementTagNameMap['span']>('span.comet-chat-article-choice-content');
			const open = $<HTMLElementTagNameMap['button']>('button.comet-chat-article-open');
			open.type = 'button';
			open.textContent = item.title;
			open.title = item.url;
			open.setAttribute('aria-label', `${context.ui.chatArticleOpen}: ${item.title}`);
			context.disposables.add(addDisposableListener(open, EventType.CLICK, () => {
				void this.browserService.open({
					chatResource: context.chatResource,
					articleId: item.articleId,
					uri: Uri.parse(item.url),
				}).catch(onUnexpectedError);
			}));
			content.append(open);
			if (item.metadata) {
				const metadata = $<HTMLElementTagNameMap['span']>('span.comet-chat-article-metadata');
				metadata.textContent = item.metadata;
				content.append(metadata);
			}
			row.append(checkbox.domNode, content);
			list.append(row);
			context.disposables.add(checkbox.onChange(() => {
				this.state.setArticleSelected(context.chatResource, item.articleId, checkbox.checked);
			}));
		}
		container.append(source, list);
		return container;
	}

	private renderArticleIds(
		context: IChatBrowserPresentationRenderContext,
		articleIds: readonly ArticleId[],
	): HTMLElement {
		const container = $<HTMLElementTagNameMap['section']>('section.comet-chat-article-list');
		const title = $<HTMLElementTagNameMap['strong']>('strong.comet-chat-article-list-source');
		title.textContent = context.ui.chatArticleSelectionCheckbox;
		const list = $<HTMLElementTagNameMap['ul']>('ul.comet-chat-article-items');
		for (const articleId of articleIds) {
			const row = $<HTMLElementTagNameMap['li']>('li.comet-chat-article-choice');
			const checkbox = context.disposables.add(new Checkbox(
				context.ui.chatArticleSelectionCheckbox,
				this.state.isArticleSelected(context.chatResource, articleId),
			));
			checkbox.domNode.classList.add('comet-chat-article-checkbox');
			const content = $<HTMLElementTagNameMap['span']>(
				'span.comet-chat-article-choice-content.comet-chat-host-article-id',
			);
			content.textContent = articleId;
			row.append(checkbox.domNode, content);
			list.append(row);
			context.disposables.add(checkbox.onChange(() => {
				this.state.setArticleSelected(context.chatResource, articleId, checkbox.checked);
			}));
		}
		container.append(title, list);
		return container;
	}

	private renderEvidenceHeader(
		context: IChatBrowserPresentationRenderContext,
		result: IArticleEvidenceResult,
	): HTMLElement {
		const header = $<HTMLElementTagNameMap['div']>('div.comet-chat-result-header');
		const strong = $<HTMLElementTagNameMap['strong']>('strong');
		strong.textContent = context.ui.assistantSidebarAnswerTitle;
		const pill = $<HTMLElementTagNameMap['span']>('span', {
			class: `comet-chat-mode-pill ${result.rerankApplied ? 'comet-is-enabled' : 'comet-is-disabled'}`,
		});
		pill.textContent = result.rerankApplied
			? context.ui.assistantSidebarRerankOn
			: context.ui.assistantSidebarRerankOff;
		header.append(strong, pill);
		return header;
	}

	private renderEvidence(
		context: IChatBrowserPresentationRenderContext,
		result: IArticleEvidenceResult,
	): HTMLElement {
		const evidence = $<HTMLElementTagNameMap['div']>('div.comet-chat-evidence');
		const title = $<HTMLElementTagNameMap['strong']>('strong');
		title.textContent = context.ui.assistantSidebarEvidenceTitle;
		const list = $<HTMLElementTagNameMap['ul']>('ul.comet-chat-evidence-list');
		for (const item of result.evidence) {
			const row = $<HTMLElementTagNameMap['li']>('li.comet-chat-evidence-item');
			const titleNode = $<HTMLElementTagNameMap['strong']>('strong.comet-chat-evidence-title');
			titleNode.textContent = formatEvidenceRankTitle(
				context.ui.chatEvidenceRankTitle,
				item.rank,
				item.title,
			);
			const metadata = $<HTMLElementTagNameMap['p']>('p.comet-chat-evidence-meta');
			metadata.textContent = [item.journalTitle, item.publishedAt].filter(Boolean).join(' | ');
			const excerpt = $<HTMLElementTagNameMap['p']>('p.comet-chat-evidence-text');
			excerpt.textContent = item.excerpt;
			row.append(titleNode, metadata, excerpt);
			list.append(row);
		}
		evidence.append(title, list);
		return evidence;
	}
}

class ArticleChatComposerView extends Disposable implements IChatComposerContributionView {
	readonly element = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-quick-actions-shell');
	private readonly renderDisposables = this._register(new DisposableStore());
	private readonly fetchCancellation = this._register(new MutableDisposable<CancellationTokenSource>());
	private menuContextView: IOpenContextView | null = null;
	private menuAnchor: HTMLElement | null = null;
	private replacingContextView = false;
	private disposing = false;

	constructor(
		private readonly chatResource: URI,
		private readonly ui: IChatBrowserPresentationRenderContext['ui'],
		private readonly isBusy: boolean,
		private readonly state: IArticleChatPresentationState,
		private readonly fetchService: IFetchService,
		private readonly contextViewService: IContextViewService,
		private readonly notificationService: INotificationService,
		private readonly documentActionsService: IDocumentActionsServiceContract,
		private readonly nativeHostService: INativeHostService,
	) {
		super();
		this._register(state.onDidChange(resource => {
			if (isEqual(resource, this.chatResource)) {
				this.render();
			}
		}));
		this._register(fetchService.onDidChangeCatalog(journalId => {
			if (journalId === this.state.getMenuState(this.chatResource).activeJournalId) {
				this.reconcileTarget();
				this.render();
			}
		}));
		this._register(fetchService.onDidChangeSource(sourceId => {
			if (sourceId === this.state.getMenuState(this.chatResource).activeSourceId) {
				this.render();
			}
		}));
		this.render();
	}

	override dispose(): void {
		if (this.disposing) {
			return;
		}
		this.disposing = true;
		this.cancelFetch();
		this.closeContextView();
		super.dispose();
		this.element.replaceChildren();
	}

	private render(): void {
		if (this.disposing) {
			return;
		}
		this.reconcileTarget();
		this.renderDisposables.clear();
		this.menuAnchor = this.element;
		const menuState = this.state.getMenuState(this.chatResource);
		const selected = this.state.getSelectedArticleIds(this.chatResource);
		const row = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-quick-actions');
		row.append(
			this.createActionButton(
				this.ui.chatQuickActionArticle,
				'file-text',
				() => this.toggleMenu(),
				menuState.menuOpen,
				this.isBusy,
			),
			this.createActionButton(
				this.ui.titlebarExportDocx,
				'docx',
				() => void this.exportSelected(),
				false,
				this.isBusy || !this.nativeHostService.canInvoke() || selected.length === 0,
			),
		);
		this.element.replaceChildren(row);
		this.syncContextView();
	}

	private createActionButton(
		label: string,
		icon: Parameters<typeof createLxIcon>[0],
		onClick: () => void,
		expanded: boolean,
		disabled: boolean,
	): HTMLButtonElement {
		const button = $<HTMLElementTagNameMap['button']>(
			'button.comet-chat-composer-quick-action.comet-btn-base.comet-btn-secondary.comet-btn-sm',
		);
		button.type = 'button';
		button.disabled = disabled;
		button.setAttribute('aria-label', label);
		button.setAttribute('aria-expanded', String(expanded));
		button.append(createLxIcon(icon), document.createTextNode(label));
		this.renderDisposables.add(addDisposableListener(button, EventType.CLICK, onClick));
		return button;
	}

	private async exportSelected(): Promise<void> {
		const articleIds = this.state.getSelectedArticleIds(this.chatResource);
		if (articleIds.length === 0) {
			throw new Error(`Chat '${this.chatResource.toString()}' has no selected Articles to export.`);
		}
		await this.documentActionsService.exportArticleSummaries({
			resource: this.chatResource,
			articleIds,
		});
		for (const articleId of articleIds) {
			this.state.setArticleSelected(this.chatResource, articleId, false);
		}
	}

	private renderMenu(anchor: HTMLElement): HTMLElement {
		const menuState = this.state.getMenuState(this.chatResource);
		const menu = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-menu');
		this.layoutMenu(menu, anchor);
		const header = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-menu-header');
		const title = $<HTMLElementTagNameMap['span']>('span.comet-chat-composer-article-menu-title');
		title.append(createLxIcon('file-text'), document.createTextNode(this.ui.chatArticleMenuTitle));
		const closeActions = createActionBarView({
			className: 'comet-chat-composer-article-menu-actions',
			ariaRole: 'group',
			items: [{
				label: this.ui.chatArticleMenuClose,
				title: this.ui.chatArticleMenuClose,
				content: createLxIcon('close'),
				buttonClassName: 'comet-chat-composer-article-menu-close',
				onClick: () => this.closeMenu(),
			}],
		});
		this.renderDisposables.add(closeActions);
		header.append(title, closeActions.getElement());

		const list = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-source-list');
		if (!menuState.activeJournalId) {
			for (const journal of this.fetchService.getJournals()) {
				list.append(this.createMenuButton(
					journal.title,
					journal.homeUrl.toString(true),
					false,
					() => void this.selectJournal(journal),
				));
			}
		} else {
			const journal = this.fetchService.getJournal(menuState.activeJournalId);
			if (journal) {
				list.append(this.createMenuButton(
					this.ui.chatArticleMenuBackToJournals,
					journal.title,
					false,
					() => this.clearJournal(),
				));
			}
			const catalog = this.fetchService.getArticleListCatalog(menuState.activeJournalId);
			if (!catalog) {
				const loading = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-source');
				loading.textContent = this.ui.chatArticleMenuLoadingSources;
				list.append(loading);
			} else {
				for (const entry of catalog.entries) {
					if (entry.kind === 'group') {
						const group = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-menu-title');
						group.textContent = entry.label;
						list.append(group);
						for (const source of entry.sources) {
							list.append(this.createSourceButton(source));
						}
					} else {
						list.append(this.createSourceButton(entry));
					}
				}
				const sourceId = menuState.activeSourceId;
				const page = sourceId ? this.fetchService.getArticlePages(sourceId).at(-1) : undefined;
				if (sourceId && page?.nextPageUrl) {
					list.append(this.createMenuButton(
						this.ui.chatArticleMenuLoadMore,
						page.nextPageUrl.toString(true),
						this.fetchService.getSourceLoadState(sourceId).status === 'loading',
						() => void this.fetchNextPage(sourceId),
					));
				}
			}
		}

		const scrollable = new DomScrollableElement(list, {
			className: 'comet-chat-composer-article-source-scrollable',
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto,
			verticalScrollbarSize: 10,
		});
		this.renderDisposables.add(scrollable);
		menu.append(header, scrollable.getDomNode());
		scrollable.scanDomNode();
		return menu;
	}

	private createSourceButton(source: ArticleListSource): HTMLElement {
		return this.createMenuButton(
			source.label,
			source.url.toString(true),
			this.fetchService.getSourceLoadState(source.id).status === 'loading',
			() => void this.selectSource(source),
		);
	}

	private createMenuButton(
		label: string,
		title: string,
		disabled: boolean,
		onClick: () => void,
	): HTMLElement {
		const button = $<HTMLElementTagNameMap['button']>('button.comet-chat-composer-article-source');
		button.type = 'button';
		button.disabled = disabled;
		button.textContent = label;
		button.title = title;
		this.renderDisposables.add(addDisposableListener(button, EventType.CLICK, onClick));
		return button;
	}

	private async selectJournal(journal: JournalDescriptor): Promise<void> {
		this.setMenuState({ menuOpen: true, activeJournalId: journal.id, activeSourceId: undefined });
		this.render();
		await this.runFetch(token => this.fetchService.discoverArticleListSources(journal.id, token));
	}

	private clearJournal(): void {
		this.cancelFetch();
		this.setMenuState({ menuOpen: true, activeJournalId: undefined, activeSourceId: undefined });
		this.render();
	}

	private async selectSource(source: ArticleListSource): Promise<void> {
		const menu = this.state.getMenuState(this.chatResource);
		this.setMenuState({ ...menu, activeSourceId: source.id });
		this.render();
		await this.runFetch(async token => {
			await this.fetchService.fetchArticleListSource(source.id, token);
			if (!token.isCancellationRequested) {
				this.insertPage(source.label, this.fetchService.getArticlePages(source.id).at(-1));
			}
		});
	}

	private async fetchNextPage(sourceId: string): Promise<void> {
		await this.runFetch(async token => {
			const source = this.getSource(sourceId);
			if (!source) {
				throw new Error(`Article source '${sourceId}' is unavailable in the active Catalog.`);
			}
			await this.fetchService.fetchNextPage(sourceId, token);
			if (!token.isCancellationRequested) {
				this.insertPage(source.label, this.fetchService.getArticlePages(sourceId).at(-1));
			}
		});
	}

	private insertPage(sourceLabel: string, page: ReturnType<IFetchService['getArticlePage']>): void {
		if (!page) {
			throw new Error(`Article source '${sourceLabel}' completed without an Article Page.`);
		}
		const items = [...page.groups.flatMap(group => group.itemIds), ...page.ungroupedItemIds]
			.map(itemId => {
				const item = this.fetchService.getArticleListItem(itemId);
				if (!item) {
					throw new Error(`Article List Item '${itemId}' is unavailable for Page '${page.id}'.`);
				}
				return item;
			});
		if (items.length === 0) {
			this.state.addEmptySource(
				this.chatResource,
				sourceLabel,
				this.ui.chatArticleMenuEmptySource,
			);
			return;
		}
		this.state.addArticleList(this.chatResource, sourceLabel, items, this.fetchService);
	}

	private getSource(sourceId: string): ArticleListSource | undefined {
		const journalId = this.state.getMenuState(this.chatResource).activeJournalId;
		const catalog = journalId ? this.fetchService.getArticleListCatalog(journalId) : undefined;
		return catalog?.entries
			.flatMap(entry => entry.kind === 'group' ? entry.sources : [entry])
			.find(source => source.id === sourceId);
	}

	private reconcileTarget(): void {
		const menu = this.state.getMenuState(this.chatResource);
		if (!menu.activeJournalId) {
			return;
		}
		if (!this.fetchService.getJournal(menu.activeJournalId)) {
			this.cancelFetch();
			this.setMenuState({ menuOpen: menu.menuOpen, activeJournalId: undefined, activeSourceId: undefined });
			return;
		}
		const catalog = this.fetchService.getArticleListCatalog(menu.activeJournalId);
		if (menu.activeSourceId && catalog && !this.getSource(menu.activeSourceId)) {
			this.cancelFetch();
			this.setMenuState({ ...menu, activeSourceId: undefined });
		}
	}

	private async runFetch(operation: (token: CancellationTokenSource['token']) => Promise<void>): Promise<void> {
		const cancellation = new CancellationTokenSource();
		this.cancelFetch();
		this.fetchCancellation.value = cancellation;
		try {
			await operation(cancellation.token);
		} catch (error) {
			if (!isCancellationError(error)) {
				this.notificationService.error(error instanceof Error ? error.message : String(error));
			}
		} finally {
			if (this.fetchCancellation.value === cancellation) {
				this.fetchCancellation.clear();
			}
		}
	}

	private cancelFetch(): void {
		this.fetchCancellation.value?.cancel();
		this.fetchCancellation.clear();
	}

	private syncContextView(): void {
		if (!this.state.getMenuState(this.chatResource).menuOpen) {
			this.closeContextView();
			return;
		}
		const anchor = this.menuAnchor;
		if (!anchor) {
			throw new Error('Article menu has no Chat composer anchor.');
		}
		if (this.menuContextView) {
			this.replacingContextView = true;
			try {
				this.closeContextView();
			} finally {
				this.replacingContextView = false;
			}
		}
		this.menuContextView = this.contextViewService.showContextView({
			getAnchor: () => anchor,
			render: container => {
				const disposables = new DisposableStore();
				container.classList.add('comet-chat-composer-article-context-view');
				const menu = this.renderMenu(anchor);
				container.append(menu);
				const resizeObserver = new ResizeObserver(() => {
					this.layoutMenu(menu, anchor);
					this.contextViewService.layout();
				});
				resizeObserver.observe(anchor);
				disposables.add(toDisposable(() => resizeObserver.disconnect()));
				const targetWindow = getWindow(container);
				disposables.add(addDisposableListener(targetWindow, EventType.BLUR, () => {
					this.contextViewService.hideContextView();
				}));
				disposables.add(addDisposableListener(targetWindow, EventType.MOUSE_DOWN, event => {
					if (event.defaultPrevented) {
						return;
					}
					const mouseEvent = new StandardMouseEvent(targetWindow, event);
					if (!mouseEvent.rightButton && (!mouseEvent.target || !container.contains(mouseEvent.target))) {
						this.contextViewService.hideContextView();
					}
				}));
				return disposables;
			},
			onHide: () => this.handleMenuHide(),
		});
	}

	private handleMenuHide(): void {
		this.menuContextView = null;
		if (this.disposing || this.replacingContextView) {
			return;
		}
		const menu = this.state.getMenuState(this.chatResource);
		if (!menu.menuOpen) {
			this.cancelFetch();
			return;
		}
		this.setMenuState({ ...menu, menuOpen: false });
		this.cancelFetch();
		this.render();
	}

	private toggleMenu(): void {
		const menu = this.state.getMenuState(this.chatResource);
		this.setMenuState({ ...menu, menuOpen: !menu.menuOpen });
		if (menu.menuOpen) {
			this.cancelFetch();
		}
		this.render();
	}

	private closeMenu(): void {
		const menu = this.state.getMenuState(this.chatResource);
		if (!menu.menuOpen) {
			return;
		}
		this.setMenuState({ ...menu, menuOpen: false });
		this.cancelFetch();
		this.render();
	}

	private closeContextView(): void {
		this.menuContextView?.close();
		this.menuContextView = null;
	}

	private setMenuState(
		menu: Parameters<IArticleChatPresentationState['setMenuState']>[1],
	): void {
		this.state.setMenuState(this.chatResource, menu);
	}

	private layoutMenu(menu: HTMLElement, anchor: HTMLElement): void {
		menu.style.width = `${getDomNodePagePosition(anchor).width}px`;
	}
}

/** Registers Article-owned transcript renderers, selection, and composer UI. */
export class ArticleChatPresentationsContribution extends Disposable {
	constructor(
		@IArticleChatPresentationState state: IArticleChatPresentationState,
		@IChatBrowserPresentationService presentationService: IChatBrowserPresentationService,
		@IChatComposerContributionService composerContributionService: IChatComposerContributionService,
		@IChatArticleBrowserService browserService: IChatArticleBrowserService,
		@IFetchService fetchService: IFetchService,
		@IContextViewService contextViewService: IContextViewService,
		@INotificationService notificationService: INotificationService,
		@IDocumentActionsService documentActionsService: IDocumentActionsServiceContract,
		@INativeHostService nativeHostService: INativeHostService,
	) {
		super();
		this._register(presentationService.registerSource(state));
		for (const type of [
			ArticleListChatPresentationType,
			ArticleSourceEmptyChatPresentationType,
			ArticleHistoryChatPresentationType,
		]) {
			this._register(presentationService.registerRenderer(
				new ArticleChatPresentationRenderer(type, state, browserService),
			));
		}
		this._register(composerContributionService.registerContribution({
			id: 'article',
			order: 100,
			createView: context => new ArticleChatComposerView(
				context.chatResource,
				context.ui,
				context.isBusy,
				state,
				fetchService,
				contextViewService,
				notificationService,
				documentActionsService,
				nativeHostService,
			),
		}));
	}
}

registerSingleton(
	IArticleChatPresentationState,
	ArticleChatPresentationState,
	InstantiationType.Delayed,
);
