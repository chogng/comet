/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'cs/base/browser/ui/toggle/toggle.css';
import { $, isActiveElement } from 'cs/base/browser/dom';
import { getBaseLayerHoverDelegate } from 'cs/base/browser/ui/hover/hoverDelegate';
import type { HoverHandle, HoverInput } from 'cs/base/browser/ui/hover/hover';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { Widget } from 'cs/base/browser/ui/widget';
import { Emitter, type Event } from 'cs/base/common/event';
import { KeyCode } from 'cs/base/common/keyCodes';
import { Disposable } from 'cs/base/common/lifecycle';
import type { ThemeIcon } from 'cs/base/common/themables';
import { ThemeIcon as ThemeIconUtils } from 'cs/base/common/themables';

export interface ToggleOptions {
	readonly className?: string;
	readonly icon?: ThemeIcon;
	readonly title: string;
	readonly hover?: HoverInput;
	readonly isChecked: boolean;
	readonly notFocusable?: boolean;
}

export class Toggle extends Widget {
	private readonly onChangeEmitter = this._register(new Emitter<boolean>());
	readonly onChange: Event<boolean> = this.onChangeEmitter.event;

	private readonly hoverController: HoverHandle;
	private icon: ThemeIcon | undefined;
	private checkedValue: boolean;

	readonly domNode: HTMLElement;

	constructor(private readonly options: ToggleOptions) {
		super();

		this.checkedValue = options.isChecked;
		this.icon = options.icon;
		this.domNode = $('div.comet-custom-toggle');
		if (options.className) {
			this.domNode.classList.add(...options.className.split(' '));
		}
		if (this.icon) {
			this.domNode.classList.add(...ThemeIconUtils.asClassNameArray(this.icon));
		}
		if (this.checkedValue) {
			this.domNode.classList.add('checked');
		}
		if (!options.notFocusable) {
			this.domNode.tabIndex = 0;
		}
		this.domNode.setAttribute('role', 'checkbox');
		this.domNode.setAttribute('aria-checked', String(this.checkedValue));

		this.hoverController = getBaseLayerHoverDelegate().createHover(
			this.domNode,
			options.hover ?? options.title,
		);
		this._register(this.hoverController);
		this.setTitle(options.title, options.hover);
		this.onclick(this.domNode, event => {
			if (!this.enabled) {
				return;
			}

			this.checked = !this.checkedValue;
			this.onChangeEmitter.fire(false);
			event.preventDefault();
			event.stopPropagation();
		});
		this._register(this.ignoreGesture(this.domNode));
		this.onkeydown(this.domNode, event => {
			if (!this.enabled) {
				return;
			}

			if (event.keyCode === KeyCode.Space || event.keyCode === KeyCode.Enter) {
				this.checked = !this.checkedValue;
				this.onChangeEmitter.fire(true);
				event.preventDefault();
				event.stopPropagation();
			}
		});
	}

	get enabled() {
		return this.domNode.getAttribute('aria-disabled') !== 'true';
	}

	get checked() {
		return this.checkedValue;
	}

	set checked(newChecked: boolean) {
		this.checkedValue = newChecked;
		this.domNode.setAttribute('aria-checked', String(newChecked));
		this.domNode.classList.toggle('checked', newChecked);
	}

	focus() {
		this.domNode.focus();
	}

	hasFocus() {
		return isActiveElement(this.domNode);
	}

	enable() {
		this.domNode.setAttribute('aria-disabled', 'false');
		this.domNode.classList.remove('disabled');
		if (!this.options.notFocusable) {
			this.domNode.tabIndex = 0;
		}
	}

	disable() {
		this.domNode.setAttribute('aria-disabled', 'true');
		this.domNode.classList.add('disabled');
		if (!this.options.notFocusable) {
			this.domNode.tabIndex = -1;
		}
	}

	setIcon(icon: ThemeIcon | undefined) {
		if (this.icon) {
			this.domNode.classList.remove(...ThemeIconUtils.asClassNameArray(this.icon));
		}
		this.icon = icon;
		if (this.icon) {
			this.domNode.classList.add(...ThemeIconUtils.asClassNameArray(this.icon));
		}
	}

	setTitle(title: string, hover?: HoverInput) {
		this.hoverController.update(hover ?? title);
		this.domNode.setAttribute('aria-label', title);
		this.domNode.removeAttribute('title');
	}
}

export class Checkbox extends Disposable {
	static readonly className = 'comet-checkbox';

	private readonly toggle: Toggle;

	readonly domNode: HTMLElement;
	readonly onChange: Event<boolean>;

	constructor(title: string, isChecked: boolean) {
		super();

		this.toggle = this._register(new Toggle({
			title,
			isChecked,
			className: Checkbox.className,
		}));
		this.domNode = this.toggle.domNode;
		this.domNode.append(createLxIcon('check', 'comet-checkbox-check'));
		this.onChange = this.toggle.onChange;
	}

	get enabled() {
		return this.toggle.enabled;
	}

	get checked() {
		return this.toggle.checked;
	}

	set checked(newChecked: boolean) {
		this.toggle.checked = newChecked;
	}

	focus() {
		this.toggle.focus();
	}

	hasFocus() {
		return this.toggle.hasFocus();
	}

	enable() {
		this.toggle.enable();
	}

	disable() {
		this.toggle.disable();
	}

	setTitle(title: string) {
		this.toggle.setTitle(title);
	}
}
