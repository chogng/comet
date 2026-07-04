/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Literature Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from 'ls/base/browser/dom';
import { mainWindow } from 'ls/base/browser/window';
import { Disposable, DisposableStore, type IDisposable } from 'ls/base/common/lifecycle';

export namespace EventType {
	export const Tap = '-monaco-gesturetap';
	export const Change = '-monaco-gesturechange';
	export const Start = '-monaco-gesturestart';
	export const End = '-monaco-gesturesend';
	export const Contextmenu = '-monaco-gesturecontextmenu';
}

export interface GestureEvent extends MouseEvent {
	initialTarget: EventTarget | undefined;
	translationX: number;
	translationY: number;
	pageX: number;
	pageY: number;
	tapCount: number;
}

type TouchSnapshot = {
	readonly target: EventTarget;
	readonly pageX: number;
	readonly pageY: number;
	readonly time: number;
};

export class Gesture extends Disposable {
	static addTarget(element: HTMLElement): IDisposable {
		if (!Gesture.isTouchDevice()) {
			return Disposable.None;
		}

		return new GestureTarget(element);
	}

	static isTouchDevice(): boolean {
		return 'ontouchstart' in mainWindow || navigator.maxTouchPoints > 0;
	}
}

class GestureTarget extends Disposable {
	private static readonly tapDistance = 30;
	private static readonly contextMenuDelay = 700;

	private readonly store = this._register(new DisposableStore());
	private start: TouchSnapshot | undefined;

	constructor(private readonly element: HTMLElement) {
		super();
		this.store.add(addDisposableListener(element, 'touchstart', event => this.onTouchStart(event), { passive: false }));
		this.store.add(addDisposableListener(element, 'touchmove', event => this.onTouchMove(event), { passive: false }));
		this.store.add(addDisposableListener(element, 'touchend', event => this.onTouchEnd(event)));
	}

	private onTouchStart(event: TouchEvent): void {
		const touch = event.changedTouches.item(0);
		if (!touch) {
			return;
		}

		this.start = {
			target: touch.target,
			pageX: touch.pageX,
			pageY: touch.pageY,
			time: Date.now(),
		};
		this.dispatch(EventType.Start, touch.target, touch.pageX, touch.pageY);
	}

	private onTouchMove(event: TouchEvent): void {
		const touch = event.changedTouches.item(0);
		if (!touch || !this.start) {
			return;
		}

		this.dispatch(
			EventType.Change,
			this.start.target,
			touch.pageX,
			touch.pageY,
			touch.pageX - this.start.pageX,
			touch.pageY - this.start.pageY,
		);
	}

	private onTouchEnd(event: TouchEvent): void {
		const touch = event.changedTouches.item(0);
		const start = this.start;
		this.start = undefined;
		if (!touch || !start) {
			return;
		}

		const deltaX = Math.abs(touch.pageX - start.pageX);
		const deltaY = Math.abs(touch.pageY - start.pageY);
		const duration = Date.now() - start.time;
		if (deltaX < GestureTarget.tapDistance && deltaY < GestureTarget.tapDistance) {
			this.dispatch(
				duration >= GestureTarget.contextMenuDelay ? EventType.Contextmenu : EventType.Tap,
				start.target,
				touch.pageX,
				touch.pageY,
			);
		}
		this.dispatch(EventType.End, start.target, touch.pageX, touch.pageY);
	}

	private dispatch(
		type: string,
		initialTarget: EventTarget,
		pageX: number,
		pageY: number,
		translationX = 0,
		translationY = 0,
	): void {
		const event = new CustomEvent(type, { bubbles: true, cancelable: true }) as unknown as GestureEvent;
		event.initialTarget = initialTarget;
		event.pageX = pageX;
		event.pageY = pageY;
		event.translationX = translationX;
		event.translationY = translationY;
		event.tapCount = type === EventType.Tap ? 1 : 0;
		this.element.dispatchEvent(event);
	}
}
