/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'cs/base/browser/dom';
import { type IKeyboardEvent, StandardKeyboardEvent } from 'cs/base/browser/keyboardEvent';
import { type IMouseEvent, StandardMouseEvent } from 'cs/base/browser/mouseEvent';
import { Gesture } from 'cs/base/browser/touch';
import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';

export abstract class Widget extends Disposable {
	protected onclick(domNode: HTMLElement, listener: (event: IMouseEvent) => void): void {
		this._register(dom.addDisposableListener(domNode, dom.EventType.CLICK, (event: MouseEvent) => {
			listener(new StandardMouseEvent(dom.getWindow(domNode), event));
		}));
	}

	protected onmousedown(domNode: HTMLElement, listener: (event: IMouseEvent) => void): void {
		this._register(dom.addDisposableListener(domNode, dom.EventType.MOUSE_DOWN, (event: MouseEvent) => {
			listener(new StandardMouseEvent(dom.getWindow(domNode), event));
		}));
	}

	protected onmouseover(domNode: HTMLElement, listener: (event: IMouseEvent) => void): void {
		this._register(dom.addDisposableListener(domNode, dom.EventType.MOUSE_OVER, (event: MouseEvent) => {
			listener(new StandardMouseEvent(dom.getWindow(domNode), event));
		}));
	}

	protected onmouseleave(domNode: HTMLElement, listener: (event: IMouseEvent) => void): void {
		this._register(dom.addDisposableListener(domNode, dom.EventType.MOUSE_LEAVE, (event: MouseEvent) => {
			listener(new StandardMouseEvent(dom.getWindow(domNode), event));
		}));
	}

	protected onkeydown(domNode: HTMLElement, listener: (event: IKeyboardEvent) => void): void {
		this._register(dom.addDisposableListener(domNode, dom.EventType.KEY_DOWN, (event: KeyboardEvent) => {
			listener(new StandardKeyboardEvent(event));
		}));
	}

	protected onkeyup(domNode: HTMLElement, listener: (event: IKeyboardEvent) => void): void {
		this._register(dom.addDisposableListener(domNode, dom.EventType.KEY_UP, (event: KeyboardEvent) => {
			listener(new StandardKeyboardEvent(event));
		}));
	}

	protected oninput(domNode: HTMLElement, listener: (event: Event) => void): void {
		this._register(dom.addDisposableListener(domNode, dom.EventType.INPUT, listener));
	}

	protected onblur(domNode: HTMLElement, listener: (event: Event) => void): void {
		this._register(dom.addDisposableListener(domNode, dom.EventType.BLUR, listener));
	}

	protected onfocus(domNode: HTMLElement, listener: (event: Event) => void): void {
		this._register(dom.addDisposableListener(domNode, dom.EventType.FOCUS, listener));
	}

	protected onchange(domNode: HTMLElement, listener: (event: Event) => void): void {
		this._register(dom.addDisposableListener(domNode, dom.EventType.CHANGE, listener));
	}

	protected ignoreGesture(domNode: HTMLElement): IDisposable {
		return Gesture.ignoreTarget(domNode);
	}
}
