/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from 'cs/base/common/cancellation';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import {
	type IQuickAccessController,
	type IQuickAccessOptions,
	type IQuickAccessProviderDescriptor,
	quickAccessRegistry,
} from 'cs/platform/quickinput/common/quickAccess';
import { IQuickInputService, type IQuickPickItem } from 'cs/platform/quickinput/common/quickInput';

function isDisposable(value: unknown): value is Disposable {
	return value instanceof Disposable;
}

export class QuickAccessController extends Disposable implements IQuickAccessController {
	private readonly visibleDisposables = this._register(new DisposableStore());
	private lastValue = '';

	constructor(
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	show(value = '', options?: IQuickAccessOptions): void {
		this.doShow(value, options, undefined);
	}

	pick(value = '', options?: IQuickAccessOptions): Promise<IQuickPickItem | undefined> {
		return new Promise(resolve => this.doShow(value, options, resolve));
	}

	private doShow(
		value: string,
		options: IQuickAccessOptions | undefined,
		resolve: ((item: IQuickPickItem | undefined) => void) | undefined,
	): void {
		this.visibleDisposables.clear();
		const descriptor = this.getDescriptor(value);
		if (!descriptor) {
			resolve?.(undefined);
			return;
		}

		const provider = this.instantiationService.createInstance(descriptor.ctor);
		if (isDisposable(provider)) {
			this.visibleDisposables.add(provider);
		}
		const picker = this.visibleDisposables.add(this.quickInputService.createQuickPick<IQuickPickItem>({ useSeparators: true }));
		const tokenSource = this.visibleDisposables.add(new CancellationTokenSource());
		picker.value = value.slice(descriptor.prefix.length);
		picker.placeholder = descriptor.placeholder;
		picker.ignoreFocusOut = Boolean(options?.preserveValue);

		const providerDisposables = provider.provide(picker, tokenSource.token, options);
		if (providerDisposables) {
			this.visibleDisposables.add(providerDisposables);
		}

		this.visibleDisposables.add(picker.onDidChangeValue(nextValue => {
			this.lastValue = descriptor.prefix + nextValue;
		}));
		this.visibleDisposables.add(picker.onDidHide(() => {
			tokenSource.cancel();
			resolve?.(undefined);
		}));
		this.visibleDisposables.add(picker.onDidAccept(() => {
			const item = picker.activeItems[0];
			resolve?.(item);
			picker.hide();
		}));

		this.lastValue = value;
		picker.show();
	}

	private getDescriptor(value: string): IQuickAccessProviderDescriptor | undefined {
		const resolvedValue = value || this.lastValue;
		return quickAccessRegistry.getQuickAccessProvider(resolvedValue);
	}
}
