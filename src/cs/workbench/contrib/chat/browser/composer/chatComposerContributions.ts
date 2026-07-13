/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from 'cs/base/common/lifecycle';
import { toDisposable } from 'cs/base/common/lifecycle';
import type { URI } from 'cs/base/common/uri';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { LocaleMessages } from 'language/locales';

export interface IChatComposerContributionView extends IDisposable {
	readonly element: HTMLElement;
}

export interface IChatComposerContributionContext {
	readonly chatResource: URI;
	readonly ui: LocaleMessages;
	readonly isBusy: boolean;
}

export interface IChatComposerContribution {
	readonly id: string;
	readonly order: number;
	createView(context: IChatComposerContributionContext): IChatComposerContributionView;
}

export const IChatComposerContributionService =
	createDecorator<IChatComposerContributionService>('chatComposerContributionService');

export interface IChatComposerContributionService {
	readonly _serviceBrand: undefined;
	registerContribution(contribution: IChatComposerContribution): IDisposable;
	getContributions(): readonly IChatComposerContribution[];
}

export class ChatComposerContributionService implements IChatComposerContributionService {
	declare readonly _serviceBrand: undefined;

	private readonly contributions = new Map<string, IChatComposerContribution>();

	registerContribution(contribution: IChatComposerContribution): IDisposable {
		if (!/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u.test(contribution.id)
			|| contribution.id.length > 128) {
			throw new TypeError(`Chat composer contribution '${contribution.id}' has an invalid ID.`);
		}
		if (!Number.isSafeInteger(contribution.order) || contribution.order < 0) {
			throw new TypeError(`Chat composer contribution '${contribution.id}' has an invalid order.`);
		}
		if (typeof contribution.createView !== 'function') {
			throw new TypeError(`Chat composer contribution '${contribution.id}' is invalid.`);
		}
		if (this.contributions.has(contribution.id)) {
			throw new Error(`Chat composer contribution '${contribution.id}' is already registered.`);
		}
		this.contributions.set(contribution.id, contribution);
		return toDisposable(() => {
			if (this.contributions.get(contribution.id) !== contribution) {
				throw new Error(`Chat composer contribution ownership changed for '${contribution.id}'.`);
			}
			this.contributions.delete(contribution.id);
		});
	}

	getContributions(): readonly IChatComposerContribution[] {
		return Object.freeze([...this.contributions.values()].sort((left, right) =>
			left.order - right.order || left.id.localeCompare(right.id)));
	}
}

registerSingleton(
	IChatComposerContributionService,
	ChatComposerContributionService,
	InstantiationType.Delayed,
);
