/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/quickInput.css';

import { CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import type {
	IInputBox,
	IInputOptions,
	IKeyMods,
	IPickOptions,
	IQuickInput,
	IQuickInputButton,
	IQuickInputHideEvent,
	IQuickNavigateConfiguration,
	IQuickPick,
	IQuickPickDidAcceptEvent,
	IQuickPickItem,
	IQuickPickSeparator,
	IQuickTree,
	IQuickTreeItem,
	IQuickWidget,
	QuickInputAlignment,
	QuickPickInput,
} from 'cs/platform/quickinput/common/quickInput';
import { NO_KEY_MODS, QuickInputHideReason, QuickPickFocus } from 'cs/platform/quickinput/common/quickInput';

function createElement<K extends keyof HTMLElementTagNameMap>(
	tagName: K,
	className?: string,
	textContent?: string,
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tagName);
	if (className) {
		element.className = className;
	}
	if (textContent !== undefined) {
		element.textContent = textContent;
	}
	return element;
}

function isSeparator<T extends IQuickPickItem>(
	item: QuickPickInput<T>,
): item is IQuickPickSeparator {
	return item.type === 'separator';
}

function itemMatches<T extends IQuickPickItem>(
	item: T,
	query: string,
	matchOnDescription: boolean,
	matchOnDetail: boolean,
) {
	const normalized = query.trim().toLowerCase();
	if (!normalized || item.alwaysShow) {
		return true;
	}

	const haystack = [
		item.label,
		matchOnDescription ? item.description : undefined,
		matchOnDetail ? item.detail : undefined,
	]
		.filter((value): value is string => Boolean(value))
		.join(' ')
		.toLowerCase();
	return haystack.includes(normalized);
}

abstract class QuickInputBase extends Disposable implements IQuickInput {
	enabled = true;
	busy = false;
	ignoreFocusOut = false;
	title: string | undefined;
	step: number | undefined;
	totalSteps: number | undefined;
	buttons: readonly IQuickInputButton[] = [];

	private readonly onDidHideEmitter = this._register(new Emitter<IQuickInputHideEvent>());
	readonly onDidHide: Event<IQuickInputHideEvent> = this.onDidHideEmitter.event;

	constructor(protected readonly controller: QuickInputController) {
		super();
	}

	abstract show(): void;

	hide(): void {
		this.controller.hide(this, QuickInputHideReason.Other);
	}

	fireHide(reason?: QuickInputHideReason): void {
		this.onDidHideEmitter.fire({ reason });
	}
}

export class QuickPick<T extends IQuickPickItem> extends QuickInputBase implements IQuickPick<T> {
	value = '';
	placeholder: string | undefined;
	items: readonly QuickPickInput<T>[] = [];
	activeItems: readonly T[] = [];
	selectedItems: readonly T[] = [];
	canSelectMany = false;
	matchOnDescription = false;
	matchOnDetail = false;

	private readonly onDidChangeValueEmitter = this._register(new Emitter<string>());
	readonly onDidChangeValue = this.onDidChangeValueEmitter.event;

	private readonly onDidAcceptEmitter = this._register(new Emitter<IQuickPickDidAcceptEvent>());
	readonly onDidAccept = this.onDidAcceptEmitter.event;

	private readonly onDidChangeActiveEmitter = this._register(new Emitter<readonly T[]>());
	readonly onDidChangeActive = this.onDidChangeActiveEmitter.event;

	private readonly onDidChangeSelectionEmitter = this._register(new Emitter<readonly T[]>());
	readonly onDidChangeSelection = this.onDidChangeSelectionEmitter.event;

	private readonly onDidTriggerItemButtonEmitter = this._register(new Emitter<never>());
	readonly onDidTriggerItemButton = this.onDidTriggerItemButtonEmitter.event;

	show(): void {
		this.controller.showQuickPick(this);
	}

	accept(): void {
		this.onDidAcceptEmitter.fire({ inBackground: false });
	}

	setValue(value: string): void {
		if (this.value === value) {
			return;
		}

		this.value = value;
		this.onDidChangeValueEmitter.fire(value);
	}

	setActiveItems(items: readonly T[]): void {
		this.activeItems = items;
		this.onDidChangeActiveEmitter.fire(items);
	}

	setSelectedItems(items: readonly T[]): void {
		this.selectedItems = items;
		this.onDidChangeSelectionEmitter.fire(items);
	}
}

export class InputBox extends QuickInputBase implements IInputBox {
	value = '';
	placeholder: string | undefined;
	password = false;
	prompt: string | undefined;

	private readonly onDidChangeValueEmitter = this._register(new Emitter<string>());
	readonly onDidChangeValue = this.onDidChangeValueEmitter.event;

	private readonly onDidAcceptEmitter = this._register(new Emitter<void>());
	readonly onDidAccept = this.onDidAcceptEmitter.event;

	show(): void {
		this.controller.showInputBox(this);
	}

	accept(): void {
		this.onDidAcceptEmitter.fire();
	}

	setValue(value: string): void {
		if (this.value === value) {
			return;
		}

		this.value = value;
		this.onDidChangeValueEmitter.fire(value);
	}
}

class QuickTree<T extends IQuickTreeItem> extends QuickInputBase implements IQuickTree<T> {
	items: readonly T[] = [];
	activeItems: readonly T[] = [];

	private readonly onDidAcceptEmitter = this._register(new Emitter<void>());
	readonly onDidAccept = this.onDidAcceptEmitter.event;

	show(): void {
		const pick = this.controller.createQuickPick<T>();
		pick.title = this.title;
		pick.placeholder = undefined;
		pick.items = this.flatten(this.items);
		pick.show();
	}

	accept(): void {
		this.onDidAcceptEmitter.fire();
	}

	private flatten(items: readonly T[]): T[] {
		const result: T[] = [];
		for (const item of items) {
			result.push(item);
			if (item.children && !item.collapsed) {
				result.push(...this.flatten(item.children as readonly T[]));
			}
		}
		return result;
	}
}

class QuickWidget extends QuickInputBase implements IQuickWidget {
	show(): void {
		this.controller.showWidget(this);
	}
}

export class QuickInputController extends Disposable {
	private overlay: HTMLElement | undefined;
	private widget: HTMLElement | undefined;
	private input: HTMLInputElement | undefined;
	private current: IQuickInput | undefined;
	private currentDisposables = this._register(new DisposableStore());
	private alignmentValue: QuickInputAlignment = 'top';

	private readonly onShowEmitter = this._register(new Emitter<void>());
	readonly onShow = this.onShowEmitter.event;

	private readonly onHideEmitter = this._register(new Emitter<void>());
	readonly onHide = this.onHideEmitter.event;

	get currentQuickInput(): IQuickInput | undefined {
		return this.current;
	}

	createQuickPick<T extends IQuickPickItem>(): QuickPick<T> {
		return new QuickPick<T>(this);
	}

	createInputBox(): InputBox {
		return new InputBox(this);
	}

	createQuickTree<T extends IQuickTreeItem>(): IQuickTree<T> {
		return new QuickTree<T>(this);
	}

	createQuickWidget(): IQuickWidget {
		return new QuickWidget(this);
	}

	async pick<T extends IQuickPickItem, O extends IPickOptions<T>>(
		picks: Promise<QuickPickInput<T>[]> | QuickPickInput<T>[],
		options?: O,
		token: CancellationToken = CancellationTokenNone,
	): Promise<(O extends { canPickMany: true } ? T[] : T) | undefined> {
		const resolvedPicks = await picks;
		if (token.isCancellationRequested) {
			return undefined;
		}

		return new Promise(resolve => {
			const quickPick = this.currentDisposables.add(this.createQuickPick<T>());
			quickPick.items = resolvedPicks;
			quickPick.title = options?.title;
			quickPick.placeholder = options?.placeHolder;
			quickPick.canSelectMany = Boolean(options?.canPickMany);
			quickPick.ignoreFocusOut = Boolean(options?.ignoreFocusOut);
			quickPick.matchOnDescription = Boolean(options?.matchOnDescription);
			quickPick.matchOnDetail = Boolean(options?.matchOnDetail);
			if (options?.activeItem) {
				quickPick.setActiveItems([options.activeItem]);
			}

			this.currentDisposables.add(token.onCancellationRequested(() => {
				quickPick.hide();
				resolve(undefined);
			}));
			this.currentDisposables.add(quickPick.onDidAccept(() => {
				const selectedItems = quickPick.canSelectMany ? quickPick.selectedItems : quickPick.activeItems;
				resolve((quickPick.canSelectMany ? [...selectedItems] : selectedItems[0]) as O extends { canPickMany: true } ? T[] : T);
				quickPick.hide();
			}));
			this.currentDisposables.add(quickPick.onDidHide(() => resolve(undefined)));
			quickPick.show();
		});
	}

	inputBox(options: IInputOptions = {}, token: CancellationToken = CancellationTokenNone): Promise<string | undefined> {
		return new Promise(resolve => {
			const inputBox = this.currentDisposables.add(this.createInputBox());
			inputBox.title = options.title;
			inputBox.value = options.value ?? '';
			inputBox.placeholder = options.placeHolder;
			inputBox.prompt = options.prompt;
			inputBox.password = Boolean(options.password);
			inputBox.ignoreFocusOut = Boolean(options.ignoreFocusOut);

			this.currentDisposables.add(token.onCancellationRequested(() => {
				inputBox.hide();
				resolve(undefined);
			}));
			this.currentDisposables.add(inputBox.onDidAccept(() => {
				const value = inputBox.value;
				resolve(value);
				inputBox.hide();
			}));
			this.currentDisposables.add(inputBox.onDidHide(() => resolve(undefined)));
			inputBox.show();
		});
	}

	showQuickPick<T extends IQuickPickItem>(quickPick: QuickPick<T>): void {
		this.beginShow(quickPick);
		const elements = this.createShell(quickPick.title);
		const input = this.createInput(quickPick.placeholder, quickPick.value, 'text');
		const list = createElement('div', 'quick-input-list');
		elements.header.append(input);
		elements.widget.append(list);
		this.input = input;

		const render = () => this.renderQuickPickItems(quickPick, list);
		this.currentDisposables.add(toDisposable(() => input.removeEventListener('input', handleInput)));
		this.currentDisposables.add(toDisposable(() => input.removeEventListener('keydown', handleKeyDown)));

		const handleInput = () => {
			quickPick.setValue(input.value);
			render();
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				quickPick.hide();
				return;
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				this.focusQuickPick(quickPick, QuickPickFocus.Next);
				render();
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				this.focusQuickPick(quickPick, QuickPickFocus.Previous);
				render();
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				quickPick.accept();
			}
		};

		input.addEventListener('input', handleInput);
		input.addEventListener('keydown', handleKeyDown);
		render();
		this.focus();
	}

	showInputBox(inputBox: InputBox): void {
		this.beginShow(inputBox);
		const elements = this.createShell(inputBox.title);
		const input = this.createInput(inputBox.placeholder, inputBox.value, inputBox.password ? 'password' : 'text');
		elements.header.append(input);
		if (inputBox.prompt) {
			elements.header.append(createElement('div', 'quick-input-prompt', inputBox.prompt));
		}
		this.input = input;

		const handleInput = () => inputBox.setValue(input.value);
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				inputBox.hide();
				return;
			}
			if (event.key === 'Enter') {
				event.preventDefault();
				inputBox.accept();
			}
		};
		this.currentDisposables.add(toDisposable(() => input.removeEventListener('input', handleInput)));
		this.currentDisposables.add(toDisposable(() => input.removeEventListener('keydown', handleKeyDown)));
		input.addEventListener('input', handleInput);
		input.addEventListener('keydown', handleKeyDown);
		this.focus();
	}

	showWidget(widget: IQuickWidget): void {
		this.beginShow(widget);
		this.createShell(widget.title);
	}

	hide(input: IQuickInput | undefined = this.current, reason?: QuickInputHideReason): void {
		if (!input || input !== this.current) {
			return;
		}

		this.current = undefined;
		if (input instanceof QuickInputBase) {
			input.fireHide(reason);
		}
		this.currentDisposables.clear();
		this.overlay?.remove();
		this.overlay = undefined;
		this.widget = undefined;
		this.input = undefined;
		this.onHideEmitter.fire();
	}

	focus(): void {
		this.input?.focus();
	}

	toggle(): void {
		if (this.current) {
			this.hide(this.current, QuickInputHideReason.Other);
		}
	}

	navigate(next: boolean, _quickNavigate?: IQuickNavigateConfiguration): void {
		const quickPick = this.current instanceof QuickPick ? this.current : undefined;
		if (!quickPick) {
			return;
		}

		this.focusQuickPick(quickPick, next ? QuickPickFocus.Next : QuickPickFocus.Previous);
		if (this.widget) {
			const list = this.widget.querySelector<HTMLElement>('.quick-input-list');
			if (list) {
				this.renderQuickPickItems(quickPick, list);
			}
		}
	}

	accept(_keyMods: IKeyMods = NO_KEY_MODS): void {
		if (this.current instanceof QuickPick || this.current instanceof InputBox) {
			this.current.accept();
		}
	}

	back(): void {
		this.current?.hide();
	}

	cancel(reason?: QuickInputHideReason): Promise<void> {
		this.hide(this.current, reason);
		return Promise.resolve();
	}

	setAlignment(alignment: QuickInputAlignment): void {
		this.alignmentValue = alignment;
		this.widget?.classList.toggle('center', alignment === 'center');
	}

	toggleHover(): void {
	}

	private beginShow(input: IQuickInput): void {
		this.hide(this.current, QuickInputHideReason.Other);
		this.current = input;
		this.onShowEmitter.fire();
	}

	private createShell(title: string | undefined) {
		const overlay = createElement('div', 'quick-input-overlay');
		const widget = createElement('div', `quick-input-widget${this.alignmentValue === 'center' ? ' center' : ''}`);
		if (title) {
			widget.append(createElement('div', 'quick-input-title', title));
		}
		const header = createElement('div', 'quick-input-header');
		widget.append(header);
		overlay.append(widget);
		document.body.append(overlay);
		this.overlay = overlay;
		this.widget = widget;
		return { overlay, widget, header };
	}

	private createInput(placeholder: string | undefined, value: string, type: 'text' | 'password') {
		const input = createElement('input', 'quick-input-box');
		input.type = type;
		input.value = value;
		if (placeholder) {
			input.placeholder = placeholder;
			input.setAttribute('aria-label', placeholder);
		}
		return input;
	}

	private renderQuickPickItems<T extends IQuickPickItem>(quickPick: QuickPick<T>, list: HTMLElement): void {
		list.replaceChildren();
		const visibleItems = quickPick.items.filter(item =>
			isSeparator(item) || itemMatches(item, quickPick.value, quickPick.matchOnDescription, quickPick.matchOnDetail),
		);
		const pickableItems = visibleItems.filter((item): item is T => !isSeparator(item));
		const currentActive = quickPick.activeItems[0];
		if (!currentActive || !pickableItems.includes(currentActive)) {
			quickPick.setActiveItems(pickableItems.length > 0 ? [pickableItems[0]] : []);
		}

		if (pickableItems.length === 0) {
			list.append(createElement('div', 'quick-input-empty', 'No matching results'));
			return;
		}

		for (const item of visibleItems) {
			if (isSeparator(item)) {
				list.append(createElement('div', 'quick-input-separator', item.label ?? ''));
				continue;
			}

			const row = createElement('div', 'quick-input-item');
			row.classList.toggle('active', quickPick.activeItems.includes(item));
			row.classList.toggle('selected', quickPick.selectedItems.includes(item));
			row.tabIndex = -1;
			row.append(createElement('div', 'quick-input-label', item.label));
			if (item.description) {
				row.append(createElement('div', 'quick-input-description', item.description));
			}
			if (item.detail) {
				row.append(createElement('div', 'quick-input-detail', item.detail));
			}
			row.addEventListener('mousemove', () => quickPick.setActiveItems([item]));
			row.addEventListener('click', () => {
				quickPick.setActiveItems([item]);
				if (quickPick.canSelectMany) {
					const nextSelection = quickPick.selectedItems.includes(item)
						? quickPick.selectedItems.filter(selected => selected !== item)
						: [...quickPick.selectedItems, item];
					quickPick.setSelectedItems(nextSelection);
					this.renderQuickPickItems(quickPick, list);
					return;
				}
				quickPick.accept();
			});
			list.append(row);
		}
	}

	private focusQuickPick<T extends IQuickPickItem>(quickPick: QuickPick<T>, focus: QuickPickFocus): void {
		const items = quickPick.items
			.filter((item): item is T => !isSeparator(item))
			.filter(item => itemMatches(item, quickPick.value, quickPick.matchOnDescription, quickPick.matchOnDetail));
		if (items.length === 0) {
			quickPick.setActiveItems([]);
			return;
		}

		const currentIndex = Math.max(0, items.indexOf(quickPick.activeItems[0]));
		const nextIndex = focus === QuickPickFocus.Previous
			? Math.max(0, currentIndex - 1)
			: Math.min(items.length - 1, currentIndex + 1);
		quickPick.setActiveItems([items[nextIndex]]);
	}
}
