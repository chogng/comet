/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getRuntimeMode, getRuntimePlatform } from 'cs/base/common/platform';
import type { RuntimeMode, RuntimePlatform } from 'cs/base/common/platform';

export type WindowChromeTitleBarStyle = 'native' | 'custom';
export type WindowControlsContainerMode = 'none' | 'native';

export type WindowChromeLayout = {
	mode: RuntimeMode;
	platform: RuntimePlatform;
	titleBarStyle: WindowChromeTitleBarStyle;
	nativeWindowControlsOverlay: boolean;
	windowControlsContainerMode: WindowControlsContainerMode;
	titlebarHeightPx: number;
	leadingWindowControlsWidthPx: number;
	trailingWindowControlsWidthPx: number;
};

const MACOS_WINDOW_CONTROLS_WIDTH_PX = 70;
const WINDOWS_WINDOW_CONTROLS_WIDTH_PX = 138;
export const WORKBENCH_TITLEBAR_HEIGHT_PX = 40;

export const WindowMinimumSize = {
	WIDTH: 400,
	WIDTH_WITH_VERTICAL_PANEL: 600,
	HEIGHT: 270,
} as const;

export const DEFAULT_EMPTY_WINDOW_SIZE = { width: 1200, height: 800 } as const;
export const DEFAULT_WORKSPACE_WINDOW_SIZE = { width: 1440, height: 900 } as const;
export const DEFAULT_AUX_WINDOW_SIZE = { width: 1024, height: 768 } as const;

export function zoomLevelToZoomFactor(zoomLevel = 0): number {
	return 1.2 ** zoomLevel;
}

export function getWindowChromeLayout(): WindowChromeLayout {
	const mode = getRuntimeMode();
	const platform = getRuntimePlatform();
	const titleBarStyle: WindowChromeTitleBarStyle = 'custom';
	const nativeWindowControlsOverlay =
		mode === 'desktop' &&
		titleBarStyle === 'custom' &&
		platform === 'windows';
	const windowControlsContainerMode: WindowControlsContainerMode =
		mode === 'desktop' &&
		titleBarStyle === 'custom' &&
		platform === 'macos'
			? 'native'
			: 'none';

	return {
		mode,
		platform,
		titleBarStyle,
		nativeWindowControlsOverlay,
		windowControlsContainerMode,
		titlebarHeightPx: WORKBENCH_TITLEBAR_HEIGHT_PX,
		leadingWindowControlsWidthPx:
			windowControlsContainerMode === 'native' ? MACOS_WINDOW_CONTROLS_WIDTH_PX : 0,
		trailingWindowControlsWidthPx: nativeWindowControlsOverlay
			? WINDOWS_WINDOW_CONTROLS_WIDTH_PX
			: 0,
	};
}
