/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import type { IDisposable } from 'cs/base/common/lifecycle';
import { toDisposable } from 'cs/base/common/lifecycle';
import type { URI } from 'cs/base/common/uri';
import type { LocaleMessages } from 'language/locales';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export interface IChatComposerSource {
	readonly id: string;
	readonly order: number;
	readonly icon: LxIconName;
	getLabel(ui: LocaleMessages): string;
	addToComposer(chatResource: URI): Promise<void>;
}

export const IChatComposerSourceService =
	createDecorator<IChatComposerSourceService>('chatComposerSourceService');

export interface IChatComposerSourceService {
	readonly _serviceBrand: undefined;
	registerSource(source: IChatComposerSource): IDisposable;
	getSources(): readonly IChatComposerSource[];
}

export class ChatComposerSourceService implements IChatComposerSourceService {
	declare readonly _serviceBrand: undefined;
	private readonly sources = new Map<string, IChatComposerSource>();

	registerSource(source: IChatComposerSource): IDisposable {
		if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(source.id)) {
			throw new TypeError(`Chat composer source '${source.id}' has an invalid ID.`);
		}
		if (!Number.isSafeInteger(source.order) || source.order < 0) {
			throw new TypeError(`Chat composer source '${source.id}' has an invalid order.`);
		}
		if (this.sources.has(source.id)) {
			throw new Error(`Chat composer source '${source.id}' is already registered.`);
		}
		this.sources.set(source.id, source);
		return toDisposable(() => {
			if (this.sources.get(source.id) !== source) {
				throw new Error(`Chat composer source ownership changed for '${source.id}'.`);
			}
			this.sources.delete(source.id);
		});
	}

	getSources(): readonly IChatComposerSource[] {
		return Object.freeze([...this.sources.values()].sort((left, right) =>
			left.order - right.order || left.id.localeCompare(right.id)));
	}
}

registerSingleton(
	IChatComposerSourceService,
	ChatComposerSourceService,
	InstantiationType.Delayed,
);
