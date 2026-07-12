/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { onUnexpectedError } from 'cs/base/common/errors';
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

/** Commits one prepared provider registry change to its authoritative consumer. */
export interface IPreparedSessionsProvidersChange extends IDisposable {
	commit(): void;
}

/** Prepares the authoritative consumer before a provider registry change is published. */
export interface ISessionsProvidersChangeParticipant {
	prepareProvidersChange(event: ISessionsProvidersChangeEvent): IPreparedSessionsProvidersChange;
}

export const ISessionsProvidersService = createDecorator<ISessionsProvidersService>('sessionsProvidersService');

/** Registers and resolves Sessions providers without owning their domain state. */
export interface ISessionsProvidersService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeProviders: Event<ISessionsProvidersChangeEvent>;
	registerChangeParticipant(participant: ISessionsProvidersChangeParticipant): IDisposable;
	registerProvider(provider: ISessionsProvider): IDisposable;
	getProviders(): readonly ISessionsProvider[];
	getProvider(providerId: SessionsProviderId): ISessionsProvider | undefined;
}

/** Default application registry for Sessions providers. */
export class SessionsProvidersService extends Disposable implements ISessionsProvidersService {
	declare readonly _serviceBrand: undefined;

	private readonly providers = new Map<SessionsProviderId, ISessionsProvider>();
	private changeParticipant: ISessionsProvidersChangeParticipant | undefined;
	private isApplyingChange = false;
	private readonly changeEmitter = this._register(new Emitter<ISessionsProvidersChangeEvent>({
		onListenerError: onUnexpectedError,
	}));

	readonly onDidChangeProviders = this.changeEmitter.event;

	registerChangeParticipant(participant: ISessionsProvidersChangeParticipant): IDisposable {
		if (this._store.isDisposed) {
			throw new Error('Cannot register a Sessions provider change participant after the registry is disposed.');
		}
		if (this.changeParticipant) {
			throw new Error('A Sessions provider change participant is already registered.');
		}
		this.changeParticipant = participant;
		return toDisposable(() => {
			if (this.changeParticipant === participant) {
				this.changeParticipant = undefined;
			}
		});
	}

	registerProvider(provider: ISessionsProvider): IDisposable {
		if (this._store.isDisposed) {
			throw new Error('Cannot register a Sessions provider after the registry is disposed.');
		}
		assertSessionsProviderId(provider.id);
		if (this.providers.has(provider.id)) {
			throw new Error(`Sessions provider '${provider.id}' is already registered.`);
		}

		this.applyProvidersChange(
			{ added: [provider], removed: [] },
			() => this.providers.set(provider.id, provider),
		);

		return toDisposable(() => {
			if (this.providers.get(provider.id) !== provider) {
				return;
			}
			this.applyProvidersChange(
				{ added: [], removed: [provider] },
				() => this.providers.delete(provider.id),
			);
		});
	}

	getProviders(): readonly ISessionsProvider[] {
		return [...this.providers.values()];
	}

	getProvider(providerId: SessionsProviderId): ISessionsProvider | undefined {
		return this.providers.get(providerId);
	}

	private applyProvidersChange(event: ISessionsProvidersChangeEvent, updateProviders: () => void): void {
		if (this.isApplyingChange) {
			throw new Error('Sessions provider registry changes cannot be nested.');
		}
		this.isApplyingChange = true;
		try {
			const preparedChange = this.changeParticipant?.prepareProvidersChange(event);
			const previousProviders = [...this.providers];
			try {
				updateProviders();
				preparedChange?.commit();
			} catch (error) {
				this.providers.clear();
				for (const [providerId, provider] of previousProviders) {
					this.providers.set(providerId, provider);
				}
				try {
					preparedChange?.dispose();
				} catch (cleanupError) {
					throw new AggregateError(
						[error, cleanupError],
						'Failed to apply and release a Sessions provider registry change.',
					);
				}
				throw error;
			}
			this.changeEmitter.fire(event);
		} finally {
			this.isApplyingChange = false;
		}
	}

	override dispose(): void {
		const removed = [...this.providers.values()];
		if (removed.length > 0) {
			this.applyProvidersChange(
				{ added: [], removed },
				() => this.providers.clear(),
			);
		}
		this.changeParticipant = undefined;
		super.dispose();
	}
}

registerSingleton(ISessionsProvidersService, SessionsProvidersService, InstantiationType.Delayed);
