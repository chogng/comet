/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType } from 'cs/base/browser/dom';
import { StandardKeyboardEvent } from 'cs/base/browser/keyboardEvent';
import { Codicon } from 'cs/base/common/codicons';
import { KeyCode } from 'cs/base/common/keyCodes';
import { Disposable, DisposableStore, MutableDisposable } from 'cs/base/common/lifecycle';
import { ThemeIcon } from 'cs/base/common/themables';
import { localize } from 'cs/nls';
import { IQuickInputService, QuickInputHideReason, type IQuickPick, type IQuickPickItem, type IQuickPickSeparator } from 'cs/platform/quickinput/common/quickInput';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import {
	BrowserEditorContribution,
	BrowserWidgetLocation,
	type IBrowserEditorWidget,
	type IBrowserUrlPickerAction,
	type IBrowserUrlPickerActionProvider,
	type IBrowserUrlRenderer,
	type IBrowserUrlSuggestion,
	type IBrowserUrlSuggestionProvider,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

export type IUrlPickerItem = IQuickPickItem & {
	readonly iconClass?: string;
	readonly iconPath?: IBrowserUrlSuggestion['iconPath'];
	apply?(input: BrowserEditorInput): void | Promise<void>;
};

export interface IBrowserUrlBarHost {
	readonly input: BrowserEditorInput | undefined;
	ensureBrowserFocus(): void;
	getPrimaryActions(text: string): readonly IUrlPickerItem[];
	getPlaceholder(): string;
}

export class BrowserUrlBarWidget extends Disposable {
	readonly element: HTMLElement;
	private readonly urlDisplay: HTMLElement;
	private readonly preUrlWidgetsContainer: HTMLElement;
	private readonly urlBarWidgetsContainer: HTMLElement;
	private readonly urlRenderers: IBrowserUrlRenderer[] = [];
	private readonly suggestionProviders: IBrowserUrlSuggestionProvider[] = [];
	private readonly pickerActionProviders: IBrowserUrlPickerActionProvider[] = [];
	private readonly picker = this._register(new MutableDisposable<IQuickPick<IUrlPickerItem, { useSeparators: true }>>());
	private suppressFocusOpen = false;
	private suppressBlurRevert = false;

	constructor(
		private readonly host: IBrowserUrlBarHost,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super();

		this.element = $('.browser-url-container');
		this.preUrlWidgetsContainer = $('.browser-pre-url-widgets');
		this.urlDisplay = $('div.browser-url-display');
		this.urlDisplay.contentEditable = 'plaintext-only';
		this.urlDisplay.spellcheck = false;
		this.urlDisplay.setAttribute('data-placeholder', this.placeholder);
		this.urlBarWidgetsContainer = $('.browser-url-bar-widgets');

		this.element.append(this.preUrlWidgetsContainer, this.urlDisplay, this.urlBarWidgetsContainer);
		this.registerDisplayListeners();
		this.refreshUrl();
	}

	refreshUrl(): void {
		const isEditing = !!this.picker.value || this.urlDisplay.ownerDocument.activeElement === this.urlDisplay;
		if (!isEditing) {
			this.renderUrl();
		}
		this.urlDisplay.setAttribute('data-placeholder', this.placeholder);
		const picker = this.picker.value;
		if (picker) {
			picker.value = this.canonicalUrl;
		}
	}

	previewUrl(url: string): void {
		const isEditing = !!this.picker.value || this.urlDisplay.ownerDocument.activeElement === this.urlDisplay;
		if (!isEditing) {
			this.renderUrl(url);
		}
	}

	focusUrlInput(): void {
		this.suppressFocusOpen = true;
		this.urlDisplay.focus();
		this.selectAll();
	}

	openUrlPicker(): void {
		this.openPicker();
	}

	clear(): void {
		this.renderUrl();
		this.picker.value?.hide();
	}

	mountContributions(contributions: readonly BrowserEditorContribution[]): void {
		const preUrlWidgets: IBrowserEditorWidget[] = [];
		const postUrlWidgets: IBrowserEditorWidget[] = [];
		this.urlRenderers.length = 0;
		this.suggestionProviders.length = 0;
		this.pickerActionProviders.length = 0;

		for (const contribution of contributions) {
			for (const widget of contribution.widgets) {
				if (widget.location === BrowserWidgetLocation.PreUrl) {
					preUrlWidgets.push(widget);
				} else if (widget.location === BrowserWidgetLocation.PostUrl) {
					postUrlWidgets.push(widget);
				}
			}
			for (const renderer of contribution.urlRenderers) {
				this.urlRenderers.push(renderer);
			}
			this.suggestionProviders.push(...contribution.urlSuggestionProviders);
			this.pickerActionProviders.push(...contribution.urlPickerActionProviders);
		}

		this.preUrlWidgetsContainer.replaceChildren(...preUrlWidgets.sort((left, right) => left.order - right.order).map(widget => widget.element));
		this.urlBarWidgetsContainer.replaceChildren(...postUrlWidgets.sort((left, right) => left.order - right.order).map(widget => widget.element));
		this.suggestionProviders.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
		this.pickerActionProviders.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
		this.renderUrl();
	}

	private get canonicalUrl(): string {
		return this.host.input?.url ?? '';
	}

	private get placeholder(): string {
		return this.host.getPlaceholder();
	}

	private registerDisplayListeners(): void {
		let pendingMouseFocus = false;
		this._register(addDisposableListener(this.urlDisplay, EventType.POINTER_DOWN, () => {
			if (this.urlDisplay.ownerDocument.activeElement !== this.urlDisplay) {
				pendingMouseFocus = true;
			}
		}));
		this._register(addDisposableListener(this.urlDisplay, EventType.FOCUS, (event: FocusEvent) => {
			if (this.suppressFocusOpen) {
				this.suppressFocusOpen = false;
				pendingMouseFocus = false;
				return;
			}
			if (!(event.relatedTarget instanceof Element) || event.relatedTarget.closest('.quick-input-widget')) {
				return;
			}
			if (!pendingMouseFocus) {
				this.openPicker();
			}
		}));
		this._register(addDisposableListener(this.urlDisplay, EventType.BLUR, () => {
			pendingMouseFocus = false;
			this.urlDisplay.scrollLeft = 0;
			const selection = this.urlDisplay.ownerDocument.getSelection();
			if (selection && selection.anchorNode && this.urlDisplay.contains(selection.anchorNode)) {
				selection.removeAllRanges();
			}
			if (this.picker.value) {
				return;
			}
			if (this.suppressBlurRevert) {
				this.suppressBlurRevert = false;
				return;
			}
			if ((this.urlDisplay.textContent ?? '') !== this.canonicalUrl) {
				this.renderUrl();
			}
		}));
		this._register(addDisposableListener(this.urlDisplay, EventType.CLICK, () => {
			const isMouseFocusClick = pendingMouseFocus;
			pendingMouseFocus = false;
			if (!isMouseFocusClick) {
				return;
			}
			const selection = this.urlDisplay.ownerDocument.getSelection();
			if (selection && !selection.isCollapsed && selection.anchorNode && this.urlDisplay.contains(selection.anchorNode)) {
				return;
			}
			this.openPicker(this.urlDisplay.textContent ?? '');
		}));
		this._register(addDisposableListener(this.urlDisplay, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			const standardEvent = new StandardKeyboardEvent(event);
			if (standardEvent.keyCode === KeyCode.Enter) {
				event.preventDefault();
				const value = this.urlDisplay.textContent?.trim() ?? '';
				if (value) {
					this.suppressBlurRevert = true;
					this.navigateText(value);
					this.host.ensureBrowserFocus();
				}
				return;
			}
			if (standardEvent.keyCode === KeyCode.Escape) {
				event.preventDefault();
				this.renderUrl();
				this.host.ensureBrowserFocus();
				return;
			}
			if (standardEvent.keyCode === KeyCode.KeyA && (standardEvent.ctrlKey || standardEvent.metaKey) && !standardEvent.shiftKey && !standardEvent.altKey) {
				event.preventDefault();
				standardEvent.stopPropagation();
				this.selectAll();
			}
		}));
		this._register(addDisposableListener(this.urlDisplay, 'input', () => {
			if (this.picker.value) {
				return;
			}
			this.openPicker(this.urlDisplay.textContent ?? '');
		}));
	}

	private selectAll(): void {
		const selection = this.urlDisplay.ownerDocument.getSelection();
		if (!selection) {
			return;
		}
		const range = this.urlDisplay.ownerDocument.createRange();
		range.selectNodeContents(this.urlDisplay);
		selection.removeAllRanges();
		selection.addRange(range);
	}

	private renderUrl(override?: string): void {
		const url = override ?? this.canonicalUrl;
		this.urlDisplay.textContent = '';
		for (const renderer of this.urlRenderers) {
			if (renderer.render(url, this.urlDisplay)) {
				return;
			}
		}
		if (url) {
			this.urlDisplay.textContent = url;
		}
	}

	private buildSuggestionItems(value: string): (IUrlPickerItem | IQuickPickSeparator)[] {
		const trimmed = value.trim();
		if (!trimmed) {
			return [];
		}
		const primaryItems = this.host.getPrimaryActions(trimmed);
		if (primaryItems.length > 0) {
			return [...primaryItems];
		}
		return [{
			id: trimmed,
			label: localize('browser.goTo', "Go to {0}", trimmed),
			iconClass: ThemeIcon.asClassName(Codicon.arrowRight),
		}];
	}

	private navigateText(text: string): void {
		const input = this.host.input;
		const trimmed = text.trim();
		if (!trimmed || !input) {
			return;
		}
		const primaryItem = this.host.getPrimaryActions(trimmed)[0];
		if (primaryItem?.apply) {
			void Promise.resolve(primaryItem.apply(input));
		} else {
			input.navigate(trimmed);
		}
	}

	private toPickerItem(suggestion: IBrowserUrlSuggestion): IUrlPickerItem {
		const iconProperties = suggestion.iconPath
			? { iconPath: suggestion.iconPath }
			: suggestion.icon
				? { iconClass: ThemeIcon.asClassName(suggestion.icon) }
				: {};
		return {
			id: suggestion.id,
			label: suggestion.label,
			description: suggestion.description,
			buttons: suggestion.actions,
			apply: suggestion.apply,
			...iconProperties,
		};
	}

	private openPicker(initialValue?: string): void {
		if (this.picker.value) {
			return;
		}

		this.urlDisplay.style.visibility = 'hidden';
		const picker = this.quickInputService.createQuickPick<IUrlPickerItem>({ useSeparators: true });
		picker.placeholder = this.placeholder;
		picker.ignoreFocusOut = false;
		picker.value = initialValue ?? this.canonicalUrl;

		const disposables = new DisposableStore();
		const providerSuggestions = new Map<IBrowserUrlSuggestionProvider, readonly IBrowserUrlSuggestion[]>();
		let currentValue = picker.value;

		const render = () => {
			const defaultItems = this.buildSuggestionItems(currentValue);
			const items: (IUrlPickerItem | IQuickPickSeparator)[] = [...defaultItems];
			for (const provider of this.suggestionProviders) {
				const suggestions = providerSuggestions.get(provider);
				if (!suggestions || suggestions.length === 0) {
					continue;
				}
				if (provider.label) {
					items.push({ type: 'separator', label: provider.label });
				}
				for (const suggestion of suggestions) {
					items.push(this.toPickerItem(suggestion));
				}
			}
			picker.items = items;
			const firstItem = items.find((item): item is IUrlPickerItem => item.type !== 'separator');
			picker.activeItems = firstItem ? [firstItem] : [];
		};

		const refreshProvider = (provider: IBrowserUrlSuggestionProvider) => {
			const input = this.host.input;
			if (!input) {
				return;
			}
			void Promise.resolve(provider.getSuggestions(input, currentValue)).then(suggestions => {
				if (this.picker.value !== picker) {
					return;
				}
				providerSuggestions.set(provider, suggestions);
				render();
			});
		};
		const refreshProviders = () => {
			for (const provider of this.suggestionProviders) {
				refreshProvider(provider);
			}
		};
		const refreshButtons = () => {
			const input = this.host.input;
			if (!input) {
				picker.buttons = [];
				return;
			}
			const buttons: IBrowserUrlPickerAction[] = [];
			for (const provider of this.pickerActionProviders) {
				buttons.push(...provider.getActions(input));
			}
			picker.buttons = buttons;
		};

		render();
		refreshProviders();
		refreshButtons();

		for (const provider of this.suggestionProviders) {
			if (provider.onDidChange) {
				disposables.add(provider.onDidChange(() => refreshProvider(provider)));
			}
		}
		for (const provider of this.pickerActionProviders) {
			if (provider.onDidChange) {
				disposables.add(provider.onDidChange(refreshButtons));
			}
		}

		let actionTaken = false;
		disposables.add(picker.onDidChangeValue(value => {
			currentValue = value;
			render();
			refreshProviders();
			this.renderUrl(value);
		}));
		disposables.add(picker.onDidTriggerItemButton(({ button }) => {
			const action = button as IBrowserUrlPickerAction;
			const input = this.host.input;
			if (typeof action.run === 'function' && input) {
				void Promise.resolve(action.run(input));
			}
		}));
		disposables.add(picker.onDidAccept(() => {
			actionTaken = true;
			const activeItem = picker.activeItems[0];
			const value = picker.value;
			const input = this.host.input;
			picker.hide();
			if (activeItem?.apply) {
				if (input) {
					void Promise.resolve(activeItem.apply(input));
				}
				return;
			}
			this.navigateText(activeItem?.id ?? value);
		}));
		disposables.add(picker.onDidHide(({ reason }) => {
			this.urlDisplay.style.visibility = '';
			if (reason === QuickInputHideReason.Blur || actionTaken) {
				this.renderUrl();
				if (actionTaken) {
					this.host.ensureBrowserFocus();
				}
			} else {
				this.urlDisplay.focus();
			}
			disposables.dispose();
			this.picker.clear();
		}));
		disposables.add(picker);

		this.picker.value = picker;
		picker.show();
	}
}
