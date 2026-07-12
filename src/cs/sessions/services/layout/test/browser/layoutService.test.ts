/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { Event } from 'cs/base/common/event';
import {
	StorageScope,
	StorageTarget,
	type IStorageService,
} from 'cs/platform/storage/common/storage';
import {
	registerSessionsLayoutPolicy,
	type ISessionsLayoutPolicy,
	type ISessionsLayoutState,
} from 'cs/sessions/services/layout/browser/layoutPolicy';
import { SessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';

class TestSessionsLayoutPolicy implements ISessionsLayoutPolicy {
	declare readonly _serviceBrand: undefined;

	createInitialState(): ISessionsLayoutState {
		return {
			mode: 'agent',
			isSidebarVisible: true,
			sidebarSize: 250,
			isEditorCollapsed: true,
			expandedEditorSize: 420,
		};
	}

	arrange(_viewport: { readonly width: number; readonly height: number }, state: ISessionsLayoutState): ISessionsLayoutState {
		return {
			...state,
			sidebarSize: Math.max(220, Math.round(state.sidebarSize)),
			expandedEditorSize: Math.max(420, Math.round(state.expandedEditorSize)),
		};
	}
}

function createStorageService(initialValue?: object | string, storeError?: Error) {
	const values = new Map<string, string>();
	if (initialValue !== undefined) {
		values.set(
			`${StorageScope.APPLICATION}:sessions.layoutState`,
			typeof initialValue === 'string' ? initialValue : JSON.stringify(initialValue),
		);
	}
	const keyFor = (key: string, scope: StorageScope) => `${scope}:${key}`;
	const service = {
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
		store: (key: string, value: string | number | boolean | object | undefined | null, scope: StorageScope, _target: StorageTarget) => {
			if (storeError) {
				throw storeError;
			}
			if (typeof value !== 'object' || value === null) {
				throw new Error('Sessions layout tests store only object values.');
			}
			values.set(keyFor(key, scope), JSON.stringify(value));
		},
		storeAll() {},
		remove: (key: string, scope: StorageScope) => values.delete(keyFor(key, scope)),
		keys: (scope: StorageScope, _target: StorageTarget) => [...values.keys()]
			.filter(key => key.startsWith(`${scope}:`))
			.map(key => key.slice(`${scope}:`.length)),
		log() {},
		optimize: async () => {},
		flush: async () => {},
		read: () => {
			const value = values.get(`${StorageScope.APPLICATION}:sessions.layoutState`);
			return value === undefined ? undefined : JSON.parse(value) as object;
		},
	};
	return service as unknown as IStorageService & { readonly read: () => object | undefined };
}

test('SessionsLayoutService owns layout operations and persistence', () => {
	const storage = createStorageService();
	const service = new SessionsLayoutService(new TestSessionsLayoutPolicy(), storage);
	const observed: object[] = [];
	const listener = service.onDidChangeLayoutState(state => observed.push(state));
	try {
		service.setSidebarVisible(false);
		service.setPartSizes({ sidebarSize: 311.8, editorSize: 516.2 });
		service.applyLayoutMode('flow');

		assert.deepStrictEqual({
			state: service.getLayoutState(),
			eventCount: observed.length,
			stored: storage.read(),
		}, {
			state: {
				mode: 'flow',
				isSidebarVisible: true,
				sidebarSize: 312,
				isEditorCollapsed: false,
				expandedEditorSize: 516,
			},
			eventCount: 3,
			stored: {
				version: 1,
				state: {
					mode: 'flow',
					isSidebarVisible: true,
					sidebarSize: 312,
					isEditorCollapsed: false,
					expandedEditorSize: 516,
				},
			},
		});
	} finally {
		listener.dispose();
		service.dispose();
	}
});

test('SessionsLayoutService applies startup layout only before authoritative layout state exists', () => {
	const initialService = new SessionsLayoutService(
		new TestSessionsLayoutPolicy(),
		createStorageService(),
	);
	const mutatedService = new SessionsLayoutService(
		new TestSessionsLayoutPolicy(),
		createStorageService(),
	);
	const restoredService = new SessionsLayoutService(
		new TestSessionsLayoutPolicy(),
		createStorageService({
			version: 1,
			state: {
				mode: 'flow',
				isSidebarVisible: false,
				sidebarSize: 312,
				isEditorCollapsed: false,
				expandedEditorSize: 516,
			},
		}),
	);

	try {
		assert.equal(initialService.applyStartupLayoutMode('flow'), true);
		assert.equal(initialService.getLayoutState().mode, 'flow');

		mutatedService.setSidebarVisible(false);
		assert.equal(mutatedService.applyStartupLayoutMode('flow'), false);
		assert.deepEqual(mutatedService.getLayoutState(), {
			mode: 'agent',
			isSidebarVisible: false,
			sidebarSize: 250,
			isEditorCollapsed: true,
			expandedEditorSize: 420,
		});

		assert.equal(restoredService.applyStartupLayoutMode('agent'), false);
		assert.deepEqual(restoredService.getLayoutState(), {
			mode: 'flow',
			isSidebarVisible: false,
			sidebarSize: 312,
			isEditorCollapsed: false,
			expandedEditorSize: 516,
		});
	} finally {
		initialService.dispose();
		mutatedService.dispose();
		restoredService.dispose();
	}
});

test('SessionsLayoutService leaves memory and startup eligibility unchanged when persistence fails', () => {
	const service = new SessionsLayoutService(
		new TestSessionsLayoutPolicy(),
		createStorageService(undefined, new Error('Storage failed')),
	);
	const observed: ISessionsLayoutState[] = [];
	const listener = service.onDidChangeLayoutState(state => observed.push(state));

	try {
		assert.throws(() => service.setSidebarVisible(false), /Storage failed/);
		assert.deepEqual(service.getLayoutState(), {
			mode: 'agent',
			isSidebarVisible: true,
			sidebarSize: 250,
			isEditorCollapsed: true,
			expandedEditorSize: 420,
		});
		assert.deepEqual(observed, []);
		assert.throws(() => service.applyStartupLayoutMode('flow'), /Storage failed/);
		assert.equal(service.getLayoutState().mode, 'agent');
	} finally {
		listener.dispose();
		service.dispose();
	}
});

test('SessionsLayoutService rejects malformed persisted state', () => {
	const storage = createStorageService({
		version: 1,
		state: {
			mode: 'agent',
			isSidebarVisible: true,
			sidebarSize: 'wide',
			isEditorCollapsed: true,
			expandedEditorSize: 420,
		},
	});

	assert.throws(
		() => new SessionsLayoutService(new TestSessionsLayoutPolicy(), storage),
		/Invalid Sessions layout state/,
	);
});

test('SessionsLayoutService rejects malformed persisted JSON', () => {
	assert.throws(
		() => new SessionsLayoutService(
			new TestSessionsLayoutPolicy(),
			createStorageService('{invalid'),
		),
		/Invalid persisted Sessions layout state/,
	);
});

test('SessionsLayoutService exposes immutable snapshots', () => {
	const service = new SessionsLayoutService(
		new TestSessionsLayoutPolicy(),
		createStorageService(),
	);
	try {
		const snapshot = service.getLayoutState();
		assert.deepStrictEqual({
			isFrozen: Object.isFrozen(snapshot),
			didMutate: Reflect.set(snapshot, 'isSidebarVisible', false),
			state: service.getLayoutState(),
		}, {
			isFrozen: true,
			didMutate: false,
			state: {
				mode: 'agent',
				isSidebarVisible: true,
				sidebarSize: 250,
				isEditorCollapsed: true,
				expandedEditorSize: 420,
			},
		});
	} finally {
		service.dispose();
	}
});

test('Sessions layout policy registration rejects duplicates', () => {
	registerSessionsLayoutPolicy(TestSessionsLayoutPolicy);
	assert.throws(
		() => registerSessionsLayoutPolicy(TestSessionsLayoutPolicy),
		/A Sessions layout policy is already registered/,
	);
});
