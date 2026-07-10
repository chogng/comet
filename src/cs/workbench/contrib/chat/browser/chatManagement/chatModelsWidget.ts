/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType } from 'cs/base/browser/dom';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { ILanguageModelsService } from 'cs/workbench/contrib/chat/common/languageModels';
import {
	ChatModelsViewModel,
	isLanguageModelEntry,
	isLanguageModelGroupEntry,
	isLanguageModelProviderEntry,
	type IViewModelEntry,
} from 'cs/workbench/contrib/chat/browser/chatManagement/chatModelsViewModel';

export class ChatModelsWidget extends Disposable {
	readonly element = $('.comet-chat-models-widget');

	private readonly renderStore = this._register(new DisposableStore());
	private readonly viewModel: ChatModelsViewModel;
	private readonly searchInput = $<HTMLInputElement>('input.comet-chat-models-search');
	private readonly list = $('.comet-chat-models-list');

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
	) {
		super();
		this.viewModel = this._register(this.instantiationService.createInstance(ChatModelsViewModel));
		this.searchInput.type = 'search';
		this.searchInput.placeholder = localize('chatModelsSearch', "Search models");
		this.searchInput.setAttribute('aria-label', localize('chatModelsSearchAria', "Search language models"));

		this.element.append(this.searchInput, this.list);
		this._register(addDisposableListener(this.searchInput, EventType.INPUT, () => {
			this.viewModel.filter(this.searchInput.value);
		}));
		this._register(this.viewModel.onDidChange(event => this.render(event.entries)));
		void this.viewModel.refresh();
	}

	private render(entries: readonly IViewModelEntry[]): void {
		this.renderStore.clear();
		this.list.replaceChildren();

		for (const entry of entries) {
			if (isLanguageModelProviderEntry(entry)) {
				append(this.list, this.renderProvider(entry));
			} else if (isLanguageModelGroupEntry(entry)) {
				append(this.list, this.renderGroup(entry));
			} else if (isLanguageModelEntry(entry)) {
				append(this.list, this.renderModel(entry));
			}
		}
	}

	private renderProvider(entry: Extract<IViewModelEntry, { type: 'vendor' }>): HTMLElement {
		const row = $('.comet-chat-models-row.comet-chat-models-provider');
		const button = $('button.comet-chat-models-collapse');
		button.textContent = entry.collapsed ? '>' : 'v';
		this.renderStore.add(addDisposableListener(button, EventType.CLICK, () => this.viewModel.toggleCollapsed(entry)));

		const label = $('.comet-chat-models-label');
		label.textContent = entry.label;
		row.append(button, label);
		return row;
	}

	private renderGroup(entry: Extract<IViewModelEntry, { type: 'group' }>): HTMLElement {
		const row = $('.comet-chat-models-row.comet-chat-models-group');
		row.classList.toggle('comet-chat-models-hidden', entry.hidden);

		const button = $('button.comet-chat-models-collapse');
		button.textContent = entry.collapsed ? '>' : 'v';
		this.renderStore.add(addDisposableListener(button, EventType.CLICK, () => this.viewModel.toggleCollapsed(entry)));

		const label = $('.comet-chat-models-label');
		label.textContent = entry.label;

		const visibility = $('button.comet-chat-models-visibility');
		visibility.textContent = entry.hidden
			? localize('chatModelsShowGroup', "Show")
			: localize('chatModelsHideGroup', "Hide");
		this.renderStore.add(addDisposableListener(visibility, EventType.CLICK, () => this.viewModel.setGroupHidden(entry, !entry.hidden)));

		row.append(button, label, visibility);
		return row;
	}

	private renderModel(entry: Extract<IViewModelEntry, { type: 'model' }>): HTMLElement {
		const row = $('.comet-chat-models-row.comet-chat-models-model');
		row.classList.toggle('comet-chat-models-hidden', entry.model.hidden);

		const label = $('.comet-chat-models-label');
		label.textContent = entry.model.metadata.name;

		const detail = $('.comet-chat-models-detail');
		detail.textContent = entry.model.metadata.id;

		const pin = $('button.comet-chat-models-pin');
		const pinned = this.languageModelsService.isModelPinned(entry.model.identifier);
		pin.textContent = pinned
			? localize('chatModelsUnpinModel', "Unpin")
			: localize('chatModelsPinModel', "Pin");
		this.renderStore.add(addDisposableListener(pin, EventType.CLICK, () => {
			if (pinned) {
				this.languageModelsService.unpinModel(entry.model.identifier);
			} else {
				this.languageModelsService.pinModel(entry.model.identifier);
			}
			this.render(this.viewModel.viewModelEntries);
		}));

		const visibility = $('button.comet-chat-models-visibility');
		visibility.textContent = entry.model.hidden
			? localize('chatModelsShowModel', "Show")
			: localize('chatModelsHideModel', "Hide");
		this.renderStore.add(addDisposableListener(visibility, EventType.CLICK, () => this.viewModel.setModelHidden(entry, !entry.model.hidden)));

		row.append(label, detail, pin, visibility);
		return row;
	}
}
