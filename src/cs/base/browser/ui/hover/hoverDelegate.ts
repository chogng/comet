/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	createHoverController,
	type HoverHandle,
	type HoverInput,
} from 'cs/base/browser/ui/hover/hoverWidget';
import {
	dispose,
} from 'cs/base/common/lifecycle';

export type HoverBinding = {
	update(input: HoverInput | null | undefined): void;
	dispose(): void;
};

export interface IHoverDelegate {
	createHover(target: HTMLElement, input: HoverInput, anchor?: HTMLElement): HoverHandle;
}

type ManagedHoverHandle = {
	handle: HoverHandle;
	delegate: IHoverDelegate;
};

const managedHoverHandles = new WeakMap<HTMLElement, ManagedHoverHandle>();

class BaseLayerHoverDelegate implements IHoverDelegate {
	createHover(target: HTMLElement, input: HoverInput, anchor?: HTMLElement): HoverHandle {
		return createHoverController(target, input, anchor);
	}
}

const baseLayerHoverDelegate = new BaseLayerHoverDelegate();
let activeHoverDelegate: IHoverDelegate = baseLayerHoverDelegate;

export function setBaseLayerHoverDelegate(hoverDelegate: IHoverDelegate): void {
	activeHoverDelegate = hoverDelegate;
}

export function getBaseLayerHoverDelegate(): IHoverDelegate {
	return activeHoverDelegate;
}

export function bindHover(
	target: HTMLElement,
	initialInput?: HoverInput | null,
	hoverDelegate: IHoverDelegate = getBaseLayerHoverDelegate(),
): HoverBinding {
	const handle = hoverDelegate.createHover(target, null);
	target.removeAttribute('title');

	if (initialInput !== undefined) {
		handle.update(initialInput);
	}

	return {
		update: input => {
			handle.update(input ?? null);
			target.removeAttribute('title');
		},
		dispose: () => {
			dispose(handle);
		},
	};
}

export function applyHover(
	target: HTMLElement,
	input: HoverInput,
	hoverDelegate: IHoverDelegate = getBaseLayerHoverDelegate(),
): HoverHandle {
	const current = managedHoverHandles.get(target);
	if (current && current.delegate !== hoverDelegate) {
		dispose(current.handle);
		managedHoverHandles.delete(target);
	}

	const handle = managedHoverHandles.get(target)?.handle
		?? hoverDelegate.createHover(target, null);
	managedHoverHandles.set(target, {
		handle,
		delegate: hoverDelegate,
	});
	handle.update(input);
	target.removeAttribute('title');
	return handle;
}
