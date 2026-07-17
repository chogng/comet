/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Event } from 'cs/base/common/event';
import { errorHandler } from 'cs/base/common/errors';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { ThemeIcon } from 'cs/base/common/themables';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import {
	StorageScope,
	StorageTarget,
	type IStorageService,
} from 'cs/platform/storage/common/storage';
import {
	ISessionsProvidersService,
	SessionsProvidersService,
} from 'cs/sessions/services/sessions/browser/sessionsProvidersService';
import { SessionsManagementService } from 'cs/sessions/services/sessions/browser/sessionsManagementService';
import type { ISessionsProvider } from 'cs/sessions/services/sessions/common/sessionsProvider';

function unexpectedProviderOperation(): never {
	throw new Error('Unexpected Sessions provider operation in registry test.');
}

function createProvider(id: string, onDispose: () => void = () => {}): ISessionsProvider {
	return {
		id,
		label: id,
		sessionTypes: [{
			id: `${id}.default`,
			label: id,
			icon: ThemeIcon.fromId('comment'),
			supportsWorkspaceLess: true,
		}],
		onDidChangeSessionTypes: Event.None,
		onDidChangeSessions: Event.None,
		onDidChangeModels: Event.None,
		getSessions: () => [],
		getModels: () => [],
		prepareSessionType: async () => {},
		createSessionDraft: unexpectedProviderOperation,
		discardSessionDraft: unexpectedProviderOperation,
		sendRequest: async () => unexpectedProviderOperation(),
		createChat: async () => unexpectedProviderOperation(),
		forkChat: async () => unexpectedProviderOperation(),
		renameSession: async () => unexpectedProviderOperation(),
		renameChat: async () => unexpectedProviderOperation(),
		setChatModel: async () => unexpectedProviderOperation(),
		setSessionArchived: async () => unexpectedProviderOperation(),
		releaseSession: async () => unexpectedProviderOperation(),
		releaseChat: async () => unexpectedProviderOperation(),
		cancelTurn: async () => unexpectedProviderOperation(),
		steerTurn: async () => unexpectedProviderOperation(),
		deleteSession: async () => unexpectedProviderOperation(),
		deleteChat: async () => unexpectedProviderOperation(),
		dispose: onDispose,
	};
}

function createStorageService(): IStorageService {
	const values = new Map<string, string>();
	const keyFor = (key: string, scope: StorageScope) => `${scope}:${key}`;
	return {
		_serviceBrand: undefined,
		applicationStorage: undefined,
		onDidChangeValue: Event.None,
		onDidChangeTarget: Event.None,
		onWillSaveState: Event.None,
		init: async () => {},
		close: async () => {},
		get: (key: string, scope: StorageScope, fallbackValue?: string) =>
			values.get(keyFor(key, scope)) ?? fallbackValue,
		getBoolean: (_key: string, _scope: StorageScope, fallbackValue?: boolean) => fallbackValue,
		getNumber: (_key: string, _scope: StorageScope, fallbackValue?: number) => fallbackValue,
		getObject: <T extends object>(_key: string, _scope: StorageScope, fallbackValue?: T) => fallbackValue,
		store: (
			key: string,
			value: string | number | boolean | object | undefined | null,
			scope: StorageScope,
		) => {
			if (typeof value !== 'string') {
				throw new Error('Sessions provider tests store only serialized values.');
			}
			values.set(keyFor(key, scope), value);
		},
		storeAll() {},
		remove: (key: string, scope: StorageScope) => values.delete(keyFor(key, scope)),
		keys: (scope: StorageScope, _target: StorageTarget) => [...values.keys()]
			.filter(key => key.startsWith(`${scope}:`))
			.map(key => key.slice(`${scope}:`.length)),
		log() {},
		optimize: async () => {},
		flush: async () => {},
	} as unknown as IStorageService;
}

test('Sessions provider service is registered exactly once', () => {
	const registrations = getSingletonServiceDescriptors().filter(([id]) => id === ISessionsProvidersService);
	assert.equal(registrations.length, 1);
});

test('Sessions provider registry owns registration identity and change events', () => {
	const store = new DisposableStore();
	const service = store.add(new SessionsProvidersService());
	const changes: Array<{ added: readonly string[]; removed: readonly string[] }> = [];
	store.add(service.onDidChangeProviders(event => {
		changes.push({
			added: event.added.map(provider => provider.id),
			removed: event.removed.map(provider => provider.id),
		});
	}));
	const first = createProvider('provider.first');
	let providerDisposeCount = 0;
	const second = createProvider('provider.second', () => {
		providerDisposeCount += 1;
	});
	const firstRegistration = store.add(service.registerProvider(first));
	store.add(service.registerProvider(second));

	try {
		assert.deepEqual(service.getProviders(), [first, second]);
		assert.equal(service.getProvider(first.id), first);
		assert.throws(
			() => service.registerProvider(createProvider(first.id)),
			/already registered/,
		);
		assert.throws(
			() => service.registerProvider(createProvider('')),
			/non-empty and contain no whitespace/,
		);
		assert.throws(
			() => service.registerProvider(createProvider('provider with spaces')),
			/non-empty and contain no whitespace/,
		);

		firstRegistration.dispose();
		firstRegistration.dispose();
		const replacement = createProvider(first.id);
		store.add(service.registerProvider(replacement));
		assert.deepEqual(service.getProviders(), [second, replacement]);

		service.dispose();
		assert.deepEqual(service.getProviders(), []);
		assert.equal(providerDisposeCount, 0);
		assert.throws(
			() => service.registerProvider(createProvider('provider.after-dispose')),
			/registry is disposed/,
		);
		assert.deepEqual(changes, [
			{ added: [first.id], removed: [] },
			{ added: [second.id], removed: [] },
			{ added: [], removed: [first.id] },
			{ added: [replacement.id], removed: [] },
			{ added: [], removed: [second.id, replacement.id] },
		]);
	} finally {
		store.dispose();
	}
});

test('Sessions provider contribution unregisters before disposing its provider', () => {
	const service = new SessionsProvidersService();
	const owner = new DisposableStore();
	const disposalOrder: string[] = [];
	const provider = owner.add(createProvider('provider.owned', () => {
		disposalOrder.push('provider');
	}));
	service.onDidChangeProviders(event => {
		if (event.removed.includes(provider)) {
			disposalOrder.push('registration');
		}
	});
	owner.add(service.registerProvider(provider));

	owner.dispose();

	assert.deepEqual(disposalOrder, ['registration', 'provider']);
	assert.deepEqual(service.getProviders(), []);
	service.dispose();
});

test('Sessions provider registry rejects an invalid dynamic provider without splitting management state', () => {
	const store = new DisposableStore();
	const service = store.add(new SessionsProvidersService());
	const management = store.add(new SessionsManagementService(
		service,
		createStorageService(),
	));
	const changes: string[] = [];
	store.add(service.onDidChangeProviders(event => {
		changes.push(...event.added.map(provider => `added:${provider.id}`));
		changes.push(...event.removed.map(provider => `removed:${provider.id}`));
	}));
	const providerId = 'provider.invalid-dynamic';
	const sessionType = createProvider(providerId).sessionTypes[0];
	const invalidProvider: ISessionsProvider = {
		...createProvider(providerId),
		sessionTypes: [sessionType, sessionType],
	};

	assert.throws(
		() => service.registerProvider(invalidProvider),
		/duplicate Session type/,
	);
	assert.equal(service.getProvider(providerId), undefined);
	assert.deepEqual(service.getProviders(), []);
	assert.deepEqual(management.getSessions(), []);
	assert.deepEqual(management.sessionTypes.get(), []);
	assert.deepEqual(changes, []);

	const validProvider = createProvider(providerId);
	store.add(service.registerProvider(validProvider));
	assert.equal(service.getProvider(providerId), validProvider);
	assert.deepEqual(
		management.sessionTypes.get().map(entry => entry.providerId),
		[providerId],
	);
});

test('Sessions provider observer errors do not interrupt registry and management transitions', () => {
	const store = new DisposableStore();
	const service = store.add(new SessionsProvidersService());
	const observerErrors: unknown[] = [];
	const previousUnexpectedErrorHandler = errorHandler.getUnexpectedErrorHandler();
	errorHandler.setUnexpectedErrorHandler(error => observerErrors.push(error));

	try {
		const observerError = new Error('Sessions provider observer failed.');
		const managementObserverError = new Error('Sessions management observer failed.');
		store.add(service.onDidChangeProviders(() => {
			throw observerError;
		}));
			const management = store.add(new SessionsManagementService(
				service,
				createStorageService(),
			));
		store.add(management.onDidChangeSessionTypes(() => {
			throw managementObserverError;
		}));
		const providerOwner = store.add(new DisposableStore());
		const disposalOrder: string[] = [];
		let providerDisposeCount = 0;
		const provider = providerOwner.add(createProvider('provider.observer-error', () => {
			providerDisposeCount += 1;
			disposalOrder.push('provider');
		}));
		store.add(service.onDidChangeProviders(event => {
			if (event.removed.includes(provider)) {
				disposalOrder.push('registration');
			}
		}));
		providerOwner.add(service.registerProvider(provider));

		assert.equal(service.getProvider(provider.id), provider);
		assert.deepEqual(
			management.sessionTypes.get().map(entry => entry.providerId),
			[provider.id],
		);
		assert.deepEqual(observerErrors, [managementObserverError, observerError]);

		providerOwner.dispose();

		assert.equal(service.getProvider(provider.id), undefined);
		assert.deepEqual(management.sessionTypes.get(), []);
		assert.equal(providerDisposeCount, 1);
		assert.deepEqual(disposalOrder, ['registration', 'provider']);
		assert.deepEqual(observerErrors, [
			managementObserverError,
			observerError,
			managementObserverError,
			observerError,
		]);
	} finally {
		try {
			store.dispose();
		} finally {
			errorHandler.setUnexpectedErrorHandler(previousUnexpectedErrorHandler);
		}
	}
});
