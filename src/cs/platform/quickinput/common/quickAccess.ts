/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { IDisposable } from 'cs/base/common/lifecycle';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import type { ContextKeyExpression } from 'cs/platform/contextkey/common/contextkey';
import type {
	IQuickNavigateConfiguration,
	IQuickPick,
	IQuickPickItem,
} from 'cs/platform/quickinput/common/quickInput';

export const Extensions = {
	Quickaccess: 'workbench.contributions.quickaccess',
} as const;

export const enum DefaultQuickAccessFilterValue {
	LAST = 'last',
	PRESERVE = 'preserve',
}

export interface IQuickAccessProviderRunOptions {
	readonly preserveValue?: boolean;
	readonly quickNavigate?: IQuickNavigateConfiguration;
}

export interface IQuickAccessProvider {
	provide(picker: IQuickPick<IQuickPickItem>, token: CancellationToken, runOptions?: IQuickAccessProviderRunOptions): IDisposable | void;
}

export interface IQuickAccessProviderDescriptor {
	readonly prefix: string;
	readonly placeholder?: string;
	readonly contextKey?: string;
	readonly defaultFilterValue?: DefaultQuickAccessFilterValue;
	readonly helpEntries?: readonly IQuickAccessHelpEntry[];
	readonly ctor: new (...args: never[]) => IQuickAccessProvider;
}

export interface IQuickAccessHelpEntry {
	readonly description: string;
	readonly commandId?: string;
	readonly when?: ContextKeyExpression;
	readonly commandCenterOrder?: number;
}

export interface IQuickAccessOptions extends IQuickAccessProviderRunOptions {
	readonly preserveValue?: boolean;
}

export interface IQuickAccessController {
	show(value?: string, options?: IQuickAccessOptions): void;
	pick(value?: string, options?: IQuickAccessOptions): Promise<IQuickPickItem | undefined>;
}

export interface IQuickAccessRegistry {
	registerQuickAccessProvider(descriptor: IQuickAccessProviderDescriptor): IDisposable;
	getQuickAccessProvider(value: string): IQuickAccessProviderDescriptor | undefined;
	getQuickAccessProviders(): readonly IQuickAccessProviderDescriptor[];
}

class QuickAccessRegistry implements IQuickAccessRegistry {
	private readonly providers: IQuickAccessProviderDescriptor[] = [];

	registerQuickAccessProvider(descriptor: IQuickAccessProviderDescriptor): IDisposable {
		if (this.providers.some(provider => provider.prefix === descriptor.prefix)) {
			throw new Error(`Quick access provider '${descriptor.prefix}' is already registered.`);
		}

		this.providers.push(descriptor);
		this.providers.sort((left, right) => right.prefix.length - left.prefix.length);

		return toDisposable(() => {
			const index = this.providers.indexOf(descriptor);
			if (index >= 0) {
				this.providers.splice(index, 1);
			}
		});
	}

	getQuickAccessProvider(value: string): IQuickAccessProviderDescriptor | undefined {
		return this.providers.find(provider => value.startsWith(provider.prefix));
	}

	getQuickAccessProviders(): readonly IQuickAccessProviderDescriptor[] {
		return [...this.providers];
	}
}

export const quickAccessRegistry = new QuickAccessRegistry();

export function registerQuickAccessProviders(
	descriptors: readonly IQuickAccessProviderDescriptor[],
): IDisposable {
	const store = new DisposableStore();
	for (const descriptor of descriptors) {
		store.add(quickAccessRegistry.registerQuickAccessProvider(descriptor));
	}
	return store;
}
