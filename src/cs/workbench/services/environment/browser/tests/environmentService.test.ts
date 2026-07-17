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
import type { WebContentState } from 'cs/platform/browserView/common/browserView';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';

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
	const emptyState: WebContentState = {
		targetId: null,
		activeTargetId: null,
		ownership: 'inactive',
		layoutPhase: 'hidden',
		url: '',
		canGoBack: false,
		canGoForward: false,
		isLoading: false,
		visible: false,
	};
	return {
		activate: () => {},
		dispose: () => {},
		release: () => {},
		navigate: async () => emptyState,
		getState: async () => emptyState,
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
		captureScreenshot: async () => null,
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
