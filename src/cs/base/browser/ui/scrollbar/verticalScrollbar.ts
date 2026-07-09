/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'cs/base/browser/ui/scrollbar/media/verticalScrollbar.css';
import { VerticalScrollbarState } from 'cs/base/browser/ui/scrollbar/scrollbarState';
import {
	Disposable,
	MutableDisposable,
	combinedDisposable,
	toDisposable,
	type DisposableLike,
} from 'cs/base/common/lifecycle';
import { ScrollbarVisibility } from 'cs/base/common/scrollable';

const MIN_THUMB_SIZE = 24;
const ACTIVE_CLASS_TIMEOUT = 900;
const WHEEL_LINE_SIZE = 16;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

export type VerticalScrollbarOptions = {
	activeItem?: HTMLElement | null;
	initialScrollTop?: number;
	onScrollTopChange?: (scrollTop: number) => void;
	vertical?: ScrollbarVisibility;
	verticalScrollbarSize?: number;
	handleMouseWheel?: boolean;
	mouseWheelSmoothScroll?: boolean;
	flipAxes?: boolean;
	consumeMouseWheelIfScrollbarIsNeeded?: boolean;
	alwaysConsumeMouseWheel?: boolean;
	mouseWheelScrollSensitivity?: number;
	fastScrollSensitivity?: number;
	scrollPredominantAxis?: boolean;
};

function addDisposableListener<K extends keyof HTMLElementEventMap>(
	target: HTMLElement,
	type: K,
	listener: (event: HTMLElementEventMap[K]) => void,
	options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener<K extends keyof WindowEventMap>(
	target: Window,
	type: K,
	listener: (event: WindowEventMap[K]) => void,
	options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener(
	target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
	type: string,
	listener: EventListenerOrEventListenerObject,
	options?: boolean | AddEventListenerOptions,
) {
	target.addEventListener(type, listener, options);
	return toDisposable(() => {
		target.removeEventListener(type, listener, options);
	});
}

export class VerticalScrollbar extends Disposable {
	private readonly host: HTMLElement;
	private readonly strip: HTMLElement;
	private readonly track: HTMLElement;
	private readonly thumb: HTMLElement;
	private readonly activeItem: HTMLElement | null;
	private readonly onScrollTopChange?: (scrollTop: number) => void;
	private vertical: ScrollbarVisibility;
	private verticalScrollbarSize: number;
	private handleMouseWheel: boolean;
	private mouseWheelSmoothScroll: boolean;
	private flipAxes: boolean;
	private consumeMouseWheelIfScrollbarIsNeeded: boolean;
	private alwaysConsumeMouseWheel: boolean;
	private mouseWheelScrollSensitivity: number;
	private fastScrollSensitivity: number;
	private scrollPredominantAxis: boolean;
	private readonly scrollbarState: VerticalScrollbarState;
	private readonly activeClassTimeout = new MutableDisposable<DisposableLike>();
	private readonly animationFrame = new MutableDisposable<DisposableLike>();
	private readonly dragListeners = new MutableDisposable<DisposableLike>();
	private dragPointerId: number | null = null;
	private dragStartClientY = 0;
	private dragStartScrollTop = 0;
	private disposed = false;

	constructor(
		host: HTMLElement,
		strip: HTMLElement,
		track: HTMLElement,
		thumb: HTMLElement,
		options: VerticalScrollbarOptions = {},
	) {
		super();
		this.host = host;
		this.strip = strip;
		this.track = track;
		this.thumb = thumb;
		this.activeItem = options.activeItem ?? null;
		this.onScrollTopChange = options.onScrollTopChange;
		this.vertical = options.vertical ?? ScrollbarVisibility.Auto;
		this.verticalScrollbarSize = options.verticalScrollbarSize ?? 4;
		this.handleMouseWheel = options.handleMouseWheel ?? true;
		this.mouseWheelSmoothScroll = options.mouseWheelSmoothScroll ?? true;
		this.flipAxes = options.flipAxes ?? false;
		this.consumeMouseWheelIfScrollbarIsNeeded =
			options.consumeMouseWheelIfScrollbarIsNeeded ?? false;
		this.alwaysConsumeMouseWheel = options.alwaysConsumeMouseWheel ?? false;
		this.mouseWheelScrollSensitivity = options.mouseWheelScrollSensitivity ?? 1;
		this.fastScrollSensitivity = options.fastScrollSensitivity ?? 5;
		this.scrollPredominantAxis = options.scrollPredominantAxis ?? true;
		this.scrollbarState = new VerticalScrollbarState({
			arrowSize: 0,
			scrollbarSize: this.resolveScrollbarSize(),
			oppositeScrollbarSize: 0,
			visibleSize: this.strip.clientHeight,
			scrollSize: this.strip.scrollHeight,
			scrollPosition: this.strip.scrollTop,
		});

		if (
			typeof options.initialScrollTop === 'number' &&
			options.initialScrollTop > 0
		) {
			this.strip.scrollTop = options.initialScrollTop;
		}

		this._register(this.activeClassTimeout);
		this._register(this.animationFrame);
		this._register(this.dragListeners);
		this._register(addDisposableListener(this.track, 'pointerdown', this.handleTrackPointerDown));
		this._register(addDisposableListener(this.thumb, 'pointerdown', this.handleThumbPointerDown));
		this._register(
			addDisposableListener(this.strip, 'wheel', this.handleScrollbarWheel, {
				passive: false,
			}),
		);
		this._register(
			addDisposableListener(this.track, 'wheel', this.handleScrollbarWheel, {
				passive: false,
			}),
		);
		this._register(
			addDisposableListener(this.thumb, 'wheel', this.handleScrollbarWheel, {
				passive: false,
			}),
		);
		this._register(
			addDisposableListener(this.strip, 'scroll', this.handleStripScroll, {
				passive: true,
			}),
		);
		this.applyOptions();

		if (typeof ResizeObserver !== 'undefined') {
			const resizeObserver = new ResizeObserver(() => {
				this.scheduleRender();
			});
			resizeObserver.observe(this.host);
			resizeObserver.observe(this.strip);
			resizeObserver.observe(this.track);
			this._register(
				toDisposable(() => {
					resizeObserver.disconnect();
				}),
			);
		}

		this.scheduleInitialLayout();
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.clearActiveClassTimeout();
		this.animationFrame.clear();
		this.endDrag();
		super.dispose();
	}

	renderNow() {
		this.animationFrame.clear();
		this.render();
	}

	updateOptions(options: VerticalScrollbarOptions) {
		this.vertical = options.vertical ?? this.vertical;
		this.verticalScrollbarSize = options.verticalScrollbarSize ?? this.verticalScrollbarSize;
		this.handleMouseWheel = options.handleMouseWheel ?? this.handleMouseWheel;
		this.mouseWheelSmoothScroll = options.mouseWheelSmoothScroll ?? this.mouseWheelSmoothScroll;
		this.flipAxes = options.flipAxes ?? this.flipAxes;
		this.consumeMouseWheelIfScrollbarIsNeeded =
			options.consumeMouseWheelIfScrollbarIsNeeded ?? this.consumeMouseWheelIfScrollbarIsNeeded;
		this.alwaysConsumeMouseWheel = options.alwaysConsumeMouseWheel ?? this.alwaysConsumeMouseWheel;
		this.mouseWheelScrollSensitivity =
			options.mouseWheelScrollSensitivity ?? this.mouseWheelScrollSensitivity;
		this.fastScrollSensitivity = options.fastScrollSensitivity ?? this.fastScrollSensitivity;
		this.scrollPredominantAxis =
			options.scrollPredominantAxis ?? this.scrollPredominantAxis;
		this.applyOptions();
		this.scheduleRender();
	}

	delegatePointerDown(event: PointerEvent) {
		this.handleTrackPointerDown(event);
	}

	private applyOptions() {
		this.host.style.setProperty(
			'--comet-vertical-scrollbar-size',
			`${this.verticalScrollbarSize}px`,
		);
	}

	private resolveScrollbarSize() {
		return this.vertical === ScrollbarVisibility.Hidden
			? 0
			: this.verticalScrollbarSize;
	}

	private readonly scheduleInitialLayout = () => {
		this.scheduleAnimationFrame(() => {
			this.revealActiveItem();
			this.render();
		});
	};

	private readonly scheduleRender = () => {
		if (this.animationFrame.value) {
			return;
		}

		this.scheduleAnimationFrame(() => {
			this.render();
		});
	};

	private render() {
		const visibleHeight = this.strip.clientHeight;
		const scrollHeight = this.strip.scrollHeight;
		const maxScrollTop = Math.max(0, scrollHeight - visibleHeight);
		const trackHeight = this.track.clientHeight;
		const scrollbarSize = this.resolveScrollbarSize();
		const isScrollable = visibleHeight > 0 && trackHeight > 0 && maxScrollTop > 0 && scrollbarSize > 0;
		this.scrollbarState.setScrollbarSize(scrollbarSize);
		this.scrollbarState.setDimensions(trackHeight, scrollHeight);
		this.scrollbarState.setScrollTop(this.strip.scrollTop);

		this.host.classList.toggle('comet-vertical-scrollbar-host', true);
		this.host.classList.toggle('comet-is-scrollable', isScrollable);
		this.host.classList.toggle(
			'comet-is-vertical-scrollbar-visible',
			isScrollable && this.vertical === ScrollbarVisibility.Visible,
		);
		if (!isScrollable) {
			this.thumb.style.height = '0px';
			this.thumb.style.transform = 'translate3d(0, 0, 0)';
			this.host.classList.remove('comet-is-scrollbar-active');
			this.host.classList.remove('comet-is-scrollbar-dragging');
			this.emitScrollTop();
			return;
		}

		const thumbSize = Math.max(MIN_THUMB_SIZE, this.scrollbarState.getSliderSize());
		const thumbOffset = this.scrollbarState.getSliderPosition();

		this.thumb.style.height = `${thumbSize}px`;
		this.thumb.style.transform = `translate3d(0, ${thumbOffset}px, 0)`;
		this.emitScrollTop();
	}

	private revealActiveItem() {
		if (!this.activeItem) {
			return;
		}
		this.activeItem.scrollIntoView({
			block: 'nearest',
			inline: 'nearest',
		});
	}

	private emitScrollTop() {
		this.onScrollTopChange?.(this.strip.scrollTop);
	}

	private readonly handleStripScroll = () => {
		this.showScrollbarTemporarily();
		this.scheduleRender();
	};

	private readonly handleTrackPointerDown = (event: PointerEvent) => {
		if (
			event.button !== 0 ||
			event.target !== this.track ||
			!this.host.classList.contains('comet-is-scrollable')
		) {
			return;
		}

		event.preventDefault();
		const trackRect = this.track.getBoundingClientRect();
		const targetOffset = event.clientY - trackRect.top;
		this.strip.scrollTop =
			this.scrollbarState.getDesiredScrollPositionFromOffset(targetOffset);
		this.scheduleRender();
		this.showScrollbarTemporarily();
	};

	private readonly handleThumbPointerDown = (event: PointerEvent) => {
		if (event.button !== 0 || !this.host.classList.contains('comet-is-scrollable')) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		this.dragPointerId = event.pointerId;
		this.dragStartClientY = event.clientY;
		this.dragStartScrollTop = this.strip.scrollTop;
		this.host.classList.add('comet-is-scrollbar-active');
		this.host.classList.add('comet-is-scrollbar-dragging');
		this.thumb.setPointerCapture?.(event.pointerId);
		this.dragListeners.value = combinedDisposable(
			addDisposableListener(window, 'pointermove', this.handleWindowPointerMove),
			addDisposableListener(window, 'pointerup', this.handleWindowPointerUp),
			addDisposableListener(window, 'pointercancel', this.handleWindowPointerUp),
		);
	};

	private readonly handleWindowPointerMove = (event: PointerEvent) => {
		if (event.pointerId !== this.dragPointerId) {
			return;
		}

		if (!this.scrollbarState.isNeeded()) {
			return;
		}

		const deltaY = event.clientY - this.dragStartClientY;
		this.strip.scrollTop = this.dragStartScrollTop;
		this.scrollbarState.setScrollTop(this.dragStartScrollTop);
		this.strip.scrollTop =
			this.scrollbarState.getDesiredScrollPositionFromDelta(deltaY);
		this.scheduleRender();
	};

	private readonly handleWindowPointerUp = (event: PointerEvent) => {
		if (event.pointerId !== this.dragPointerId) {
			return;
		}

		this.endDrag();
		this.showScrollbarTemporarily();
	};

	private endDrag() {
		if (this.dragPointerId !== null) {
			this.thumb.releasePointerCapture?.(this.dragPointerId);
		}
		this.dragPointerId = null;
		this.dragListeners.clear();
		this.host.classList.remove('comet-is-scrollbar-dragging');
	}

	private readonly handleScrollbarWheel = (event: WheelEvent) => {
		if (!this.handleMouseWheel) {
			return;
		}

		const isScrollable = this.host.classList.contains('comet-is-scrollable');
		if (!isScrollable) {
			if (this.alwaysConsumeMouseWheel) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}

		const wheelDelta = this.getVerticalWheelDelta(event);
		const currentScrollTop = this.strip.scrollTop;
		const maxScrollTop = Math.max(0, this.strip.scrollHeight - this.strip.clientHeight);
		const nextScrollTop = Math.min(
			maxScrollTop,
			Math.max(0, currentScrollTop + wheelDelta),
		);
		const didScroll = nextScrollTop !== currentScrollTop;

		if (
			this.alwaysConsumeMouseWheel ||
			(this.consumeMouseWheelIfScrollbarIsNeeded && isScrollable) ||
			didScroll
		) {
			event.preventDefault();
			event.stopPropagation();
		}

		if (!didScroll) {
			return;
		}

		this.setScrollTop(nextScrollTop);
		this.scheduleRender();
		this.showScrollbarTemporarily();
	};

	private getVerticalWheelDelta(event: WheelEvent) {
		let deltaX = event.deltaX * this.mouseWheelScrollSensitivity;
		let deltaY = event.deltaY * this.mouseWheelScrollSensitivity;

		if (this.scrollPredominantAxis) {
			if (Math.abs(deltaX) > Math.abs(deltaY)) {
				deltaY = 0;
			} else {
				deltaX = 0;
			}
		}

		if (this.flipAxes) {
			[deltaY, deltaX] = [deltaX, deltaY];
		}

		if (event.altKey) {
			deltaY *= this.fastScrollSensitivity;
		}

		if (deltaY === 0) {
			return 0;
		}

		if (event.deltaMode === DOM_DELTA_LINE) {
			return deltaY * WHEEL_LINE_SIZE;
		}

		if (event.deltaMode === DOM_DELTA_PAGE) {
			return deltaY * this.strip.clientHeight;
		}

		return deltaY;
	}

	private setScrollTop(scrollTop: number) {
		if (this.mouseWheelSmoothScroll && typeof this.strip.scrollTo === 'function') {
			this.strip.scrollTo({
				top: scrollTop,
				behavior: 'smooth',
			});
			return;
		}

		this.strip.scrollTop = scrollTop;
	}

	private showScrollbarTemporarily() {
		if (!this.host.classList.contains('comet-is-scrollable')) {
			return;
		}

		this.host.classList.add('comet-is-scrollbar-active');
		this.clearActiveClassTimeout();
		let timeoutId = 0;
		const timeoutHandle = toDisposable(() => {
			window.clearTimeout(timeoutId);
		});
		timeoutId = window.setTimeout(() => {
			if (this.activeClassTimeout.value === timeoutHandle) {
				this.activeClassTimeout.clear();
			}
			if (this.dragPointerId === null) {
				this.host.classList.remove('comet-is-scrollbar-active');
			}
		}, ACTIVE_CLASS_TIMEOUT);
		this.activeClassTimeout.value = timeoutHandle;
	}

	private clearActiveClassTimeout() {
		this.activeClassTimeout.clear();
	}

	private scheduleAnimationFrame(callback: () => void) {
		if (this.disposed) {
			return;
		}

		let frameId = 0;
		const frameHandle = toDisposable(() => {
			window.cancelAnimationFrame(frameId);
		});
		frameId = window.requestAnimationFrame(() => {
			if (this.animationFrame.value === frameHandle) {
				this.animationFrame.clear();
			}
			if (!this.disposed) {
				callback();
			}
		});
		this.animationFrame.value = frameHandle;
	}
}

export default VerticalScrollbar;
