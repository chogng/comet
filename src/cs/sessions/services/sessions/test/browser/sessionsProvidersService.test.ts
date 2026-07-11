/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Event } from 'cs/base/common/event';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { ThemeIcon } from 'cs/base/common/themables';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import {
	ISessionsProvidersService,
	SessionsProvidersService,
} from 'cs/sessions/services/sessions/browser/sessionsProvidersService';
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
		createSessionDraft: unexpectedProviderOperation,
		discardSessionDraft: unexpectedProviderOperation,
		sendRequest: async () => unexpectedProviderOperation(),
		createChat: async () => unexpectedProviderOperation(),
		forkChat: async () => unexpectedProviderOperation(),
		renameSession: async () => unexpectedProviderOperation(),
		renameChat: async () => unexpectedProviderOperation(),
		setChatModel: async () => unexpectedProviderOperation(),
		setSessionArchived: async () => unexpectedProviderOperation(),
		deleteSession: async () => unexpectedProviderOperation(),
		deleteChat: async () => unexpectedProviderOperation(),
		dispose: onDispose,
	};
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
