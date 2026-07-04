/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType } from 'cs/base/browser/dom';
import {
	createActionBarView,
	type ActionBarActionItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'cs/base/browser/ui/lxicons/lxiconsSemantic';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';
import {
	ChatInputModelPickerActionViewItem,
	type ChatInputModelPickerProps,
} from 'cs/workbench/contrib/chat/browser/widget/input/chatInputPickerActionItem';

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
	| 'articleQuickSources'
	| 'isArticleSourceFetching'
	| 'onFetchArticleSource'
	| 'showArticleBatchActions'
	| 'onDownloadAllArticles'
	| 'onExportArticleSummaries'
> & {
	readonly isEmpty: boolean;
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

function getArticleSourceLabel(source: BatchSource) {
	const journalTitle = source.journalTitle.trim();
	return journalTitle || source.url;
}

export class ChatInputPart {
	private props: ChatInputPartProps;
	private readonly element = $<HTMLElementTagNameMap['div']>('div');
	private readonly renderDisposables = new DisposableStore();
	private readonly modelPicker: ChatInputModelPickerActionViewItem;
	private isArticleMenuOpen = false;

	constructor(props: ChatInputPartProps) {
		this.props = props;
		this.modelPicker = new ChatInputModelPickerActionViewItem(getModelPickerProps(props));
		this.render();
	}

	getElement() {
		return this.element;
	}

	setProps(props: ChatInputPartProps) {
		this.props = props;
		this.modelPicker.setProps(getModelPickerProps(props));
		this.render();
	}

	focus() {
		this.element.querySelector<HTMLTextAreaElement>('textarea')?.focus();
	}

	dispose() {
		this.renderDisposables.dispose();
		this.element.replaceChildren();
	}

	private render() {
		this.renderDisposables.clear();
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
		this.renderDisposables.add(this.modelPicker.render(toolbar));
		const sendLabel = this.props.isAsking
			? localize('assistantSidebarSendBusy', "Asking...")
			: localize('assistantSidebarSend', "Send");
		const actionsView = createActionBarView({
			className: 'comet-chat-composer-actions',
			ariaRole: 'group',
			items: [
				this.createComposerActionItem(
					localize('assistantSidebarImage', "Image"),
					'image-filled',
					'comet-chat-composer-tool-action',
				),
				{
					label: sendLabel,
					title: sendLabel,
					content: createLxIcon(
						this.props.isAsking
							? lxIconSemanticMap.assistant.busy
							: 'voice-circle-filled',
					),
					buttonClassName: 'comet-chat-composer-send-action',
					onClick: () => this.props.onAsk(),
				},
			],
		});
		this.renderDisposables.add(actionsView);
		toolbar.append(actionsView.getElement());
		composer.replaceChildren(textarea, toolbar);
		this.element.replaceChildren(
			composer,
			this.renderQuickActions(),
		);

		if (this.isArticleMenuOpen) {
			this.renderDisposables.add(addDisposableListener(document, EventType.MOUSE_DOWN, event => {
				if (event.target instanceof Node && !this.element.contains(event.target)) {
					this.closeArticleMenu();
				}
			}));
			this.renderDisposables.add(addDisposableListener(document, EventType.KEY_DOWN, event => {
				if (event.key === 'Escape') {
					this.closeArticleMenu();
				}
			}));
		}
	}

	private canSend() {
		return !this.props.isAsking && this.props.question.trim().length > 0;
	}

	private createComposerActionItem(
		label: string,
		icon: LxIconName,
		buttonClassName = 'comet-chat-composer-tool-action',
	): ActionBarActionItem {
		return {
			label,
			title: label,
			content: createLxIcon(icon),
			buttonClassName,
		};
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
		if (this.props.showArticleBatchActions) {
			quickActionButtons.push(
				this.createQuickActionButton(
					localize('chatQuickActionDownloadAllArticles', "下载全部"),
					lxIconSemanticMap.fetch.batchDownload,
					() => {
						void this.props.onDownloadAllArticles();
					},
					false,
					this.props.isArticleSourceFetching,
				),
				this.createQuickActionButton(
					localize('chatQuickActionExportArticleSummaries', "翻译并导出摘要"),
					'translate',
					() => {
						void this.props.onExportArticleSummaries();
					},
					false,
					this.props.isArticleSourceFetching,
				),
			);
		}
		row.append(...quickActionButtons);
		wrapper.append(row);

		if (this.isArticleMenuOpen) {
			wrapper.append(this.renderArticleMenu());
		}

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

	private renderArticleMenu() {
		const menu = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-menu');
		const header = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-menu-header');
		const title = $<HTMLElementTagNameMap['span']>('span.comet-chat-composer-article-menu-title');
		title.append(
			createLxIcon('file-text'),
			document.createTextNode(localize('chatArticleMenuTitle', "Article")),
		);
		const closeButton = $<HTMLElementTagNameMap['button']>('button.comet-chat-composer-article-menu-close.comet-btn-base.comet-btn-ghost.comet-btn-mode-icon.comet-btn-sm');
		closeButton.type = 'button';
		closeButton.setAttribute(
			'aria-label',
			localize('chatArticleMenuClose', "Close Article Sources"),
		);
		closeButton.append(createLxIcon('close'));
		this.renderDisposables.add(
			addDisposableListener(closeButton, EventType.CLICK, () => {
				this.closeArticleMenu();
			}),
		);
		header.append(title, closeButton);

		const list = $<HTMLElementTagNameMap['div']>('div.comet-chat-composer-article-source-list');
		for (const source of this.props.articleQuickSources) {
			const sourceButton = $<HTMLElementTagNameMap['button']>('button.comet-chat-composer-article-source');
			const sourceLabel = getArticleSourceLabel(source);
			sourceButton.type = 'button';
			sourceButton.disabled = this.props.isArticleSourceFetching;
			sourceButton.textContent = sourceLabel;
			sourceButton.title = source.url;
			this.renderDisposables.add(
				addDisposableListener(sourceButton, EventType.CLICK, () => {
					this.isArticleMenuOpen = false;
					this.render();
					void this.props.onFetchArticleSource(source);
				}),
			);
			list.append(sourceButton);
		}

		menu.append(header, list);
		return menu;
	}

	private toggleArticleMenu() {
		this.isArticleMenuOpen = !this.isArticleMenuOpen;
		this.render();
	}

	private closeArticleMenu() {
		if (!this.isArticleMenuOpen) {
			return;
		}

		this.isArticleMenuOpen = false;
		this.render();
	}
}
