/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import {
	assertSessionsProviderId,
	type SessionsProviderId,
} from 'cs/sessions/services/sessions/common/session';
import type { ISessionsProvider } from 'cs/sessions/services/sessions/common/sessionsProvider';

/** Describes providers added to or removed from the registry. */
export interface ISessionsProvidersChangeEvent {
	readonly added: readonly ISessionsProvider[];
	readonly removed: readonly ISessionsProvider[];
}

export const ISessionsProvidersService = createDecorator<ISessionsProvidersService>('sessionsProvidersService');

/** Registers and resolves Sessions providers without owning their domain state. */
export interface ISessionsProvidersService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeProviders: Event<ISessionsProvidersChangeEvent>;
	registerProvider(provider: ISessionsProvider): IDisposable;
	getProviders(): readonly ISessionsProvider[];
	getProvider(providerId: SessionsProviderId): ISessionsProvider | undefined;
}

/** Default application registry for Sessions providers. */
export class SessionsProvidersService extends Disposable implements ISessionsProvidersService {
	declare readonly _serviceBrand: undefined;

	private readonly providers = new Map<SessionsProviderId, ISessionsProvider>();
	private readonly changeEmitter = this._register(new Emitter<ISessionsProvidersChangeEvent>());

	readonly onDidChangeProviders = this.changeEmitter.event;

	registerProvider(provider: ISessionsProvider): IDisposable {
		if (this._store.isDisposed) {
			throw new Error('Cannot register a Sessions provider after the registry is disposed.');
		}
		assertSessionsProviderId(provider.id);
		if (this.providers.has(provider.id)) {
			throw new Error(`Sessions provider '${provider.id}' is already registered.`);
		}

		this.providers.set(provider.id, provider);
		this.changeEmitter.fire({ added: [provider], removed: [] });

		return toDisposable(() => {
			if (this.providers.get(provider.id) !== provider) {
				return;
			}
			this.providers.delete(provider.id);
			this.changeEmitter.fire({ added: [], removed: [provider] });
		});
	}

	getProviders(): readonly ISessionsProvider[] {
		return [...this.providers.values()];
	}

	getProvider(providerId: SessionsProviderId): ISessionsProvider | undefined {
		return this.providers.get(providerId);
	}

	override dispose(): void {
		const removed = [...this.providers.values()];
		this.providers.clear();
		if (removed.length > 0) {
			this.changeEmitter.fire({ added: [], removed });
		}
		super.dispose();
	}
}

registerSingleton(ISessionsProvidersService, SessionsProvidersService, InstantiationType.Delayed);
