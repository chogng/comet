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
import { localize } from 'cs/nls';
import {
	IContextViewService,
	type IOpenContextView,
} from 'cs/platform/contextview/browser/contextView';
import { INotificationService } from 'cs/platform/notification/common/notification';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import {
	IFetchService,
	type ArticleListItem,
	type ArticleListSource,
	type JournalDescriptor,
} from 'cs/workbench/services/fetch/common/fetch';
import {
	ChatInputModelPickerActionViewItem,
	type ChatInputModelPickerProps,
} from 'cs/workbench/contrib/chat/browser/widget/input/chatInputPickerActionItem';
import {
	renderChatInputToolbar,
	type ChatInputToolbarActionItem,
} from 'cs/workbench/contrib/chat/browser/widget/input/chatInputToolbar';

export type ChatInputPartProps = Pick<
	ChatWidgetProps,
	| 'activeLlmModelLabel'
	| 'isMaxContextWindowEnabled'
	| 'activeLlmModelSupportsMaxContextWindow'
	| 'question'
	| 'onQuestionChange'
	| 'isAsking'
	| 'onAsk'
	| 'llmModelOptions'
	| 'activeLlmModelOptionValue'
	| 'onToggleAutoModelRouting'
	| 'onSelectLlmModel'
	| 'onToggleMaxContextWindow'
	| 'onOpenModelSettings'
> & {
	readonly isEmpty: boolean;
	readonly inputToolbarActions: readonly ChatInputToolbarActionItem[];
};

function getModelPickerProps(props: ChatInputPartProps): ChatInputModelPickerProps {
	return {
		activeLlmModelLabel: props.activeLlmModelLabel,
		isMaxContextWindowEnabled: props.isMaxContextWindowEnabled,
		activeLlmModelSupportsMaxContextWindow: props.activeLlmModelSupportsMaxContextWindow,
		llmModelOptions: props.llmModelOptions,
		activeLlmModelOptionValue: props.activeLlmModelOptionValue,
		onToggleAutoModelRouting: props.onToggleAutoModelRouting,
		onSelectLlmModel: props.onSelectLlmModel,
		onToggleMaxContextWindow: props.onToggleMaxContextWindow,
		onOpenModelSettings: props.onOpenModelSettings,
	};
}

function createChatInputAddActionItem() {
	const addLabel = localize('chatInputAdd', "Add");
	const menu: ActionBarMenuItem[] = [
		{
			id: 'chat-input-add-agents',
			label: localize('chatInputAddAgents', "Agents"),
			icon: 'agent',
		},
		{
			id: 'chat-input-add-image',
			label: localize('chatInputAddImage', "Image"),
			icon: 'image',
		},
		{
			id: 'chat-input-add-skills',
			label: localize('chatInputAddSkills', "Skills"),
			icon: 'brain',
		},
		{
			id: 'chat-input-add-mcp',
			label: localize('chatInputAddMcp', "MCP"),
			icon: 'database',
		},
		{
			id: 'chat-input-add-plugins',
			label: localize('chatInputAddPlugins', "Plugins"),
			icon: 'extensions',
		},
	];

	return createDropdownMenuActionViewItem({
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
		@IFetchService private readonly fetchService: IFetchService,
		@IChatService private readonly chatService: IChatService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		this.props = props;
		this.modelPicker = new ChatInputModelPickerActionViewItem(getModelPickerProps(props));
		this.disposables.add(this.fetchService.onDidChangeCatalog(journalId => {
			if (journalId === this.activeJournalId) {
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

		this.props = props;
		this.modelPicker.setProps(getModelPickerProps(props));
		this.render();
	}

	focus() {
		this.element.querySelector<HTMLTextAreaElement>('textarea')?.focus();
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.disposables.dispose();
		this.renderDisposables.dispose();
		this.closeArticleMenuContextView();
		this.element.replaceChildren();
	}

	private render() {
		if (this.disposed) {
			return;
		}

		this.renderDisposables.clear();
		this.articleMenuAnchor = null;
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
		textarea.placeholder = localize(
			'assistantSidebarQuestionPlaceholder',
			"Ask about the fetched literature, compare findings, or draft a short evidence-backed answer.",
		);
		textarea.disabled = this.props.isAsking;
		textarea.setAttribute(
			'aria-label',
			localize('assistantSidebarQuestion', "Question"),
		);
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
			items: [createChatInputAddActionItem()],
		});
		this.renderDisposables.add(addMenuActions);
		composerTools.append(addMenuActions.getElement());
		const modelPickerContainer = $<HTMLElementTagNameMap['div']>('div');
		this.renderDisposables.add(this.modelPicker.render(modelPickerContainer));
		composerTools.append(modelPickerContainer);
		toolbar.append(composerTools);
		const sendLabel = this.props.isAsking
			? localize('assistantSidebarSendBusy', "Asking...")
			: localize('assistantSidebarSend', "Send");
		const actionsView = createActionBarView({
			className: 'comet-chat-composer-actions',
			ariaRole: 'group',
			items: [{
				label: sendLabel,
				title: sendLabel,
				content: createLxIcon(
					this.props.isAsking
						? lxIconSemanticMap.assistant.busy
						: 'mic',
				),
				buttonClassName: 'comet-chat-composer-send-action',
				onClick: () => this.props.onAsk(),
			}],
		});
		this.renderDisposables.add(actionsView);
		toolbar.append(actionsView.getElement());
		composer.replaceChildren(textarea, toolbar);
		const content: HTMLElement[] = [];
		const inputToolbar = renderChatInputToolbar(
			this.props.inputToolbarActions,
			this.renderDisposables,
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
		const wrapper = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-quick-actions-shell');
		const row = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-quick-actions');
		const quickActionButtons = [
			this.createQuickActionButton(localize('chatQuickActionWrite', "Write"), 'write'),
			this.createQuickActionButton(localize('chatQuickActionLearn', "Learn"), 'book'),
			this.createQuickActionButton(localize('chatQuickActionCode', "Code"), 'code'),
			this.createQuickActionButton(
				localize('chatQuickActionArticle', "Article"),
				'file-text',
				() => this.toggleArticleMenu(),
				this.isArticleMenuOpen,
			),
		];
		this.articleMenuAnchor = wrapper;
		row.append(...quickActionButtons);
		wrapper.append(row);

		return wrapper;
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
		const menu = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-menu');
		this.layoutArticleMenu(menu, anchor);
		const header = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-menu-header');
		const title = $<HTMLElementTagNameMap['span']>('span.comet-chat-composer-article-menu-title');
		title.append(
			createLxIcon('file-text'),
			document.createTextNode(localize('chatArticleMenuTitle', "Article")),
		);
		const closeLabel = localize('chatArticleMenuClose', "Close Article Sources");
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
					localize('chatArticleMenuBackToJournals', "Back to Journals"),
					journal.title,
					false,
					() => this.clearActiveJournal(),
				));
			}
			const catalog = this.fetchService.getArticleListCatalog(this.activeJournalId);
			if (!catalog) {
				const loading = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-source');
				loading.textContent = localize('chatArticleMenuLoadingSources', "Loading article sources...");
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
						localize('chatArticleMenuLoadMore', "Load More"),
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
		this.articleFetchCancellation.clear();
		this.activeJournalId = undefined;
		this.activeSourceId = undefined;
		this.render();
	}

	private async selectArticleSource(source: ArticleListSource): Promise<void> {
		this.activeSourceId = source.id;
		this.render();
		const completed = await this.runArticleFetch(token => this.fetchService.fetchArticleListSource(source.id, token));
		if (completed) {
			this.insertArticlePage(source.label, this.fetchService.getArticlePages(source.id).at(-1));
		}
	}

	private async fetchNextPage(sourceId: string): Promise<void> {
		const source = this.getArticleSource(sourceId);
		if (!source) {
			return;
		}
		const completed = await this.runArticleFetch(token => this.fetchService.fetchNextPage(sourceId, token));
		if (completed) {
			this.insertArticlePage(source.label, this.fetchService.getArticlePages(sourceId).at(-1));
		}
	}

	private getArticleSource(sourceId: string): ArticleListSource | undefined {
		const journalId = this.activeJournalId;
		const catalog = journalId ? this.fetchService.getArticleListCatalog(journalId) : undefined;
		return catalog?.entries.flatMap(entry => entry.kind === 'group' ? entry.sources : [entry]).find(source => source.id === sourceId);
	}

	private insertArticlePage(sourceLabel: string, page: ReturnType<IFetchService['getArticlePage']>): void {
		if (!page) {
			return;
		}
		const items = [...page.groups.flatMap(group => group.itemIds), ...page.ungroupedItemIds]
			.map(itemId => this.fetchService.getArticleListItem(itemId))
			.filter((item): item is ArticleListItem => !!item);
		if (items.length === 0) {
			this.chatService.insertArticleFetchEmptyResult(
				sourceLabel,
				localize('chatArticleMenuEmptySource', "No articles are available from this source."),
			);
			return;
		}
		const content = [sourceLabel, ...items.map(item => this.formatArticleListItem(item))].join('\n');
		this.chatService.insertArticleList(sourceLabel, items.map(item => item.articleId), content);
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

	private async runArticleFetch(operation: (token: CancellationTokenSource['token']) => Promise<void>): Promise<boolean> {
		const cancellation = new CancellationTokenSource();
		this.articleFetchCancellation.value = cancellation;
		try {
			await operation(cancellation.token);
			return !cancellation.token.isCancellationRequested;
		} catch (error) {
			if (isCancellationError(error)) {
				return false;
			}
			this.notificationService.error(error instanceof Error ? error.message : String(error));
			return false;
		} finally {
			if (this.articleFetchCancellation.value === cancellation) {
				this.articleFetchCancellation.clear();
			}
		}
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
			this.articleFetchCancellation.clear();
			return;
		}

		this.isArticleMenuOpen = false;
		this.render();
	};

	private closeArticleMenuContextView() {
		this.articleMenuContextView?.close();
		this.articleMenuContextView = null;
	}

	private toggleArticleMenu() {
		this.isArticleMenuOpen = !this.isArticleMenuOpen;
		if (!this.isArticleMenuOpen) {
			this.articleFetchCancellation.clear();
		}
		this.render();
	}

	private closeArticleMenu() {
		if (!this.isArticleMenuOpen) {
			return;
		}

		this.isArticleMenuOpen = false;
		this.articleFetchCancellation.clear();
		this.render();
	}
}
