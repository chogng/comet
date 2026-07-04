/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from 'cs/base/browser/dom';
import {
	createHoverController,
	focusActiveHover,
	hideActiveHover,
	normalizeWorkbenchHoverInput,
	type HoverHandle,
	type HoverInput,
} from 'cs/platform/hover/browser/hoverWidget';
import {
	DisposableStore,
	MutableDisposable,
	dispose,
	toDisposable,
	type DisposableLike,
} from 'cs/base/common/lifecycle';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import {
	IHoverService,
	type DelayedHoverInput,
	type HoverLifecycleOptions,
} from 'cs/platform/hover/browser/hover';
import { setBaseLayerHoverDelegate } from 'cs/base/browser/ui/hover/hoverDelegate';

type ManagedHoverHandle = {
	handle: HoverHandle;
	service: IHoverService;
};

type PendingHoverHandle = HoverHandle & {
	cancelPending(): void;
};

type ServiceHoverHandle = HoverHandle & {
	cancelPending?(): void;
};

type DelayedHoverRegistration = {
	show(focus: boolean): void;
};

const REDUCED_HOVER_DELAY_MS = 150;

function resolveHoverInput(input: DelayedHoverInput): HoverInput {
	return typeof input === 'function' ? input() : input;
}

function createPointRect(clientX: number, clientY: number): DOMRect {
	return {
		x: clientX,
		y: clientY,
		left: clientX,
		top: clientY,
		right: clientX,
		bottom: clientY,
		width: 0,
		height: 0,
		toJSON() {
			return this;
		},
	} as DOMRect;
}

function createMouseAnchor(event: MouseEvent): HTMLElement {
	const anchor = document.createElement('span');
	const rect = createPointRect(event.clientX, event.clientY);
	anchor.getBoundingClientRect = () => rect;
	return anchor;
}

function getHoverDelay(
	input: HoverInput,
	lifecycleOptions?: Pick<HoverLifecycleOptions, 'reducedDelay'>,
): number {
	const options = normalizeWorkbenchHoverInput(input);
	if (!options) {
		return 0;
	}

	if (lifecycleOptions?.reducedDelay) {
		return Math.min(options.delay ?? REDUCED_HOVER_DELAY_MS, REDUCED_HOVER_DELAY_MS);
	}

	return options.delay ?? 0;
}

export class HoverService implements IHoverService {
	declare readonly _serviceBrand: undefined;

	private currentHover: HoverHandle | undefined;
	private currentDelayedHover: PendingHoverHandle | undefined;
	private currentHoverGroupId: string | undefined;
	private readonly delayedHovers = new Map<HTMLElement, DelayedHoverRegistration>();
	private readonly managedHoverHandles = new WeakMap<HTMLElement, ManagedHoverHandle>();

	constructor() {
		setBaseLayerHoverDelegate(this);
	}

	createHover(target: HTMLElement, input: HoverInput, anchor?: HTMLElement): HoverHandle {
		return createHoverController(target, input, anchor);
	}

	showDelayedHover(
		target: HTMLElement,
		input: HoverInput,
		lifecycleOptions?: Pick<HoverLifecycleOptions, 'groupId' | 'reducedDelay'>,
	): HoverHandle | undefined {
		return this.showDelayedHoverWithAnchor(target, input, lifecycleOptions, target);
	}

	setupDelayedHover(
		target: HTMLElement,
		input: DelayedHoverInput,
		lifecycleOptions?: HoverLifecycleOptions,
	): DisposableLike {
		return this.setupDelayedHoverWithAnchor(target, input, lifecycleOptions, () => target);
	}

	setupDelayedHoverAtMouse(
		target: HTMLElement,
		input: DelayedHoverInput,
		lifecycleOptions?: HoverLifecycleOptions,
	): DisposableLike {
		return this.setupDelayedHoverWithAnchor(
			target,
			input,
			lifecycleOptions,
			event => event ? createMouseAnchor(event) : target,
		);
	}

	showInstantHover(
		target: HTMLElement,
		input: HoverInput,
		focus?: boolean,
	): HoverHandle | undefined {
		return this.showInstantHoverWithAnchor(target, input, focus, target);
	}

	applyHover(target: HTMLElement, input: HoverInput): HoverHandle {
		const current = this.managedHoverHandles.get(target);
		if (current && current.service !== this) {
			dispose(current.handle);
			this.managedHoverHandles.delete(target);
		}

		const handle = this.managedHoverHandles.get(target)?.handle
			?? this.createHover(target, null);
		this.managedHoverHandles.set(target, {
			handle,
			service: this,
		});
		handle.update(input);
		target.removeAttribute('title');
		return handle;
	}

	hideHover(_force?: boolean): void {
		dispose(this.currentDelayedHover);
		this.currentDelayedHover = undefined;
		dispose(this.currentHover);
		this.currentHover = undefined;
		this.currentHoverGroupId = undefined;
		hideActiveHover();
	}

	showAndFocusLastHover(): void {
		const activeElement = document.activeElement;
		if (activeElement instanceof HTMLElement) {
			const delayedHover = this.delayedHovers.get(activeElement);
			if (delayedHover) {
				delayedHover.show(true);
				return;
			}
		}

		focusActiveHover();
	}

	private setupDelayedHoverWithAnchor(
		target: HTMLElement,
		input: DelayedHoverInput,
		lifecycleOptions: HoverLifecycleOptions | undefined,
		resolveAnchor: (event?: MouseEvent) => HTMLElement,
	): DisposableLike {
		const store = new DisposableStore();
		const currentHover = store.add(new MutableDisposable<ServiceHoverHandle>());

		store.add(addDisposableListener(target, 'mouseenter', event => {
			currentHover.value = this.showDelayedHoverWithAnchor(
				target,
				resolveHoverInput(input),
				lifecycleOptions,
				resolveAnchor(event),
			);
		}));
		store.add(addDisposableListener(target, 'mouseleave', () => {
			currentHover.value?.cancelPending?.();
		}));

		if (lifecycleOptions?.setupKeyboardEvents) {
			store.add(addDisposableListener(target, 'keydown', event => {
				if (event.key !== 'Enter' && event.key !== ' ') {
					return;
				}

				event.preventDefault();
				currentHover.value = this.showInstantHoverWithAnchor(
					target,
					resolveHoverInput(input),
					true,
					target,
				);
			}));
		}

		this.delayedHovers.set(target, {
			show: focus => {
				currentHover.value = this.showInstantHoverWithAnchor(
					target,
					resolveHoverInput(input),
					focus,
					target,
				);
			},
		});
		store.add(toDisposable(() => {
			this.delayedHovers.delete(target);
		}));

		return store;
	}

	private showInstantHoverWithAnchor(
		target: HTMLElement,
		input: HoverInput,
		focus: boolean | undefined,
		anchor: HTMLElement,
	): HoverHandle | undefined {
		if (!normalizeWorkbenchHoverInput(input)) {
			return undefined;
		}

		dispose(this.currentHover);
		this.currentHover = createHoverController(target, input, anchor);
		this.currentHover.show();
		if (focus) {
			focusActiveHover();
		}

		return this.currentHover;
	}

	private showDelayedHoverWithAnchor(
		target: HTMLElement,
		input: HoverInput,
		lifecycleOptions: Pick<HoverLifecycleOptions, 'groupId' | 'reducedDelay'> | undefined,
		anchor: HTMLElement,
	): PendingHoverHandle | undefined {
		if (!normalizeWorkbenchHoverInput(input)) {
			return undefined;
		}

		dispose(this.currentDelayedHover);
		this.currentDelayedHover = undefined;

		const store = new DisposableStore();
		const timer = store.add(new MutableDisposable<DisposableLike>());
		const handle = store.add(createHoverController(target, input, anchor));
		const delay = lifecycleOptions?.groupId !== undefined && lifecycleOptions.groupId === this.currentHoverGroupId
			? 0
			: getHoverDelay(input, lifecycleOptions);
		let shown = false;
		let delayedHandle: PendingHoverHandle;

		const show = () => {
			if (store.isDisposed || shown) {
				return;
			}

			timer.clear();
			shown = true;
			dispose(this.currentHover);
			this.currentHover = handle;
			this.currentHoverGroupId = lifecycleOptions?.groupId;
			if (this.currentDelayedHover === delayedHandle) {
				this.currentDelayedHover = undefined;
			}
			handle.show();
		};

		delayedHandle = {
			show,
			hide: () => {
				handle.hide();
			},
			update: nextInput => {
				handle.update(nextInput);
			},
			dispose: () => {
				if (this.currentDelayedHover === delayedHandle) {
					this.currentDelayedHover = undefined;
				}
				if (this.currentHover === handle) {
					this.currentHover = undefined;
					this.currentHoverGroupId = undefined;
				}
				store.dispose();
			},
			cancelPending: () => {
				if (shown) {
					return;
				}

				delayedHandle.dispose();
			},
		};

		this.currentDelayedHover = delayedHandle;
		if (delay <= 0) {
			show();
			return delayedHandle;
		}

		const timeoutHandle = window.setTimeout(show, delay);
		timer.value = toDisposable(() => {
			window.clearTimeout(timeoutHandle);
		});

		return delayedHandle;
	}
}

export const hoverService = new HoverService();

export function getHoverService(): IHoverService {
	return hoverService;
}

registerSingleton(IHoverService, HoverService, InstantiationType.Delayed);
