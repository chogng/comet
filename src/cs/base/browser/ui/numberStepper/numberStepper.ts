/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'cs/base/browser/ui/numberStepper/numberStepper.css';
import { $ } from 'cs/base/browser/dom';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { Disposable } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';

export interface INumberStepperOptions {
	readonly value: string | number;
	readonly className?: string;
	readonly inputClassName?: string;
	readonly min?: string;
	readonly max?: string;
	readonly step?: string;
	readonly inputMode?: HTMLInputElement['inputMode'];
	readonly disabled?: boolean;
	readonly readOnly?: boolean;
	readonly decrementAriaLabel: string;
	readonly incrementAriaLabel: string;
	readonly onDidChange?: (value: string) => void;
}

export const numberStepperDecrementAriaLabel = localize('numberStepper.decrement', "Decrease value");
export const numberStepperIncrementAriaLabel = localize('numberStepper.increment', "Increase value");

export class NumberStepper extends Disposable {
	readonly element: HTMLElement;
	readonly inputBox: InputBox;
	private readonly decrementButton: ButtonView;
	private readonly incrementButton: ButtonView;
	private readonly options: INumberStepperOptions;

	constructor(options: INumberStepperOptions) {
		super();
		this.options = options;
		this.element = $<HTMLElement>('div', {
			class: ['comet-number-stepper', options.className ?? ''].filter(Boolean).join(' '),
		});

		this.decrementButton = this._register(new ButtonView(this.createButtonProps('down')));
		this.element.append(this.decrementButton.getElement());

		const inputHost = $<HTMLElement>('div.comet-number-stepper-input-host');
		this.element.append(inputHost);
		this.inputBox = this._register(new InputBox(inputHost, undefined, {
			className: ['comet-number-stepper-inputbox', options.inputClassName ?? ''].filter(Boolean).join(' '),
			type: 'number',
			value: String(options.value),
			inputAttributes: {
				readOnly: options.readOnly,
				disabled: options.disabled,
				min: options.min,
				max: options.max,
				step: options.step,
				inputMode: options.inputMode,
			},
		}));

		this.incrementButton = this._register(new ButtonView(this.createButtonProps('up')));
		this.element.append(this.incrementButton.getElement());

		if (options.onDidChange) {
			this._register(this.inputBox.onDidChange(options.onDidChange));
		}

		this.syncButtonsDisabled();
	}

	get inputElement() {
		return this.inputBox.inputElement;
	}

	setDisabled(disabled: boolean) {
		this.inputElement.disabled = disabled;
		this.syncButtonsDisabled();
	}

	override dispose() {
		super.dispose();
		this.element.remove();
	}

	private createButtonProps(direction: 'up' | 'down', disabled = false) {
		return {
			className: [
				'comet-number-stepper-button',
				direction === 'down' ? 'comet-number-stepper-button-decrement' : 'comet-number-stepper-button-increment',
			].join(' '),
			variant: 'ghost' as const,
			size: 'icon' as const,
			mode: 'icon' as const,
			children: createLxIcon(direction === 'down' ? 'remove-1' : 'add-1', 'comet-number-stepper-button-icon'),
			disabled,
			ariaLabel: direction === 'down'
				? this.options.decrementAriaLabel
				: this.options.incrementAriaLabel,
			onClick: () => this.nudgeValue(direction),
		};
	}

	private syncButtonsDisabled() {
		const disabled = this.inputElement.disabled || this.inputElement.readOnly;
		this.decrementButton.setProps(this.createButtonProps('down', disabled));
		this.incrementButton.setProps(this.createButtonProps('up', disabled));
	}

	private nudgeValue(direction: 'up' | 'down') {
		if (this.inputElement.disabled || this.inputElement.readOnly) {
			return;
		}

		const previous = this.inputElement.value;
		if (direction === 'up') {
			this.inputElement.stepUp();
		} else {
			this.inputElement.stepDown();
		}

		if (this.inputElement.value !== previous) {
			this.inputElement.dispatchEvent(new Event('input', { bubbles: true }));
		}
		this.inputElement.focus();
	}
}
