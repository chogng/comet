/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter, type Event as BaseEvent } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type { GestureEvent } from 'cs/base/browser/touch';

export type EventHandler = HTMLElement | Document | Window;

export interface IDomEvent {
	<K extends keyof DOMEventMap>(
		element: EventHandler,
		type: K,
		useCapture?: boolean,
	): BaseEvent<DOMEventMap[K]>;
	(element: EventHandler, type: string, useCapture?: boolean): BaseEvent<unknown>;
}

export interface DOMEventMap extends HTMLElementEventMap, DocumentEventMap, WindowEventMap {
	compositionstart: CompositionEvent;
	compositionupdate: CompositionEvent;
	compositionend: CompositionEvent;
	'-monaco-gesturetap': GestureEvent;
	'-monaco-gesturechange': GestureEvent;
	'-monaco-gesturestart': GestureEvent;
	'-monaco-gesturesend': GestureEvent;
	'-monaco-gesturecontextmenu': GestureEvent;
}

export class DomEmitter<K extends keyof DOMEventMap> implements IDisposable {
	private readonly emitter: EventEmitter<DOMEventMap[K]>;
	private readonly listener = (event: Event) => {
		this.emitter.fire(event as DOMEventMap[K]);
	};

	get event(): BaseEvent<DOMEventMap[K]> {
		return this.emitter.event;
	}

	constructor(
		private readonly element: EventHandler,
		private readonly type: K,
		private readonly useCapture?: boolean,
	) {
		this.emitter = new EventEmitter({
			onWillAddFirstListener: () => this.element.addEventListener(this.type, this.listener, this.useCapture),
			onDidRemoveLastListener: () => this.element.removeEventListener(this.type, this.listener, this.useCapture),
		});
	}

	dispose(): void {
		this.emitter.dispose();
	}
}
