/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Literature Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, type IDisposable } from 'ls/base/common/lifecycle';

export interface IReader {
	readonly store: DisposableStore;
	readObservable<T>(observable: IObservable<T>): T;
}

export interface IObservable<T> {
	get(): T;
	read(reader: IReader | undefined): T;
}

export interface ISettableObservable<T> extends IObservable<T> {
	set(value: T, transaction: unknown): void;
}

class Reader implements IReader {
	readonly store = new DisposableStore();

	readObservable<T>(observable: IObservable<T>): T {
		return observable.read(this);
	}
}

class ConstObservable<T> implements IObservable<T> {
	constructor(private readonly value: T) {}

	get(): T {
		return this.value;
	}

	read(_reader: IReader | undefined): T {
		return this.value;
	}
}

class ObservableValue<T> implements ISettableObservable<T> {
	constructor(private value: T) {}

	get(): T {
		return this.value;
	}

	read(_reader: IReader | undefined): T {
		return this.value;
	}

	set(value: T, _transaction: unknown): void {
		this.value = value;
	}
}

class DerivedObservable<T> implements IObservable<T> {
	constructor(private readonly compute: (reader: IReader) => T) {}

	get(): T {
		const reader = new Reader();
		try {
			return this.compute(reader);
		} finally {
			reader.store.dispose();
		}
	}

	read(_reader: IReader | undefined): T {
		return this.get();
	}

	recomputeInitiallyAndOnChange(store: DisposableStore): void {
		const reader = new Reader();
		store.add(reader.store);
		this.compute(reader);
	}
}

type DerivedOptions = {
	readonly owner?: unknown;
	readonly debugName?: () => string;
};

export function constObservable<T>(value: T): IObservable<T> {
	return new ConstObservable(value);
}

export function observableValue<T>(_name: string, value: T): ISettableObservable<T> {
	return new ObservableValue(value);
}

export function derived<T>(compute: (reader: IReader) => T): DerivedObservable<T>;
export function derived<T>(_owner: unknown, compute: (reader: IReader) => T): DerivedObservable<T>;
export function derived<T>(
	ownerOrCompute: unknown | ((reader: IReader) => T),
	compute?: (reader: IReader) => T,
): DerivedObservable<T> {
	const callback = (typeof ownerOrCompute === 'function'
		? ownerOrCompute as (reader: IReader) => T
		: compute)!;
	return new DerivedObservable(callback);
}

export function derivedOpts<T>(_options: DerivedOptions, compute: (reader: IReader) => T): DerivedObservable<T> {
	return new DerivedObservable(compute);
}

export function isObservable<T = unknown>(value: unknown): value is IObservable<T> {
	return (
		typeof value === 'object'
		&& value !== null
		&& typeof (value as IObservable<T>).read === 'function'
	);
}

export function autorun(runner: (reader: IReader) => void): IDisposable {
	const reader = new Reader();
	runner(reader);
	return reader.store;
}
