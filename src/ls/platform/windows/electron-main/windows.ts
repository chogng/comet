/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow } from 'electron';
import type { BrowserWindowConstructorOptions, WebContents } from 'electron';

import { isCompatFetchEnvEnabled } from 'ls/code/electron-main/fetchTiming';
import {
	applyWindowBackgroundMaterial,
	resolveFramelessTitleBarStyle,
	resolveMainWindowBackgroundColor,
	resolveTitleBarOverlay,
	resolveWindowBackgroundMaterial,
} from 'ls/platform/window/electron-main/window';
import { disposeToastOverlay } from 'ls/platform/window/electron-main/toastOverlayView';
import { setTrayMainWindow } from 'ls/platform/window/electron-main/trayIcon';
import { disposeWebContentView, ensureWebContentView } from 'ls/platform/window/electron-main/webContentView';
import {
	resolvePreloadScriptPath,
	resolveWorkbenchRendererFilePath,
	resolveWorkbenchRendererUrl,
} from 'ls/platform/window/electron-main/windowPaths';

let mainWindow: BrowserWindow | null = null;
const auxiliaryWindows = new Set<BrowserWindow>();
const autoMinimizedAuxiliaryWindowIds = new Set<number>();
let currentUseMica = true;
let currentBackgroundColor = '#ffffff';
const AUX_WINDOW_LOG_ENABLED = isCompatFetchEnvEnabled('LS_FETCH_TIMING', 'READER_FETCH_TIMING');
const RENDERER_DEBUG_LOG_ENABLED = process.env.LS_RENDERER_DEBUG === '1';

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
						bootstrapStatus: describe('.bootstrap-status'),
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

export function createMainWindow(options: { useMica?: boolean; backgroundColor?: string } = {}) {
	const useMica = options.useMica ?? true;
	const backgroundColor = options.backgroundColor ?? currentBackgroundColor;
	currentBackgroundColor = backgroundColor;
	mainWindow = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 1080,
		minHeight: 680,
		title: 'Literature Studio',
		frame: process.platform !== 'darwin' ? false : undefined,
		titleBarStyle: resolveFramelessTitleBarStyle(),
		titleBarOverlay: resolveTitleBarOverlay(),
		...(process.platform === 'darwin' ? { trafficLightPosition: { x: 13, y: 11 } } : {}),
		backgroundColor: resolveMainWindowBackgroundColor(useMica, backgroundColor),
		backgroundMaterial: resolveWindowBackgroundMaterial(useMica),
		autoHideMenuBar: true,
		webPreferences: {
			preload: resolvePreloadScriptPath(),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			webviewTag: true,
		},
	});

	const window = mainWindow;
	applyMainWindowBackgroundMaterial(useMica, backgroundColor, window);
	wireRendererDiagnostics(window);
	ensureWebContentView(window);
	setTrayMainWindow(window);

	const devUrl = process.env.ELECTRON_RENDERER_URL;
	if (devUrl) {
		void window.loadURL(resolveWorkbenchRendererUrl(devUrl));
	} else {
		void window.loadFile(resolveWorkbenchRendererFilePath());
	}

	window.on('close', () => {
		closeAuxiliaryWindows();
		disposeToastOverlay(window);
		disposeWebContentView(window);
	});

	window.on('closed', () => {
		setTrayMainWindow(null);
		mainWindow = null;
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
