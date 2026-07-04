/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import type {
	ElectronAPI,
	ElectronWebContentApi,
} from 'cs/base/parts/sandbox/common/electronTypes';
import { EMPTY_WEB_CONTENT_STATE } from 'cs/workbench/services/webContent/webContentNavigationService';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

type TestWindow = Window & {
	electronAPI?: ElectronAPI;
};

let cleanupDomEnvironment: (() => void) | null = null;
let BrowserWorkbenchEnvironmentService: typeof import('cs/workbench/services/environment/browser/environmentService').BrowserWorkbenchEnvironmentService;
let originalElectronApi: ElectronAPI | undefined;

function setElectronApi(electronAPI: ElectronAPI | undefined) {
	const testWindow = window as TestWindow;
	if (!electronAPI) {
		Reflect.deleteProperty(testWindow, 'electronAPI');
		return;
	}

	Object.defineProperty(testWindow, 'electronAPI', {
		configurable: true,
		writable: true,
		value: electronAPI,
	});
}

function createElectronApi(overrides: Partial<ElectronAPI> = {}): ElectronAPI {
	return {
		invoke: (async () => undefined) as ElectronAPI['invoke'],
		...overrides,
	};
}

function createWebContentApi(): ElectronWebContentApi {
	return {
		activate: () => {},
		dispose: () => {},
		release: () => {},
		navigate: async () => EMPTY_WEB_CONTENT_STATE,
		getState: async () => EMPTY_WEB_CONTENT_STATE,
		setBounds: () => {},
		setVisible: () => {},
		setLayoutPhase: () => {},
		setRetentionLimit: () => {},
		clearHistory: () => {},
		hardReload: () => {},
		reload: () => {},
		goBack: () => {},
		goForward: () => {},
		getSelection: async () => null,
		onStateChange: () => () => {},
	};
}

before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	originalElectronApi = (window as TestWindow).electronAPI;
	({ BrowserWorkbenchEnvironmentService } = await import('cs/workbench/services/environment/browser/environmentService'));
});

afterEach(() => {
	setElectronApi(originalElectronApi);
});

after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = null;
});

test('BrowserWorkbenchEnvironmentService reports web runtime without the desktop bridge', () => {
	setElectronApi(undefined);

	const service = new BrowserWorkbenchEnvironmentService();

	assert.equal(service.runtimeKind, 'web');
	assert.equal(service.webContentRuntime, false);
});

test('BrowserWorkbenchEnvironmentService requires the BrowserView bridge for web content runtime', () => {
	setElectronApi(createElectronApi());

	const service = new BrowserWorkbenchEnvironmentService();

	assert.equal(service.runtimeKind, 'desktop');
	assert.equal(service.webContentRuntime, false);
});

test('BrowserWorkbenchEnvironmentService reports web content runtime when BrowserView navigation is exposed', () => {
	setElectronApi(createElectronApi({
		webContent: createWebContentApi(),
	}));

	const service = new BrowserWorkbenchEnvironmentService();

	assert.equal(service.runtimeKind, 'desktop');
	assert.equal(service.webContentRuntime, true);
});
