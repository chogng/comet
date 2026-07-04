/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	createHoverController,
	type HoverHandle,
	type HoverInput,
} from 'cs/platform/hover/browser/hoverWidget';
import { Disposable } from 'cs/base/common/lifecycle';

export class UpdatableHoverWidget extends Disposable implements HoverHandle {
	private readonly hover: HoverHandle;

	constructor(
		target: HTMLElement,
		input: HoverInput,
		anchor?: HTMLElement,
	) {
		super();
		this.hover = this._register(createHoverController(target, input, anchor));
	}

	show(): void {
		this.hover.show();
	}

	hide(): void {
		this.hover.hide();
	}

	update(input: HoverInput): void {
		this.hover.update(input);
	}
}
