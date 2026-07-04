/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	HoverHandle,
	HoverInput,
	IHoverDelegate,
} from 'cs/base/browser/ui/hover/hover';
import type { DisposableLike } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IHoverService = createDecorator<IHoverService>('hoverService');

export type HoverInputFactory = () => HoverInput;

export type DelayedHoverInput = HoverInput | HoverInputFactory;

export type HoverLifecycleOptions = {
	groupId?: string;
	reducedDelay?: boolean;
	setupKeyboardEvents?: boolean;
};

export interface IHoverService extends IHoverDelegate {
	readonly _serviceBrand: undefined;

	showDelayedHover(
		target: HTMLElement,
		input: HoverInput,
		lifecycleOptions?: Pick<HoverLifecycleOptions, 'groupId' | 'reducedDelay'>,
	): HoverHandle | undefined;

	setupDelayedHover(
		target: HTMLElement,
		input: DelayedHoverInput,
		lifecycleOptions?: HoverLifecycleOptions,
	): DisposableLike;

	setupDelayedHoverAtMouse(
		target: HTMLElement,
		input: DelayedHoverInput,
		lifecycleOptions?: HoverLifecycleOptions,
	): DisposableLike;

	showInstantHover(
		target: HTMLElement,
		input: HoverInput,
		focus?: boolean,
	): HoverHandle | undefined;

	applyHover(target: HTMLElement, input: HoverInput): HoverHandle;

	hideHover(force?: boolean): void;

	showAndFocusLastHover(): void;
}
