/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BrowserWindow } from 'electron';

import type { WindowState } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { DEFAULT_EMPTY_WINDOW_SIZE, DEFAULT_WORKSPACE_WINDOW_SIZE } from 'cs/platform/window/common/window';

export enum WindowMode {
	Normal = 0,
	Maximized,
	Fullscreen,
}

export interface IWindowState {
	width?: number;
	height?: number;
	x?: number;
	y?: number;
	mode?: WindowMode;
	zoomLevel?: number;
	readonly display?: number;
}

export function defaultWindowState(mode = WindowMode.Normal, hasWorkspace = false): IWindowState {
	const size = hasWorkspace ? DEFAULT_WORKSPACE_WINDOW_SIZE : DEFAULT_EMPTY_WINDOW_SIZE;
	return {
		width: size.width,
		height: size.height,
		mode,
	};
}

export function serializeBrowserWindowState(window: BrowserWindow): IWindowState {
	const bounds = window.getBounds();
	let mode = WindowMode.Normal;
	if (window.isFullScreen()) {
		mode = WindowMode.Fullscreen;
	} else if (window.isMaximized()) {
		mode = WindowMode.Maximized;
	}

	return {
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		mode,
	};
}

export function resolveWindowBackgroundMaterial(useMica: boolean) {
	if (process.platform !== 'win32') {
		return 'auto' as const;
	}

	return useMica ? ('mica' as const) : ('none' as const);
}

function resolveWindowVibrancy(useMica: boolean) {
	if (process.platform !== 'darwin' || !useMica) {
		return null;
	}

	return 'sidebar' as const;
}

export function resolveMainWindowBackgroundColor(
	useMica: boolean,
	backgroundColor: string,
) {
	if (process.platform === 'darwin' && useMica) {
		return '#00000000';
	}

	return backgroundColor;
}

export function resolveFramelessTitleBarStyle() {
	return process.platform === 'darwin' || process.platform === 'win32'
		? ('hidden' as const)
		: ('default' as const);
}

export function resolveTitleBarOverlay() {
	if (process.platform !== 'win32') {
		return false;
	}

	return {
		color: '#00000000',
		symbolColor: '#1f2d3a',
		height: 38,
	} as const;
}

export function applyWindowBackgroundMaterial(
	window: BrowserWindow,
	useMica: boolean,
) {
	if (window.isDestroyed()) {
		return;
	}

	window.setBackgroundMaterial(resolveWindowBackgroundMaterial(useMica));
	if (process.platform === 'darwin') {
		window.setVibrancy(resolveWindowVibrancy(useMica));
	}
}

export function getWindowState(window?: BrowserWindow | null): WindowState {
	return {
		isMaximized: Boolean(window && !window.isDestroyed() && window.isMaximized()),
		isFullscreen: Boolean(window && !window.isDestroyed() && window.isFullScreen()),
	};
}
