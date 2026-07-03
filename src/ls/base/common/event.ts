/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Literature Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, toDisposable, type DisposableHandle, type DisposableLike, type IDisposable } from 'ls/base/common/lifecycle';

export type Listener<T> = (event: T) => unknown;

export interface Event<T> {
	(
		listener: Listener<T>,
		thisArgs?: unknown,
		disposables?: IDisposable[] | DisposableStore,
	): DisposableHandle;
}

export namespace Event {
	export const None: Event<never> = () => toDisposable(() => {});
}

function addToDisposables(disposable: IDisposable, disposables: IDisposable[] | DisposableStore | undefined): void {
	if (disposables instanceof DisposableStore) {
		disposables.add(disposable);
		return;
	}

	if (Array.isArray(disposables)) {
		disposables.push(disposable);
	}
}

interface ListenerEntry<T> {
	readonly listener: Listener<T>;
	readonly thisArgs: unknown;
}

interface EventEmitterOptions {
	readonly onWillAddFirstListener?: () => void;
	readonly onDidRemoveLastListener?: () => void;
}

export class EventEmitter<T> implements DisposableLike {
	private readonly listeners: ListenerEntry<T>[] = [];
	private disposed = false;

	constructor(private readonly options?: EventEmitterOptions) {}

	readonly event: Event<T> = (listener, thisArgs, disposables) => {
		if (this.disposed) {
			return toDisposable(() => {});
		}

		if (this.listeners.length === 0) {
			this.options?.onWillAddFirstListener?.();
		}

		const entry: ListenerEntry<T> = { listener, thisArgs };
		this.listeners.push(entry);

		const disposable = toDisposable(() => {
			const index = this.listeners.indexOf(entry);
			if (index !== -1) {
				this.listeners.splice(index, 1);

				if (this.listeners.length === 0) {
					this.options?.onDidRemoveLastListener?.();
				}
			}
		});
		addToDisposables(disposable, disposables);
		return disposable;
	};

	fire(event: T): void {
		if (this.disposed || this.listeners.length === 0) {
			return;
		}

		for (const entry of [...this.listeners]) {
			entry.listener.call(entry.thisArgs, event);
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		const hadListeners = this.listeners.length > 0;
		this.listeners.length = 0;

		if (hadListeners) {
			this.options?.onDidRemoveLastListener?.();
		}
	}
}
