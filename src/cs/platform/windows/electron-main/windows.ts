/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow } from 'electron';
import type { BrowserWindowConstructorOptions, WebContents } from 'electron';

import { isCompatFetchEnvEnabled } from 'cs/platform/fetch/node/fetchTiming';
import { WindowMinimumSize } from 'cs/platform/window/common/window';
import {
	applyWindowBackgroundMaterial,
	type IWindowState,
	resolveFramelessTitleBarStyle,
	resolveMainWindowBackgroundColor,
	resolveTitleBarOverlay,
	resolveWindowBackgroundMaterial,
	WindowMode,
} from 'cs/platform/window/electron-main/window';
import { setTrayMainWindow } from 'cs/platform/window/electron-main/trayIcon';
import {
	beginWebContentWindowClose,
	disposeWebContentView,
	ensureWebContentView,
} from 'cs/platform/browserView/electron-main/browserViewMainService';
import {
	resolvePreloadScriptPath,
	resolveWorkbenchRendererFilePath,
	resolveWorkbenchRendererUrl,
} from 'cs/platform/window/electron-main/windowPaths';

let mainWindow: BrowserWindow | null = null;
const auxiliaryWindows = new Set<BrowserWindow>();
const autoMinimizedAuxiliaryWindowIds = new Set<number>();
let currentUseMica = true;
let currentBackgroundColor = '#ffffff';
const AUX_WINDOW_LOG_ENABLED = isCompatFetchEnvEnabled('LS_FETCH_TIMING', 'READER_FETCH_TIMING');
const RENDERER_DEBUG_LOG_ENABLED = process.env.LS_RENDERER_DEBUG === '1';
const SMOKE_TEST_DRIVER_ENABLED = process.argv.includes('--enable-smoke-test-driver');

interface IDefaultBrowserWindowOptions {
	readonly useMica: boolean;
	readonly backgroundColor: string;
}

export interface IMainWindowCloseLifecycle {
	isPrepared(windowId: number): boolean;
	prepare(windowId: number): Promise<void>;
	finalize(windowId: number): void;
}

interface ICreateMainWindowOptions extends IDefaultBrowserWindowOptions {
	readonly windowState: IWindowState;
	readonly closeLifecycle: IMainWindowCloseLifecycle;
}

export function defaultBrowserWindowOptions(
	windowState: IWindowState,
	options: IDefaultBrowserWindowOptions,
): BrowserWindowConstructorOptions {
	return {
		x: windowState.x,
		y: windowState.y,
		width: windowState.width,
		height: windowState.height,
		minWidth: WindowMinimumSize.WIDTH,
		minHeight: WindowMinimumSize.HEIGHT,
		title: 'Comet Studio',
		show: windowState.mode !== WindowMode.Maximized && windowState.mode !== WindowMode.Fullscreen,
		frame: process.platform !== 'darwin' ? false : undefined,
		titleBarStyle: resolveFramelessTitleBarStyle(),
		titleBarOverlay: resolveTitleBarOverlay(),
		...(process.platform === 'darwin' ? { trafficLightPosition: { x: 19, y: 12 } } : {}),
		backgroundColor: resolveMainWindowBackgroundColor(options.useMica, options.backgroundColor),
		backgroundMaterial: resolveWindowBackgroundMaterial(options.useMica),
		autoHideMenuBar: true,
		webPreferences: {
			preload: resolvePreloadScriptPath(),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	};
}

function logAuxiliaryWindow(stage: string, details: Record<string, unknown>) {
	if (!AUX_WINDOW_LOG_ENABLED) {
		return;
	}

	let encodedDetails = '';
	try {
		encodedDetails = JSON.stringify(details);
	} catch {
		encodedDetails = '{"error":"unserializable_log_details"}';
	}

	console.info(`[aux-window] ${stage} ${encodedDetails}`);
}

function getSafeWindowTitle(window: BrowserWindow) {
	try {
		return window.isDestroyed() ? '' : window.getTitle();
	} catch {
		return '';
	}
}

function getSafeWindowUrl(window: BrowserWindow) {
	try {
		return window.isDestroyed() ? '' : window.webContents.getURL();
	} catch {
		return '';
	}
}

function logRendererEvent(
	stage: string,
	window: BrowserWindow,
	details: Record<string, unknown> = {},
) {
	console.info(
		`[renderer:${stage}] ${JSON.stringify({
			id: window.webContents.id,
			title: getSafeWindowTitle(window),
			url: getSafeWindowUrl(window),
			...details,
		})}`,
	);
}

export function getMainWindow() {
	return mainWindow;
}

export function getWindowById(windowId: number) {
	const windows = [
		mainWindow,
		...auxiliaryWindows,
	];

	return windows.find((window) =>
		window &&
		!window.isDestroyed() &&
		window.id === windowId,
	) ?? null;
}

export function applyMainWindowBackgroundMaterial(
	useMica: boolean,
	backgroundColor = currentBackgroundColor,
	window: BrowserWindow | null = mainWindow,
) {
	currentUseMica = useMica;
	currentBackgroundColor = backgroundColor;

	if (!window || window.isDestroyed()) {
		for (const auxiliaryWindow of auxiliaryWindows) {
			applyWindowBackgroundMaterial(auxiliaryWindow, useMica);
		}
		return;
	}

	window.setBackgroundColor(resolveMainWindowBackgroundColor(useMica, backgroundColor));
	applyWindowBackgroundMaterial(window, useMica);

	for (const auxiliaryWindow of auxiliaryWindows) {
		applyWindowBackgroundMaterial(auxiliaryWindow, useMica);
	}
}

function closeAuxiliaryWindows() {
	for (const window of auxiliaryWindows) {
		if (window.isDestroyed()) {
			continue;
		}

		window.close();
	}
}

function minimizeAuxiliaryWindows() {
	autoMinimizedAuxiliaryWindowIds.clear();

	for (const window of auxiliaryWindows) {
		if (window.isDestroyed() || !window.isVisible() || window.isMinimized()) {
			continue;
		}

		autoMinimizedAuxiliaryWindowIds.add(window.webContents.id);
		window.minimize();
	}
}

function restoreAuxiliaryWindows() {
	for (const window of auxiliaryWindows) {
		if (window.isDestroyed()) {
			continue;
		}

		if (!autoMinimizedAuxiliaryWindowIds.has(window.webContents.id)) {
			continue;
		}

		if (window.isMinimized()) {
			window.restore();
		} else if (!window.isVisible()) {
			window.show();
		}
	}

	autoMinimizedAuxiliaryWindowIds.clear();
}

function registerAuxiliaryWindow(window: BrowserWindow) {
	auxiliaryWindows.add(window);
	const webContentsId = window.webContents.id;
	applyWindowBackgroundMaterial(window, currentUseMica);
	let lastKnownTitle = getSafeWindowTitle(window);
	let lastKnownUrl = getSafeWindowUrl(window);

	logAuxiliaryWindow('registered', {
		id: webContentsId,
		title: lastKnownTitle,
		visible: window.isVisible(),
		url: lastKnownUrl,
	});

	window.webContents.on('page-title-updated', () => {
		lastKnownTitle = getSafeWindowTitle(window);
		lastKnownUrl = getSafeWindowUrl(window);
		logAuxiliaryWindow('title_updated', {
			id: webContentsId,
			title: lastKnownTitle,
			url: lastKnownUrl,
		});
	});

	window.webContents.on('did-finish-load', () => {
		lastKnownTitle = getSafeWindowTitle(window);
		lastKnownUrl = getSafeWindowUrl(window);
		logAuxiliaryWindow('did_finish_load', {
			id: webContentsId,
			title: lastKnownTitle,
			url: lastKnownUrl,
		});
	});

	window.on('closed', () => {
		logAuxiliaryWindow('closed', {
			id: webContentsId,
			title: lastKnownTitle,
			url: lastKnownUrl,
		});
		auxiliaryWindows.delete(window);
		autoMinimizedAuxiliaryWindowIds.delete(webContentsId);
	});
}

function wireRendererDiagnostics(window: BrowserWindow) {
	const { webContents } = window;
	const captureDomSnapshot = (stage: string) => {
		void webContents
			.executeJavaScript(
				`(() => {
					const describe = (selector) => {
						const element = document.querySelector(selector);
						if (!element) {
							return { selector, present: false };
						}

						const rect = element.getBoundingClientRect();
						return {
							selector,
							present: true,
							className: element.className,
							childElementCount: element.childElementCount,
							textSample: (element.textContent || '').trim().slice(0, 120),
							width: rect.width,
							height: rect.height,
						};
					};

					return {
						location: window.location.href,
						documentTitle: document.title,
						root: describe('#root'),
						appWindow: describe('.app-window'),
						appShell: describe('.app-shell'),
						workbenchContentLayout: describe('.workbench-content-layout'),
						contentGrid: describe('.content-grid'),
						editorPanel: describe('.panel.web-panel'),
						webFrameContainer: describe('.web-frame-container'),
						settingsRoot: describe('.settings-root'),
					};
				})()`,
				true,
			)
			.then((snapshot) => {
				logRendererEvent(stage, window, { snapshot });
			})
			.catch((error) => {
				logRendererEvent(`${stage}-failed`, window, {
					error: error instanceof Error ? error.message : String(error),
				});
			});
	};

	if (RENDERER_DEBUG_LOG_ENABLED) {
		webContents.on('dom-ready', () => {
			logRendererEvent('dom-ready', window);
		});

		webContents.on('did-finish-load', () => {
			logRendererEvent('did-finish-load', window);
			captureDomSnapshot('dom-snapshot');
			setTimeout(() => captureDomSnapshot('dom-snapshot-1000ms'), 1000);
			setTimeout(() => captureDomSnapshot('dom-snapshot-3000ms'), 3000);
		});
	}

	webContents.on(
		'did-fail-load',
		(_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
			logRendererEvent('did-fail-load', window, {
				errorCode,
				errorDescription,
				validatedURL,
				isMainFrame,
			});
		},
	);

	if (RENDERER_DEBUG_LOG_ENABLED) {
		webContents.on(
			'console-message',
			() => {
				logRendererEvent('console', window);
			},
		);
	}

	webContents.on('render-process-gone', (_event, details) => {
		logRendererEvent('render-process-gone', window, {
			reason: details.reason,
			exitCode: details.exitCode,
		});
	});

	webContents.on('unresponsive', () => {
		logRendererEvent('unresponsive', window);
	});
}

export function createAuxiliaryWindow(options: BrowserWindowConstructorOptions) {
	const window = new BrowserWindow({
		...options,
		backgroundMaterial: resolveWindowBackgroundMaterial(currentUseMica),
	});

	registerAuxiliaryWindow(window);
	return window;
}

export function resolveWindowFromWebContents(contents?: WebContents | null) {
	return (contents ? BrowserWindow.fromWebContents(contents) : null) ?? getMainWindow();
}

function applyMainWindowState(window: BrowserWindow, windowState: IWindowState): void {
	if (windowState.mode === WindowMode.Maximized) {
		window.maximize();
	} else if (windowState.mode === WindowMode.Fullscreen) {
		window.setFullScreen(true);
	}

	if (!window.isVisible()) {
		window.show();
	}
}

export function createMainWindow(options: ICreateMainWindowOptions) {
	const { useMica, backgroundColor, windowState } = options;
	currentBackgroundColor = backgroundColor;
	mainWindow = new BrowserWindow(defaultBrowserWindowOptions(windowState, {
		useMica,
		backgroundColor,
	}));

	const window = mainWindow;
	applyMainWindowBackgroundMaterial(useMica, backgroundColor, window);
	applyMainWindowState(window, windowState);
	wireRendererDiagnostics(window);
	ensureWebContentView(window);
	setTrayMainWindow(window);

	const devUrl = process.env.ELECTRON_RENDERER_URL;
	const rendererQuery: Record<string, string> = SMOKE_TEST_DRIVER_ENABLED
		? { enableSmokeTestDriver: 'true' }
		: {};
	if (devUrl) {
		void window.loadURL(resolveWorkbenchRendererUrl(devUrl, rendererQuery));
	} else {
		void window.loadFile(resolveWorkbenchRendererFilePath(), {
			query: rendererQuery,
		});
	}

	let closePreparation: Promise<void> | undefined;
	window.on('close', event => {
		beginWebContentWindowClose(window);
		closeAuxiliaryWindows();
		if (options.closeLifecycle.isPrepared(window.id)) {
			return;
		}
		event.preventDefault();
		if (!closePreparation) {
			closePreparation = options.closeLifecycle.prepare(window.id);
			void closePreparation.then(
				() => resumeMainWindowClose(window),
				error => {
					console.error(`Failed to prepare window ${window.id} for close.`, error);
					resumeMainWindowClose(window);
				},
			);
		}
	});

	window.on('closed', () => {
		disposeWebContentView(window);
		setTrayMainWindow(null);
		mainWindow = null;
		options.closeLifecycle.finalize(window.id);
	});

	if (typeof window.removeMenu === 'function') {
		window.removeMenu();
	} else {
		window.setMenuBarVisibility(false);
	}

	window.on('minimize', () => minimizeAuxiliaryWindows());
	window.on('restore', () => restoreAuxiliaryWindows());
	window.on('show', () => restoreAuxiliaryWindows());
	return window;
}

function resumeMainWindowClose(window: BrowserWindow): void {
	if (!window.isDestroyed()) {
		window.close();
	}
}
