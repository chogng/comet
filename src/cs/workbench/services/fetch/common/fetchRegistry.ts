/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { JournalDescriptor, FetchProviderId, JournalId } from 'cs/workbench/services/fetch/common/fetch';
import type { IFetchProvider } from 'cs/workbench/services/fetch/common/fetchProvider';

export type FetchProviderConstructor = new (...args: never[]) => IFetchProvider;

export interface FetchProviderDescriptor {
	readonly id: FetchProviderId;
	readonly ctor: FetchProviderConstructor;
}

export interface IFetchRegistry {
	readonly _serviceBrand: undefined;
	registerJournal(descriptor: JournalDescriptor): IDisposable;
	registerProvider(descriptor: FetchProviderDescriptor): IDisposable;
	getJournal(journalId: JournalId): JournalDescriptor | undefined;
	getJournals(): readonly JournalDescriptor[];
	getProviderDescriptor(providerId: FetchProviderId): FetchProviderDescriptor | undefined;
}

export const IFetchRegistry = createDecorator<IFetchRegistry>('fetchRegistry');

export class FetchRegistry implements IFetchRegistry {
	declare readonly _serviceBrand: undefined;

	private readonly journals = new Map<JournalId, JournalDescriptor>();
	private readonly providers = new Map<FetchProviderId, FetchProviderDescriptor>();

	registerJournal(descriptor: JournalDescriptor): IDisposable {
		if (this.journals.has(descriptor.id)) {
			throw new Error(`Journal "${descriptor.id}" is already registered.`);
		}
		this.journals.set(descriptor.id, descriptor);
		return toDisposable(() => {
			if (this.journals.get(descriptor.id) === descriptor) {
				this.journals.delete(descriptor.id);
			}
		});
	}

	registerProvider(descriptor: FetchProviderDescriptor): IDisposable {
		if (this.providers.has(descriptor.id)) {
			throw new Error(`Fetch provider "${descriptor.id}" is already registered.`);
		}
		this.providers.set(descriptor.id, descriptor);
		return toDisposable(() => {
			if (this.providers.get(descriptor.id) === descriptor) {
				this.providers.delete(descriptor.id);
			}
		});
	}

	getJournal(journalId: JournalId): JournalDescriptor | undefined {
		return this.journals.get(journalId);
	}

	getJournals(): readonly JournalDescriptor[] {
		return [...this.journals.values()].sort((left, right) =>
			left.id < right.id ? -1 : left.id > right.id ? 1 : 0
		);
	}

	getProviderDescriptor(providerId: FetchProviderId): FetchProviderDescriptor | undefined {
		return this.providers.get(providerId);
	}
}
