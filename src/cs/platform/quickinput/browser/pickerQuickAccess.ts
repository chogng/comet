/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { Disposable } from 'cs/base/common/lifecycle';
import type {
	IQuickAccessProvider,
	IQuickAccessProviderRunOptions,
} from 'cs/platform/quickinput/common/quickAccess';
import type {
	IQuickPick,
	IQuickPickItem,
	IQuickPickSeparator,
} from 'cs/platform/quickinput/common/quickInput';

export const enum TriggerAction {
	NO_ACTION = 0,
	CLOSE_PICKER = 1,
	REFRESH_PICKER = 2,
}

export interface IPickerQuickAccessItem extends IQuickPickItem {
	accept?(): void;
	trigger?(): TriggerAction;
}

export type Picks<T extends IPickerQuickAccessItem = IPickerQuickAccessItem> = Array<T | IQuickPickSeparator>;
export type PicksWithActive<T extends IPickerQuickAccessItem = IPickerQuickAccessItem> = { picks: Picks<T>; active?: T };
export type FastAndSlowPicks<T extends IPickerQuickAccessItem = IPickerQuickAccessItem> = { picks: Picks<T> | Promise<Picks<T>>; additionalPicks?: Promise<Picks<T>> };

export interface IPickerQuickAccessProviderOptions<T extends IPickerQuickAccessItem> {
	readonly noResultsPick?: (filter: string) => T;
}

function isSeparator(item: IPickerQuickAccessItem | IQuickPickSeparator): item is IQuickPickSeparator {
	return item.type === 'separator';
}

function matches(item: IPickerQuickAccessItem, filter: string): boolean {
	const normalized = filter.trim().toLowerCase();
	if (!normalized || item.alwaysShow) {
		return true;
	}

	return [item.label, item.description, item.detail]
		.filter((value): value is string => Boolean(value))
		.join(' ')
		.toLowerCase()
		.includes(normalized);
}

export abstract class PickerQuickAccessProvider<T extends IPickerQuickAccessItem>
	extends Disposable
	implements IQuickAccessProvider {
	protected constructor(
		protected readonly prefix: string,
		protected readonly options: IPickerQuickAccessProviderOptions<T> = {},
	) {
		super();
	}

	provide(
		picker: IQuickPick<IQuickPickItem>,
		token: CancellationToken,
		_runOptions?: IQuickAccessProviderRunOptions,
	): void {
		const updatePicker = async () => {
			const filter = picker.value;
			const picks = await this.getPicks(filter, token);
			if (token.isCancellationRequested) {
				return;
			}

			const filteredPicks = picks.filter(item => isSeparator(item) || matches(item, filter));
			picker.items = filteredPicks.length > 0
				? filteredPicks
				: this.options.noResultsPick
					? [this.options.noResultsPick(filter)]
					: [];
		};

		this._register(picker.onDidChangeValue(() => {
			void updatePicker();
		}));
		this._register(picker.onDidAccept(() => {
			const activeItem = picker.activeItems[0] as T | undefined;
			activeItem?.accept?.();
		}));
		void updatePicker();
	}

	protected abstract getPicks(filter: string, token: CancellationToken): Picks<T> | Promise<Picks<T>>;
}
