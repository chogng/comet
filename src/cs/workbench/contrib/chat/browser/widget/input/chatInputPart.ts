/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType, getDomNodePagePosition, getWindow } from 'cs/base/browser/dom';
import {
	createActionBarView,
	type ActionBarMenuItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'cs/base/browser/ui/lxicons/lxiconsSemantic';
import { StandardMouseEvent } from 'cs/base/browser/mouseEvent';
import { DomScrollableElement } from 'cs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import { CancellationTokenSource, isCancellationError } from 'cs/base/common/cancellation';
import { DisposableStore, MutableDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { isEqual } from 'cs/base/common/resources';
import type { LocaleMessages } from 'language/locales';
import {
	IContextMenuService,
	IContextViewService,
	type IOpenContextView,
} from 'cs/platform/contextview/browser/contextView';
import { INotificationService } from 'cs/platform/notification/common/notification';
import { INativeHostService } from 'cs/platform/native/common/native';
import type { ChatModelDropdownOption } from 'cs/workbench/contrib/chat/browser/chat';
import {
	IChatService,
	type IChatModel,
} from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
	IFetchService,
	type ArticleListItem,
	type ArticleListSource,
	type JournalDescriptor,
} from 'cs/workbench/services/fetch/common/fetch';
import {
	ChatInputModelPickerActionViewItem,
	type IChatInputModelPickerProps,
} from 'cs/workbench/contrib/chat/browser/widget/input/chatInputPickerActionItem';
import {
	renderChatInputToolbar,
	type ChatInputToolbarActionItem,
} from 'cs/workbench/contrib/chat/browser/widget/input/chatInputToolbar';
import {
	IDocumentActionsService,
	type IDocumentActionsService as IDocumentActionsServiceContract,
} from 'cs/workbench/services/document/common/documentActions';

export interface ChatInputPartProps {
	readonly ui: LocaleMessages;
	readonly chatModel: IChatModel | undefined;
	readonly activeModelLabel: string;
	readonly question: string;
	readonly onQuestionChange: (value: string) => void;
	readonly isAsking: boolean;
	readonly onAsk: () => void;
	readonly modelOptions: readonly ChatModelDropdownOption[];
	readonly selectedModelId: string | undefined;
	readonly onSelectModel: (modelId: string | undefined) => void;
	readonly isEmpty: boolean;
	readonly inputToolbarActions: readonly ChatInputToolbarActionItem[];
}

function getModelPickerProps(props: ChatInputPartProps): IChatInputModelPickerProps {
	return {
		activeModelLabel: props.activeModelLabel,
		modelOptions: props.modelOptions,
		selectedModelId: props.selectedModelId,
		onSelectModel: props.onSelectModel,
		ui: props.ui,
	};
}

function createChatInputAddActionItem(
	contextMenuService: IContextMenuService,
	contextViewProvider: IContextViewService,
	ui: LocaleMessages,
) {
	const addLabel = ui.chatInputAdd;
	const menu: ActionBarMenuItem[] = [
		{
			id: 'chat-input-add-agents',
			label: ui.chatInputAddAgents,
			icon: 'agent',
		},
		{
			id: 'chat-input-add-image',
			label: ui.chatInputAddImage,
			icon: 'image',
		},
		{
			id: 'chat-input-add-skills',
			label: ui.chatInputAddSkills,
			icon: 'brain',
		},
		{
			id: 'chat-input-add-mcp',
			label: ui.chatInputAddMcp,
			icon: 'database',
		},
		{
			id: 'chat-input-add-plugins',
			label: ui.chatInputAddPlugins,
			icon: 'extensions',
		},
	];

	return createDropdownMenuActionViewItem({
		contextMenuService,
		contextViewProvider,
		label: addLabel,
		title: addLabel,
		content: createLxIcon('add'),
		className: 'comet-chat-add-menu',
		buttonClassName: 'comet-chat-add-menu-btn',
		menu,
		menuClassName: 'comet-chat-add-menu',
		menuData: 'chat-add-menu',
		minWidth: 180,
		overlayAlignmentPolicy: 'prefer-start',
	});
}

export class ChatInputPart {
	private props: ChatInputPartProps;
	private readonly element = $<HTMLElementTagNameMap['div']>('div');
	private readonly disposables = new DisposableStore();
	private readonly renderDisposables = new DisposableStore();
	private readonly articleFetchCancellation = this.disposables.add(new MutableDisposable<CancellationTokenSource>());
	private readonly modelPicker: ChatInputModelPickerActionViewItem;
	private articleMenuContextView: IOpenContextView | null = null;
	private articleMenuAnchor: HTMLElement | null = null;
	private isReplacingArticleMenuContextView = false;
	private isArticleMenuOpen = false;
	private activeJournalId: string | undefined;
	private activeSourceId: string | undefined;
	private disposed = false;

	constructor(
		props: ChatInputPartProps,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IFetchService private readonly fetchService: IFetchService,
		@IChatService private readonly chatService: IChatService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDocumentActionsService private readonly documentActionsService: IDocumentActionsServiceContract,
		@INativeHostService private readonly nativeHostService: INativeHostService,
	) {
		this.props = props;
		this.modelPicker = new ChatInputModelPickerActionViewItem(
			getModelPickerProps(props),
			this.contextMenuService,
			this.contextViewService,
		);
		this.disposables.add(this.fetchService.onDidChangeCatalog(journalId => {
			if (journalId === this.activeJournalId) {
				this.reconcileArticleTarget();
				this.render();
			}
		}));
		this.disposables.add(this.fetchService.onDidChangeSource(sourceId => {
			if (sourceId === this.activeSourceId) {
				this.render();
			}
		}));
		this.render();
	}

	getElement() {
		return this.element;
	}

	setProps(props: ChatInputPartProps) {
		if (this.disposed) {
			return;
		}

		if (!isEqual(this.props.chatModel?.resource, props.chatModel?.resource)) {
			this.cancelArticleFetch();
			this.closeArticleMenuContextView();
			this.isArticleMenuOpen = false;
			this.activeJournalId = undefined;
			this.activeSourceId = undefined;
		}
		this.props = props;
		this.modelPicker.setProps(getModelPickerProps(props));
		this.render();
	}

	setQuestion(question: string): void {
		if (this.disposed || this.props.question === question) {
			return;
		}

		this.props = { ...this.props, question };
		const textarea = this.element.querySelector<HTMLTextAreaElement>('textarea');
		if (!textarea) {
			throw new Error('A Chat input cannot update its question before rendering.');
		}
		if (textarea.value !== question) {
			textarea.value = question;
		}
		const sendButton = this.element.querySelector<HTMLButtonElement>(
			'.comet-chat-composer-send-action',
		);
		if (!sendButton) {
			throw new Error('A Chat input cannot update its send action before rendering.');
		}
		sendButton.disabled = !this.canSend();
	}

	focus() {
		this.element.querySelector<HTMLTextAreaElement>('textarea')?.focus();
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.cancelArticleFetch();
		this.disposables.dispose();
		this.renderDisposables.dispose();
		this.closeArticleMenuContextView();
		this.element.replaceChildren();
	}

	private render() {
		if (this.disposed) {
			return;
		}
		this.reconcileArticleTarget();
		const ui = this.props.ui;

		this.renderDisposables.clear();
		this.articleMenuAnchor = null;
		if (!this.props.chatModel) {
			this.element.replaceChildren();
			return;
		}
		this.element.className = [
			'comet-chat-composer-host',
			this.props.isEmpty ? 'comet-is-empty-state' : '',
		]
			.filter(Boolean)
			.join(' ');

		const composer = $<HTMLElementTagNameMap['div']>('div', { class: [
				'comet-chat-composer',
				this.props.isEmpty ? 'comet-is-empty-state' : '',
			]
				.filter(Boolean)
				.join(' ') });

		const textarea = $<HTMLElementTagNameMap['textarea']>('textarea.comet-chat-composer-input');
		textarea.rows = 2;
		textarea.value = this.props.question;
		textarea.placeholder = ui.assistantSidebarQuestionPlaceholder;
		textarea.disabled = this.props.isAsking;
		textarea.setAttribute('aria-label', ui.assistantSidebarQuestion);
		this.renderDisposables.add(addDisposableListener(textarea, EventType.INPUT, () => {
			this.props.onQuestionChange(textarea.value);
		}));
		this.renderDisposables.add(addDisposableListener(textarea, EventType.KEY_DOWN, event => {
			if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
				return;
			}
			event.preventDefault();
			if (this.canSend()) {
				this.props.onAsk();
			}
		}));

		const toolbar = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-toolbar');
		const composerTools = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-tools');
		const addMenuActions = createActionBarView({
			className: 'comet-chat-composer-add-menu-actions',
			ariaRole: 'group',
			items: [createChatInputAddActionItem(this.contextMenuService, this.contextViewService, ui)],
		});
		this.renderDisposables.add(addMenuActions);
		composerTools.append(addMenuActions.getElement());
		const modelPickerContainer = $<HTMLElementTagNameMap['div']>('div');
		this.renderDisposables.add(this.modelPicker.render(modelPickerContainer));
		composerTools.append(modelPickerContainer);
		toolbar.append(composerTools);
		const sendLabel = this.props.isAsking
			? ui.assistantSidebarSendBusy
			: ui.assistantSidebarSend;
		const actionsView = createActionBarView({
			className: 'comet-chat-composer-actions',
			ariaRole: 'group',
			items: [{
				label: sendLabel,
				title: sendLabel,
				disabled: !this.canSend(),
				content: createLxIcon(
					this.props.isAsking
						? lxIconSemanticMap.assistant.busy
						: 'mic',
				),
				buttonClassName: 'comet-chat-composer-send-action',
				onClick: () => {
					if (this.canSend()) {
						this.props.onAsk();
					}
				},
			}],
		});
		this.renderDisposables.add(actionsView);
		toolbar.append(actionsView.getElement());
		composer.replaceChildren(textarea, toolbar);
		const content: HTMLElement[] = [];
		const inputToolbar = renderChatInputToolbar(
			this.props.inputToolbarActions,
			this.renderDisposables,
			ui.chatInputToolbar,
		);
		if (inputToolbar) {
			content.push(inputToolbar);
		}
		content.push(composer, this.renderQuickActions());
		this.element.replaceChildren(...content);
		this.syncArticleMenuContextView();
	}

	private canSend() {
		return !this.props.isAsking && this.props.question.trim().length > 0;
	}

	private renderQuickActions() {
		const ui = this.props.ui;
		const hasCheckedArticles = this.requireChatModel().getSnapshot().checkedArticleIds.length > 0;
		const wrapper = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-quick-actions-shell');
		const row = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-quick-actions');
		const quickActionButtons = [
			this.createQuickActionButton(ui.chatQuickActionWrite, 'write'),
			this.createQuickActionButton(ui.chatQuickActionLearn, 'book'),
			this.createQuickActionButton(ui.chatQuickActionCode, 'code'),
			this.createQuickActionButton(
				ui.chatQuickActionArticle,
				'file-text',
				() => this.toggleArticleMenu(),
				this.isArticleMenuOpen,
			),
			this.createQuickActionButton(
				ui.titlebarExportDocx,
				'docx',
				() => { void this.exportCheckedArticleSummaries(); },
				false,
				!this.nativeHostService.canInvoke() || !hasCheckedArticles,
			),
		];
		this.articleMenuAnchor = wrapper;
		row.append(...quickActionButtons);
		wrapper.append(row);

		return wrapper;
	}

	private exportCheckedArticleSummaries(): Promise<void> {
		const model = this.requireChatModel();
		const articleIds = [...model.getSnapshot().checkedArticleIds];
		if (articleIds.length === 0) {
			throw new Error(`Chat '${model.resource.toString()}' has no checked Articles to export.`);
		}
		return this.documentActionsService.exportArticleSummaries({
			resource: model.resource,
			articleIds,
		});
	}

	private createQuickActionButton(
		label: string,
		icon: LxIconName,
		onClick?: () => void,
		expanded = false,
		disabled = false,
	) {
		const button = $<HTMLElementTagNameMap['button']>('button.comet-chat-composer-quick-action.comet-btn-base.comet-btn-secondary.comet-btn-sm');
		button.type = 'button';
		button.disabled = disabled;
		button.setAttribute('aria-label', label);
		if (expanded) {
			button.setAttribute('aria-expanded', 'true');
		}
		button.append(createLxIcon(icon), document.createTextNode(label));
		if (onClick) {
			this.renderDisposables.add(
				addDisposableListener(button, EventType.CLICK, onClick),
			);
		}
		return button;
	}

	private renderArticleMenu(anchor: HTMLElement) {
		const ui = this.props.ui;
		const menu = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-menu');
		this.layoutArticleMenu(menu, anchor);
		const header = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-menu-header');
		const title = $<HTMLElementTagNameMap['span']>('span.comet-chat-composer-article-menu-title');
		title.append(
			createLxIcon('file-text'),
			document.createTextNode(ui.chatArticleMenuTitle),
		);
		const closeLabel = ui.chatArticleMenuClose;
		const closeActionsView = createActionBarView({
			className: 'comet-chat-composer-article-menu-actions',
			ariaRole: 'group',
			items: [{
				label: closeLabel,
				title: closeLabel,
				content: createLxIcon('close'),
				buttonClassName: 'comet-chat-composer-article-menu-close',
				onClick: () => this.closeArticleMenu(),
			}],
		});
		this.renderDisposables.add(closeActionsView);
		header.append(title, closeActionsView.getElement());

		const list = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-source-list');
		if (!this.activeJournalId) {
			for (const journal of this.fetchService.getJournals()) {
				list.append(this.createArticleMenuButton(
					journal.title,
					journal.homeUrl.toString(true),
					false,
					() => void this.selectJournal(journal),
				));
			}
		} else {
			const journal = this.fetchService.getJournal(this.activeJournalId);
			if (journal) {
				list.append(this.createArticleMenuButton(
					ui.chatArticleMenuBackToJournals,
					journal.title,
					false,
					() => this.clearActiveJournal(),
				));
			}
			const catalog = this.fetchService.getArticleListCatalog(this.activeJournalId);
			if (!catalog) {
				const loading = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-source');
				loading.textContent = ui.chatArticleMenuLoadingSources;
				list.append(loading);
			} else {
				for (const entry of catalog.entries) {
					if (entry.kind === 'group') {
						const groupLabel = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-menu-title');
						groupLabel.textContent = entry.label;
						list.append(groupLabel);
						for (const source of entry.sources) {
							list.append(this.createArticleSourceButton(source));
						}
					} else {
						list.append(this.createArticleSourceButton(entry));
					}
				}
				const activeSourceId = this.activeSourceId;
				const pages = activeSourceId ? this.fetchService.getArticlePages(activeSourceId) : [];
				const lastPage = pages.at(-1);
				if (activeSourceId && lastPage?.nextPageUrl) {
					list.append(this.createArticleMenuButton(
						ui.chatArticleMenuLoadMore,
						lastPage.nextPageUrl.toString(true),
						this.fetchService.getSourceLoadState(activeSourceId).status === 'loading',
						() => void this.fetchNextPage(activeSourceId),
					));
				}
			}
		}

		const scrollableList = new DomScrollableElement(list, {
			className: 'comet-chat-composer-article-source-scrollable',
			horizontal: ScrollbarVisibility.Hidden,
			vertical: ScrollbarVisibility.Auto,
			verticalScrollbarSize: 10,
		});
		this.renderDisposables.add(scrollableList);

		menu.append(header, scrollableList.getDomNode());
		scrollableList.scanDomNode();
		return menu;
	}

	private layoutArticleMenu(menu: HTMLElement, anchor: HTMLElement): void {
		menu.style.width = `${getDomNodePagePosition(anchor).width}px`;
	}

	private createArticleSourceButton(source: ArticleListSource): HTMLElement {
		return this.createArticleMenuButton(
			source.label,
			source.url.toString(true),
			this.fetchService.getSourceLoadState(source.id).status === 'loading',
			() => void this.selectArticleSource(source),
		);
	}

	private createArticleMenuButton(label: string, title: string, disabled: boolean, onClick: () => void): HTMLElement {
		const button = $<HTMLElementTagNameMap['button']>('button.comet-chat-composer-article-source');
		button.type = 'button';
		button.disabled = disabled;
		button.textContent = label;
		button.title = title;
		this.renderDisposables.add(addDisposableListener(button, EventType.CLICK, onClick));
		return button;
	}

	private async selectJournal(journal: JournalDescriptor): Promise<void> {
		this.activeJournalId = journal.id;
		this.activeSourceId = undefined;
		this.render();
		await this.runArticleFetch(token => this.fetchService.discoverArticleListSources(journal.id, token));
	}

	private clearActiveJournal(): void {
		this.cancelArticleFetch();
		this.activeJournalId = undefined;
		this.activeSourceId = undefined;
		this.render();
	}

	private async selectArticleSource(source: ArticleListSource): Promise<void> {
		const chatResource = this.requireChatModel().resource;
		this.activeSourceId = source.id;
		this.render();
		await this.runArticleFetch(async token => {
			await this.fetchService.fetchArticleListSource(source.id, token);
			if (token.isCancellationRequested) {
				return;
			}
			this.insertArticlePage(chatResource, source.label, this.fetchService.getArticlePages(source.id).at(-1));
		});
	}

	private async fetchNextPage(sourceId: string): Promise<void> {
		const chatResource = this.requireChatModel().resource;
		await this.runArticleFetch(async token => {
			const source = this.getArticleSource(sourceId);
			if (!source) {
				throw new Error(`Article source '${sourceId}' is no longer available in the active Catalog.`);
			}
			await this.fetchService.fetchNextPage(sourceId, token);
			if (token.isCancellationRequested) {
				return;
			}
			this.insertArticlePage(chatResource, source.label, this.fetchService.getArticlePages(sourceId).at(-1));
		});
	}

	private getArticleSource(sourceId: string): ArticleListSource | undefined {
		const journalId = this.activeJournalId;
		const catalog = journalId ? this.fetchService.getArticleListCatalog(journalId) : undefined;
		return catalog?.entries.flatMap(entry => entry.kind === 'group' ? entry.sources : [entry]).find(source => source.id === sourceId);
	}

	private reconcileArticleTarget(): void {
		const journalId = this.activeJournalId;
		if (!journalId) {
			return;
		}
		if (!this.fetchService.getJournal(journalId)) {
			this.cancelArticleFetch();
			this.activeJournalId = undefined;
			this.activeSourceId = undefined;
			return;
		}

		const sourceId = this.activeSourceId;
		const catalog = this.fetchService.getArticleListCatalog(journalId);
		if (sourceId && catalog && !this.getArticleSource(sourceId)) {
			this.cancelArticleFetch();
			this.activeSourceId = undefined;
		}
	}

	private insertArticlePage(
		chatResource: IChatModel['resource'],
		sourceLabel: string,
		page: ReturnType<IFetchService['getArticlePage']>,
	): void {
		if (!isEqual(this.props.chatModel?.resource, chatResource)) {
			return;
		}
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
			this.chatService.insertArticleFetchEmptyResult(
				chatResource,
				sourceLabel,
				this.props.ui.chatArticleMenuEmptySource,
			);
			return;
		}
		const content = [sourceLabel, ...items.map(item => this.formatArticleListItem(item))].join('\n');
		this.chatService.insertArticleList(chatResource, sourceLabel, items.map(item => item.articleId), content);
	}

	private requireChatModel(): IChatModel {
		if (!this.props.chatModel) {
			throw new Error('A Chat input action requires a bound Chat model.');
		}
		return this.props.chatModel;
	}

	private formatArticleListItem(item: ArticleListItem): string {
		const article = this.fetchService.getArticle(item.articleId);
		if (!article) {
			throw new Error(`Article "${item.articleId}" is unavailable.`);
		}
		const metadata = [item.publishedAt, item.articleType].filter((value): value is string => !!value).join(' | ');
		const title = item.title.replace(/\]/g, ')');
		const link = `[${title}](${article.url.toString(true)})`;
		return metadata ? `- ${link} - ${metadata}` : `- ${link}`;
	}

	private async runArticleFetch(operation: (token: CancellationTokenSource['token']) => Promise<void>): Promise<void> {
		const cancellation = new CancellationTokenSource();
		this.cancelArticleFetch();
		this.articleFetchCancellation.value = cancellation;
		try {
			await operation(cancellation.token);
		} catch (error) {
			if (isCancellationError(error)) {
				return;
			}
			this.notificationService.error(error instanceof Error ? error.message : String(error));
		} finally {
			if (this.articleFetchCancellation.value === cancellation) {
				this.articleFetchCancellation.clear();
			}
		}
	}

	private cancelArticleFetch(): void {
		this.articleFetchCancellation.value?.cancel();
		this.articleFetchCancellation.clear();
	}

	private syncArticleMenuContextView() {
		if (!this.isArticleMenuOpen) {
			this.closeArticleMenuContextView();
			return;
		}

		const anchor = this.articleMenuAnchor;
		if (!anchor) {
			return;
		}

		if (this.articleMenuContextView) {
			this.isReplacingArticleMenuContextView = true;
			try {
				this.closeArticleMenuContextView();
			} finally {
				this.isReplacingArticleMenuContextView = false;
			}
		}
		this.articleMenuContextView = this.contextViewService.showContextView({
			getAnchor: () => anchor,
			render: container => {
				const disposables = new DisposableStore();
				container.classList.add('comet-chat-composer-article-context-view');
				const menu = this.renderArticleMenu(anchor);
				container.append(menu);
				const resizeObserver = new ResizeObserver(() => {
					this.layoutArticleMenu(menu, anchor);
					this.contextViewService.layout();
				});
				resizeObserver.observe(anchor);
				disposables.add(toDisposable(() => resizeObserver.disconnect()));
				const targetWindow = getWindow(container);
				disposables.add(addDisposableListener(targetWindow, EventType.BLUR, () => {
					this.contextViewService.hideContextView();
				}));
				disposables.add(addDisposableListener(targetWindow, EventType.MOUSE_DOWN, (browserEvent: MouseEvent) => {
					if (browserEvent.defaultPrevented) {
						return;
					}

					const event = new StandardMouseEvent(targetWindow, browserEvent);
					if (event.rightButton || (event.target && container.contains(event.target))) {
						return;
					}

					this.contextViewService.hideContextView();
				}));
				return disposables;
			},
			onHide: this.handleArticleMenuHide,
		});
	}

	private readonly handleArticleMenuHide = () => {
		this.articleMenuContextView = null;
		if (this.disposed) {
			return;
		}
		if (this.isReplacingArticleMenuContextView) {
			return;
		}
		if (!this.isArticleMenuOpen) {
			this.cancelArticleFetch();
			return;
		}

		this.isArticleMenuOpen = false;
		this.cancelArticleFetch();
		this.render();
	};

	private closeArticleMenuContextView() {
		this.articleMenuContextView?.close();
		this.articleMenuContextView = null;
	}

	private toggleArticleMenu() {
		this.isArticleMenuOpen = !this.isArticleMenuOpen;
		if (!this.isArticleMenuOpen) {
			this.cancelArticleFetch();
		}
		this.render();
	}

	private closeArticleMenu() {
		if (!this.isArticleMenuOpen) {
			return;
		}

		this.isArticleMenuOpen = false;
		this.cancelArticleFetch();
		this.render();
	}
}
