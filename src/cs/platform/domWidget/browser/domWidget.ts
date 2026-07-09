/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isHotReloadEnabled } from 'cs/base/common/hotReload';
import { Disposable, DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { autorun, constObservable, derived, type IObservable, type ISettableObservable, observableValue } from 'cs/base/common/observable';
import { type GetLeadingNonServiceArgs, type IInstantiationService } from 'cs/platform/instantiation/common/instantiation';

export abstract class DomWidget extends Disposable {
	public static createAppend<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, dom: HTMLElement, store: DisposableStore, ...params: TArgs): void {
		if (!isHotReloadEnabled()) {
			const widget = new this(...params);
			dom.appendChild(widget.element);
			store.add(widget);
			return;
		}

		const observable = this.createObservable(store, ...params);
		store.add(autorun(reader => {
			const widget = observable.read(reader);
			dom.appendChild(widget.element);
			reader.store.add(toDisposable(() => widget.element.remove()));
			reader.store.add(widget);
		}));
	}

	public static createInContents<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, store: DisposableStore, ...params: TArgs): HTMLDivElement {
		const div = document.createElement('div');
		div.style.display = 'contents';
		this.createAppend(div, store, ...params);
		return div;
	}

	public static createObservable<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, _store: DisposableStore, ...params: TArgs): IObservable<T> {
		if (!isHotReloadEnabled()) {
			return constObservable(new this(...params));
		}

		const id = (this as unknown as HotReloadable)[hotReloadId];
		const observable = id ? hotReloadedWidgets.get(id) : undefined;

		if (!observable) {
			return constObservable(new this(...params));
		}

		return derived(reader => {
			const ctor = observable.read(reader);
			return new ctor(...params) as T;
		});
	}

	public static instantiateAppend<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, instantiationService: IInstantiationService, dom: HTMLElement, store: DisposableStore, ...params: GetLeadingNonServiceArgs<TArgs>): void {
		if (!isHotReloadEnabled()) {
			const widget = instantiationService.createInstance(this as unknown as new (...args: unknown[]) => T, ...params);
			dom.appendChild(widget.element);
			store.add(widget);
			return;
		}

		const observable = this.instantiateObservable(instantiationService, store, ...params);
		let lastWidget: DomWidget | undefined;
		store.add(autorun(reader => {
			const widget = observable.read(reader);
			if (lastWidget) {
				lastWidget.element.replaceWith(widget.element);
			} else {
				dom.appendChild(widget.element);
			}
			lastWidget = widget;

			reader.delayedStore.add(widget);
		}));
	}

	public static instantiateInContents<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, instantiationService: IInstantiationService, store: DisposableStore, ...params: GetLeadingNonServiceArgs<TArgs>): HTMLDivElement {
		const div = document.createElement('div');
		div.style.display = 'contents';
		this.instantiateAppend(instantiationService, div, store, ...params);
		return div;
	}

	public static instantiateObservable<TArgs extends unknown[], T extends DomWidget>(this: DomWidgetCtor<TArgs, T>, instantiationService: IInstantiationService, _store: DisposableStore, ...params: GetLeadingNonServiceArgs<TArgs>): IObservable<T> {
		if (!isHotReloadEnabled()) {
			return constObservable(instantiationService.createInstance(this as unknown as new (...args: unknown[]) => T, ...params));
		}

		const id = (this as unknown as HotReloadable)[hotReloadId];
		const observable = id ? hotReloadedWidgets.get(id) : undefined;

		if (!observable) {
			return constObservable(instantiationService.createInstance(this as unknown as new (...args: unknown[]) => T, ...params));
		}

		return derived(reader => {
			const ctor = observable.read(reader);
			return instantiationService.createInstance(ctor, ...params) as T;
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public static registerWidgetHotReplacement(this: new (...args: any[]) => DomWidget, id: string): void {
		if (!isHotReloadEnabled()) {
			return;
		}

		let observable = hotReloadedWidgets.get(id);
		if (!observable) {
			observable = observableValue(id, this);
			hotReloadedWidgets.set(id, observable);
		} else {
			observable.set(this, undefined);
		}
		(this as unknown as HotReloadable)[hotReloadId] = id;
	}

	abstract get element(): HTMLElement;
}

const hotReloadId = Symbol('DomWidgetHotReloadId');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hotReloadedWidgets = new Map<string, ISettableObservable<new (...args: any[]) => DomWidget>>();

interface HotReloadable {
	[hotReloadId]?: string;
}

type DomWidgetCtor<TArgs extends unknown[], T extends DomWidget> = {
	new(...args: TArgs): T;

	createObservable(store: DisposableStore, ...params: TArgs): IObservable<T>;
	instantiateObservable(instantiationService: IInstantiationService, store: DisposableStore, ...params: GetLeadingNonServiceArgs<TArgs>): IObservable<T>;
	createAppend(dom: HTMLElement, store: DisposableStore, ...params: TArgs): void;
	instantiateAppend(instantiationService: IInstantiationService, dom: HTMLElement, store: DisposableStore, ...params: GetLeadingNonServiceArgs<TArgs>): void;
};
