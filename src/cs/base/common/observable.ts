/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'cs/base/common/errors';
import { DisposableStore, type IDisposable } from 'cs/base/common/lifecycle';

interface ObservableObserver {
	handleChange(): void;
}

interface ObservableDependency {
	addObserver(observer: ObservableObserver): void;
	removeObserver(observer: ObservableObserver): void;
}

interface TrackedObserver extends ObservableObserver {
	addDependency(dependency: ObservableDependency): void;
}

function notifyObservers(observers: ReadonlySet<ObservableObserver>): void {
	for (const observer of [...observers]) {
		try {
			observer.handleChange();
		} catch (error) {
			onUnexpectedError(error);
		}
	}
}

export interface IObservableReader {
	readonly store: DisposableStore;
	readonly delayedStore: DisposableStore;
	readObservable<T>(observable: IObservable<T>): T;
}

export interface IObservable<T> {
	get(): T;
	read(reader: IObservableReader | undefined): T;
}

export interface ISettableObservable<T> extends IObservable<T> {
	set(value: T, transaction: unknown): void;
}

class ObservableReader implements IObservableReader {
	constructor(
		private readonly observer: TrackedObserver | undefined,
		readonly store = new DisposableStore(),
		readonly delayedStore = new DisposableStore(),
	) {}

	readObservable<T>(observable: IObservable<T>): T {
		return observable.read(this);
	}

	track(dependency: ObservableDependency): void {
		this.observer?.addDependency(dependency);
	}
}

function track(reader: IObservableReader | undefined, dependency: ObservableDependency): void {
	if (reader instanceof ObservableReader) {
		reader.track(dependency);
	}
}

class ConstObservable<T> implements IObservable<T> {
	constructor(private readonly value: T) {}

	get(): T {
		return this.value;
	}

	read(_reader: IObservableReader | undefined): T {
		return this.value;
	}
}

class ObservableValue<T> implements ISettableObservable<T>, ObservableDependency {
	private readonly observers = new Set<ObservableObserver>();

	constructor(private value: T) {}

	get(): T {
		return this.value;
	}

	read(reader: IObservableReader | undefined): T {
		track(reader, this);
		return this.value;
	}

	set(value: T, _transaction: unknown): void {
		if (Object.is(this.value, value)) {
			return;
		}

		this.value = value;
		notifyObservers(this.observers);
	}

	addObserver(observer: ObservableObserver): void {
		this.observers.add(observer);
	}

	removeObserver(observer: ObservableObserver): void {
		this.observers.delete(observer);
	}
}

class DerivedObservable<T> implements IObservable<T>, ObservableDependency, TrackedObserver {
	private readonly observers = new Set<ObservableObserver>();
	private readonly dependencies = new Set<ObservableDependency>();
	private store = new DisposableStore();
	private delayedStore = new DisposableStore();

	constructor(private readonly compute: (reader: IObservableReader) => T) {}

	get(): T {
		return this.recompute();
	}

	read(reader: IObservableReader | undefined): T {
		track(reader, this);
		return this.get();
	}

	recomputeInitiallyAndOnChange(store: DisposableStore): void {
		store.add(autorun(reader => {
			this.read(reader);
		}));
	}

	addObserver(observer: ObservableObserver): void {
		this.observers.add(observer);
	}

	removeObserver(observer: ObservableObserver): void {
		this.observers.delete(observer);
	}

	addDependency(dependency: ObservableDependency): void {
		if (this.dependencies.has(dependency)) {
			return;
		}

		this.dependencies.add(dependency);
		dependency.addObserver(this);
	}

	handleChange(): void {
		notifyObservers(this.observers);
	}

	private recompute(): T {
		this.store.dispose();
		for (const dependency of this.dependencies) {
			dependency.removeObserver(this);
		}
		this.dependencies.clear();

		const previousDelayedStore = this.delayedStore;
		this.store = new DisposableStore();
		this.delayedStore = new DisposableStore();

		try {
			return this.compute(new ObservableReader(this, this.store, this.delayedStore));
		} finally {
			previousDelayedStore.dispose();
		}
	}
}

type DerivedOptions = {
	readonly owner?: unknown;
	readonly debugName?: () => string;
};

class Autorun implements IDisposable, TrackedObserver {
	private readonly dependencies = new Set<ObservableDependency>();
	private store = new DisposableStore();
	private delayedStore = new DisposableStore();
	private disposed = false;
	private running = false;
	private needsRun = false;

	constructor(private readonly runner: (reader: IObservableReader) => void) {
		this.run();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.disposeDependencies();
		this.store.dispose();
		this.delayedStore.dispose();
	}

	addDependency(dependency: ObservableDependency): void {
		if (this.dependencies.has(dependency)) {
			return;
		}

		this.dependencies.add(dependency);
		dependency.addObserver(this);
	}

	handleChange(): void {
		if (this.running) {
			this.needsRun = true;
			return;
		}

		this.run();
	}

	private run(): void {
		if (this.disposed) {
			return;
		}

		if (this.running) {
			this.needsRun = true;
			return;
		}

		do {
			this.needsRun = false;
			this.running = true;

			this.disposeDependencies();
			this.store.dispose();

			const previousDelayedStore = this.delayedStore;
			this.store = new DisposableStore();
			this.delayedStore = new DisposableStore();

			try {
				this.runner(new ObservableReader(this, this.store, this.delayedStore));
			} finally {
				this.running = false;
				previousDelayedStore.dispose();
			}
		} while (this.needsRun && !this.disposed);
	}

	private disposeDependencies(): void {
		for (const dependency of this.dependencies) {
			dependency.removeObserver(this);
		}
		this.dependencies.clear();
	}
}

export function constObservable<T>(value: T): IObservable<T> {
	return new ConstObservable(value);
}

export function observableValue<T>(_name: string, value: T): ISettableObservable<T> {
	return new ObservableValue(value);
}

export function derived<T>(compute: (reader: IObservableReader) => T): DerivedObservable<T>;
export function derived<T>(_owner: unknown, compute: (reader: IObservableReader) => T): DerivedObservable<T>;
export function derived<T>(
	ownerOrCompute: unknown | ((reader: IObservableReader) => T),
	compute?: (reader: IObservableReader) => T,
): DerivedObservable<T> {
	const callback = (typeof ownerOrCompute === 'function'
		? ownerOrCompute as (reader: IObservableReader) => T
		: compute)!;
	return new DerivedObservable(callback);
}

export function derivedOpts<T>(_options: DerivedOptions, compute: (reader: IObservableReader) => T): DerivedObservable<T> {
	return new DerivedObservable(compute);
}

export function isObservable<T = unknown>(value: unknown): value is IObservable<T> {
	return (
		typeof value === 'object'
		&& value !== null
		&& typeof (value as IObservable<T>).read === 'function'
	);
}

export function autorun(runner: (reader: IObservableReader) => void): IDisposable {
	return new Autorun(runner);
}
