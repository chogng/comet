/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Literature Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	DisposableStore,
	toDisposable,
	type DisposableHandle,
	type DisposableLike,
	type IDisposable,
} from 'ls/base/common/lifecycle';

export type Listener<T> = (event: T) => unknown;

export interface Event<T> {
	(
		listener: Listener<T>,
		thisArgs?: unknown,
		disposables?: IDisposable[] | DisposableStore,
	): DisposableHandle;
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

export namespace Event {
	export const None: Event<never> = () => toDisposable(() => {});

	export interface DOMEventEmitter {
		addEventListener(eventName: string, handler: (...args: unknown[]) => void): void;
		removeEventListener(eventName: string, handler: (...args: unknown[]) => void): void;
	}

	export function fromDOMEventEmitter<T>(
		emitter: DOMEventEmitter,
		eventName: string,
		map: (...args: unknown[]) => T,
	): Event<T>;
	export function fromDOMEventEmitter(
		emitter: DOMEventEmitter,
		eventName: string,
	): Event<unknown>;
	export function fromDOMEventEmitter<T>(
		emitter: DOMEventEmitter,
		eventName: string,
		map: (...args: unknown[]) => T = (...args: unknown[]) => args[0] as T,
	): Event<T> {
		return (listener, thisArgs, disposables) => {
			const handler = (...args: unknown[]) => listener.call(thisArgs, map(...args));
			emitter.addEventListener(eventName, handler);
			const disposable = toDisposable(() => emitter.removeEventListener(eventName, handler));
			addToDisposables(disposable, disposables);
			return disposable;
		};
	}

	export function once<T>(event: Event<T>): Event<T> {
		return (listener, thisArgs, disposables) => {
			let didFire = false;
			let result: IDisposable | undefined;
			result = event(e => {
				if (didFire) {
					return;
				}

				didFire = true;
				result?.dispose();
				listener.call(thisArgs, e);
			});
			addToDisposables(result, disposables);
			return result as DisposableHandle;
		};
	}

	export function map<I, O>(event: Event<I>, map: (i: I) => O, disposable?: DisposableStore): Event<O> {
		void disposable;
		const mapped: Event<O> = (listener, thisArgs, disposables) =>
			event(i => listener.call(thisArgs, map(i)), undefined, disposables);
		return mapped;
	}

	export function forEach<I>(event: Event<I>, each: (i: I) => void, disposable?: DisposableStore): Event<I> {
		void disposable;
		const mapped: Event<I> = (listener, thisArgs, disposables) =>
			event(i => {
				each(i);
				listener.call(thisArgs, i);
			}, undefined, disposables);
		return mapped;
	}

	export function filter<T, U>(event: Event<T | U>, filter: (e: T | U) => e is T, disposable?: DisposableStore): Event<T>;
	export function filter<T>(event: Event<T>, filter: (e: T) => boolean, disposable?: DisposableStore): Event<T>;
	export function filter<T>(event: Event<T>, filter: (e: T) => boolean, disposable?: DisposableStore): Event<T> {
		void disposable;
		const filtered: Event<T> = (listener, thisArgs, disposables) =>
			event(e => {
				if (filter(e)) {
					listener.call(thisArgs, e);
				}
			}, undefined, disposables);
		return filtered;
	}

	export function signal<T>(event: Event<T>): Event<void> {
		return map(event, () => undefined);
	}

	export function any<T>(...events: Event<T>[]): Event<T>;
	export function any(...events: Event<unknown>[]): Event<void>;
	export function any<T>(...events: Event<T>[]): Event<T> {
		return (listener, thisArgs, disposables) => {
			const store = new DisposableStore();
			for (const event of events) {
				store.add(event(e => listener.call(thisArgs, e)));
			}
			const result = toDisposable(() => store.dispose());
			addToDisposables(result, disposables);
			return result;
		};
	}

	export function reduce<I, O>(
		event: Event<I>,
		merge: (last: O | undefined, event: I) => O,
		initial?: O,
		disposable?: DisposableStore,
	): Event<O> {
		void disposable;
		let output = initial;
		const reduced: Event<O> = (listener, thisArgs, disposables) =>
			event(e => {
				output = merge(output, e);
				listener.call(thisArgs, output);
			}, undefined, disposables);
		return reduced;
	}

	export function debounce<I, O>(
		event: Event<I>,
		merge: (last: O | undefined, event: I) => O,
		delay = 100,
		leading = false,
		_flushOnListenerRemove = false,
		_leakWarningThreshold?: number,
		disposable?: DisposableStore,
	): Event<O> {
		void disposable;
		const debounced: Event<O> = (listener, thisArgs, disposables) => {
			let output: O | undefined;
			let handle: ReturnType<typeof setTimeout> | undefined;
			const subscription = event(e => {
				output = merge(output, e);
				if (leading && !handle) {
					listener.call(thisArgs, output);
				}
				if (handle) {
					clearTimeout(handle);
				}
				handle = setTimeout(() => {
					handle = undefined;
					if (!leading && output !== undefined) {
						listener.call(thisArgs, output);
					}
					output = undefined;
				}, delay);
			});
			const result = toDisposable(() => {
				if (handle) {
					clearTimeout(handle);
				}
				subscription.dispose();
			});
			addToDisposables(result, disposables);
			return result;
		};
		return debounced;
	}

	export function latch<T>(
		event: Event<T>,
		equals: (a: T, b: T) => boolean = (a, b) => a === b,
		disposable?: DisposableStore,
	): Event<T> {
		void disposable;
		let firstCall = true;
		let cache: T;
		const latched: Event<T> = (listener, thisArgs, disposables) =>
			event(e => {
				const shouldEmit = firstCall || !equals(e, cache);
				firstCall = false;
				cache = e;
				if (shouldEmit) {
					listener.call(thisArgs, e);
				}
			}, undefined, disposables);
		return latched;
	}

	export function runAndSubscribe<T>(event: Event<T>, handler: (e: T) => unknown, initial: T): IDisposable;
	export function runAndSubscribe<T>(event: Event<T>, handler: (e: T | undefined) => unknown): IDisposable;
	export function runAndSubscribe<T>(event: Event<T>, handler: (e: T | undefined) => unknown, initial?: T): IDisposable {
		handler(initial);
		return event(handler);
	}

	export function chain<T, R>(event: Event<T>, synthesize: ($: IChainableSynthesis<T>) => IChainableSynthesis<R>): Event<R> {
		return synthesize(new ChainableEvent(event)).event;
	}

	export interface IChainableSynthesis<T> {
		readonly event: Event<T>;
		map<R>(fn: (i: T) => R): IChainableSynthesis<R>;
		filter(fn: (e: T) => boolean): IChainableSynthesis<T>;
		forEach(fn: (e: T) => void): IChainableSynthesis<T>;
	}
}

class ChainableEvent<T> implements Event.IChainableSynthesis<T> {
	constructor(readonly event: Event<T>) {}

	map<R>(fn: (i: T) => R): Event.IChainableSynthesis<R> {
		return new ChainableEvent(Event.map(this.event, fn));
	}

	filter(fn: (e: T) => boolean): Event.IChainableSynthesis<T> {
		return new ChainableEvent(Event.filter(this.event, fn));
	}

	forEach(fn: (e: T) => void): Event.IChainableSynthesis<T> {
		return new ChainableEvent(Event.forEach(this.event, fn));
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

export class Emitter<T> extends EventEmitter<T> {}

export class EventBufferer {
	private buffers: Array<() => void>[] = [];

	wrapEvent<T>(event: Event<T>): Event<T> {
		return (listener, thisArgs, disposables) =>
			event(e => {
				const buffer = this.buffers.at(-1);
				if (buffer) {
					buffer.push(() => listener.call(thisArgs, e));
				} else {
					listener.call(thisArgs, e);
				}
			}, undefined, disposables);
	}

	bufferEvents<R>(fn: () => R): R {
		const buffer: Array<() => void> = [];
		this.buffers.push(buffer);
		try {
			return fn();
		} finally {
			this.buffers.pop();
			for (const flush of buffer) {
				flush();
			}
		}
	}
}

export interface IValueWithChangeEvent<T> {
	readonly onDidChange: Event<void>;
	readonly value: T;
	get(): T;
}

export class ValueWithChangeEvent<T> implements IValueWithChangeEvent<T> {
	private readonly emitter = new EventEmitter<void>();

	constructor(private currentValue: T) {}

	readonly onDidChange = this.emitter.event;

	get value(): T {
		return this.currentValue;
	}

	get(): T {
		return this.currentValue;
	}

	set(value: T): void {
		if (Object.is(this.currentValue, value)) {
			return;
		}

		this.currentValue = value;
		this.emitter.fire();
	}
}
