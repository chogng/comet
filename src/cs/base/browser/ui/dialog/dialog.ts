/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'cs/base/browser/ui/dialog/dialog.css';
import { $ } from 'cs/base/browser/dom';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import {
	Disposable,
	DisposableStore,
	toDisposable,
	type IDisposable,
} from 'cs/base/common/lifecycle';

export type DialogType = 'none' | 'info' | 'warning' | 'error' | 'question';

export interface IDialogButton {
	readonly label: string;
	readonly primary?: boolean;
}

export interface IDialogInputOptions {
	readonly placeholder?: string;
	readonly type?: 'text' | 'password';
	readonly value?: string;
}

export interface IDialogOptions {
	readonly title?: string;
	readonly message: string;
	readonly detail?: string;
	readonly type?: DialogType;
	readonly buttons?: readonly IDialogButton[];
	readonly cancelId?: number;
	readonly checkboxLabel?: string;
	readonly checkboxChecked?: boolean;
	readonly inputs?: readonly IDialogInputOptions[];
	readonly closeLabel?: string;
	readonly renderBody?: (container: HTMLElement, controls: IDialogBodyControls) => IDisposable | void;
}

export interface IDialogResult {
	readonly button: number;
	readonly checkboxChecked?: boolean;
	readonly values?: string[];
}

export interface IDialogBodyControls {
	close(button?: number): void;
}

function addDisposableListener<K extends keyof HTMLElementEventMap>(
	target: HTMLElement,
	type: K,
	listener: (event: HTMLElementEventMap[K]) => void,
	options?: boolean | AddEventListenerOptions,
) {
	target.addEventListener(type, listener, options);
	return toDisposable(() => {
		target.removeEventListener(type, listener, options);
	});
}

function addWindowListener<K extends keyof WindowEventMap>(
	target: Window,
	type: K,
	listener: (event: WindowEventMap[K]) => void,
	options?: boolean | AddEventListenerOptions,
) {
	target.addEventListener(type, listener, options);
	return toDisposable(() => {
		target.removeEventListener(type, listener, options);
	});
}

function createCloseIcon() {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.setAttribute('aria-hidden', 'true');

	const first = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	first.setAttribute('d', 'M4 4L12 12');
	first.setAttribute('fill', 'none');
	first.setAttribute('stroke', 'currentColor');
	first.setAttribute('stroke-width', '1.8');
	first.setAttribute('stroke-linecap', 'round');

	const second = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	second.setAttribute('d', 'M12 4L4 12');
	second.setAttribute('fill', 'none');
	second.setAttribute('stroke', 'currentColor');
	second.setAttribute('stroke-width', '1.8');
	second.setAttribute('stroke-linecap', 'round');

	svg.append(first, second);
	return svg;
}

let bodyScrollLockCount = 0;
let initialBodyOverflow = '';

function lockBodyScroll() {
	if (bodyScrollLockCount === 0) {
		initialBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
	}

	bodyScrollLockCount += 1;
}

function unlockBodyScroll() {
	if (bodyScrollLockCount === 0) {
		return;
	}

	bodyScrollLockCount -= 1;
	if (bodyScrollLockCount === 0) {
		document.body.style.overflow = initialBodyOverflow;
	}
}

export class Dialog extends Disposable {
	private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-dialog-modal-block');
	private readonly panelElement = $<HTMLElementTagNameMap['section']>('section.comet-dialog-box');
	private readonly toolbarElement = $<HTMLElementTagNameMap['div']>('div.comet-dialog-toolbar');
	private readonly titleElement = $<HTMLElementTagNameMap['h2']>('h2.comet-dialog-title');
	private readonly closeButton = $<HTMLElementTagNameMap['button']>('button.comet-dialog-close') as HTMLButtonElement;
	private readonly messageRowElement = $<HTMLElementTagNameMap['div']>('div.comet-dialog-message-row');
	private readonly typeElement = $<HTMLElementTagNameMap['div']>('div.comet-dialog-type');
	private readonly messageContainerElement = $<HTMLElementTagNameMap['div']>('div.comet-dialog-message-container');
	private readonly messageElement = $<HTMLElementTagNameMap['div']>('div.comet-dialog-message');
	private readonly detailElement = $<HTMLElementTagNameMap['div']>('div.comet-dialog-detail');
	private readonly inputsElement = $<HTMLElementTagNameMap['div']>('div.comet-dialog-inputs');
	private readonly customBodyElement = $<HTMLElementTagNameMap['div']>('div.comet-dialog-custom-body');
	private readonly checkboxRowElement = $<HTMLElementTagNameMap['label']>('label.comet-dialog-checkbox-row');
	private readonly checkboxElement = $<HTMLElementTagNameMap['input']>('input.comet-dialog-checkbox') as HTMLInputElement;
	private readonly checkboxLabelElement = $<HTMLElementTagNameMap['span']>('span.comet-dialog-checkbox-label');
	private readonly buttonsElement = $<HTMLElementTagNameMap['div']>('div.comet-dialog-buttons');
	private readonly openedDisposables = this._register(new DisposableStore());
	private readonly inputBoxes = this._register(new DisposableStore());
	private readonly customBodyDisposables = this._register(new DisposableStore());
	private readonly titleId = `comet-dialog-title-${Math.random().toString(36).slice(2, 10)}`;
	private readonly messageId = `comet-dialog-message-${Math.random().toString(36).slice(2, 10)}`;
	private resolve: ((result: IDialogResult) => void) | undefined;
	private inputViews: InputBox[] = [];
	private isOpen = false;
	private disposed = false;

	constructor(private readonly options: IDialogOptions) {
		super();

		this.closeButton.type = 'button';
		this.closeButton.append(createCloseIcon());
		this.closeButton.setAttribute('aria-label', options.closeLabel ?? 'Close');
		this.checkboxElement.type = 'checkbox';

		this.checkboxRowElement.append(this.checkboxElement, this.checkboxLabelElement);
		this.messageContainerElement.append(
			this.messageElement,
			this.detailElement,
			this.inputsElement,
			this.customBodyElement,
			this.checkboxRowElement,
		);
		this.messageRowElement.append(this.typeElement, this.messageContainerElement);
		this.toolbarElement.append(this.titleElement, this.closeButton);
		this.panelElement.append(this.toolbarElement, this.messageRowElement, this.buttonsElement);
		this.element.append(this.panelElement);

		this._register(addDisposableListener(this.element, 'click', this.handleModalClick));
		this._register(addDisposableListener(this.closeButton, 'click', this.handleCloseClick));
		this.render();
	}

	show() {
		if (this.isOpen) {
			throw new Error('Dialog is already open.');
		}

		lockBodyScroll();
		document.body.append(this.element);
		this.openedDisposables.add(addWindowListener(window, 'keydown', this.handleKeyDown));
		this.isOpen = true;

		queueMicrotask(() => {
			const focusTarget = this.inputViews[0]?.inputElement ?? this.buttonsElement.querySelector<HTMLButtonElement>('button');
			focusTarget?.focus();
		});

		return new Promise<IDialogResult>(resolve => {
			this.resolve = resolve;
		});
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.close(this.resolveCancelResult());
		super.dispose();
		this.element.replaceChildren();
	}

	private readonly handleModalClick = (event: MouseEvent) => {
		if (event.target === this.element) {
			this.panelElement.focus();
		}
	};

	private readonly handleCloseClick = () => {
		this.close(this.resolveCancelResult());
	};

	private readonly handleKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			this.close(this.resolveCancelResult());
			return;
		}

		if (event.key === 'Enter' && this.inputViews.length > 0) {
			event.preventDefault();
			this.close(this.resolveButtonResult(0));
		}
	};

	private close(result: IDialogResult) {
		if (!this.isOpen) {
			return;
		}

		this.isOpen = false;
		this.element.remove();
		this.openedDisposables.clear();
		unlockBodyScroll();

		const resolve = this.resolve;
		this.resolve = undefined;
		resolve?.(result);
	}

	private render() {
		const type = this.options.type ?? 'none';
		this.element.classList.toggle('is-dimmed', true);
		this.panelElement.tabIndex = -1;
		this.panelElement.setAttribute('role', 'dialog');
		this.panelElement.setAttribute('aria-modal', 'true');
		this.panelElement.setAttribute('aria-describedby', this.messageId);
		this.typeElement.className = `comet-dialog-type comet-dialog-type-${type}`;
		this.typeElement.setAttribute('aria-hidden', 'true');

		this.messageElement.id = this.messageId;
		this.messageElement.textContent = this.options.message;

		if (this.options.title) {
			this.titleElement.hidden = false;
			this.titleElement.id = this.titleId;
			this.titleElement.textContent = this.options.title;
			this.panelElement.setAttribute('aria-labelledby', this.titleId);
		} else {
			this.titleElement.hidden = true;
			this.titleElement.removeAttribute('id');
			this.titleElement.textContent = '';
			this.panelElement.removeAttribute('aria-labelledby');
		}

		if (this.options.detail) {
			this.detailElement.textContent = this.options.detail;
			this.detailElement.hidden = false;
		} else {
			this.detailElement.textContent = '';
			this.detailElement.hidden = true;
		}

		this.renderInputs();
		this.renderCustomBody();
		this.renderCheckbox();
		this.renderButtons();
	}

	private renderInputs() {
		this.inputBoxes.clear();
		this.inputViews = [];
		this.inputsElement.replaceChildren();

		for (const input of this.options.inputs ?? []) {
			const row = $<HTMLElementTagNameMap['div']>('div.comet-dialog-input-row');
			const inputBox = this.inputBoxes.add(new InputBox(row, undefined, {
				placeholder: input.placeholder,
				type: input.type ?? 'text',
				value: input.value ?? '',
			}));

			this.inputViews.push(inputBox);
			this.inputsElement.append(row);
		}

		this.inputsElement.hidden = this.inputViews.length === 0;
	}

	private renderCustomBody() {
		this.customBodyDisposables.clear();
		this.customBodyElement.replaceChildren();

		if (!this.options.renderBody) {
			this.customBodyElement.hidden = true;
			return;
		}

		this.customBodyElement.hidden = false;
		const disposable = this.options.renderBody(this.customBodyElement, {
			close: (button = this.resolveCancelResult().button) => this.close(this.resolveButtonResult(button)),
		});
		if (disposable) {
			this.customBodyDisposables.add(disposable);
		}
	}

	private renderCheckbox() {
		if (!this.options.checkboxLabel) {
			this.checkboxRowElement.hidden = true;
			this.checkboxLabelElement.textContent = '';
			this.checkboxElement.checked = false;
			return;
		}

		this.checkboxRowElement.hidden = false;
		this.checkboxElement.checked = Boolean(this.options.checkboxChecked);
		this.checkboxLabelElement.textContent = this.options.checkboxLabel;
	}

	private renderButtons() {
		this.buttonsElement.replaceChildren();
		const buttons = this.resolveButtons();

		buttons.forEach((button, index) => {
			const buttonView = this._register(new ButtonView({
				content: button.label,
				variant: button.primary ? 'primary' : 'secondary',
				onClick: () => this.close(this.resolveButtonResult(index)),
			}));
			this.buttonsElement.append(buttonView.getElement());
		});
	}

	private resolveButtons() {
		const buttons = this.options.buttons;
		if (buttons && buttons.length > 0) {
			return buttons;
		}

		return [{ label: 'OK', primary: true }];
	}

	private resolveCancelResult() {
		const buttons = this.resolveButtons();
		const button = typeof this.options.cancelId === 'number'
			? this.options.cancelId
			: Math.max(0, buttons.length - 1);

		return {
			button,
			checkboxChecked: this.options.checkboxLabel ? this.checkboxElement.checked : undefined,
			values: this.inputViews.length > 0 ? this.inputViews.map(input => input.value) : undefined,
		};
	}

	private resolveButtonResult(button: number) {
		return {
			button,
			checkboxChecked: this.options.checkboxLabel ? this.checkboxElement.checked : undefined,
			values: this.inputViews.length > 0 ? this.inputViews.map(input => input.value) : undefined,
		};
	}
}

export function showDialog(options: IDialogOptions): Promise<IDialogResult> & IDisposable {
	const dialog = new Dialog(options);
	const result = dialog.show() as Promise<IDialogResult> & IDisposable;
	result.dispose = () => dialog.dispose();
	void result.finally(() => dialog.dispose());
	return result;
}
