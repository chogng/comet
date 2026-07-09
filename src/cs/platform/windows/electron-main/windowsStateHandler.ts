/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { screen } from 'electron';
import type { BrowserWindow, Display, Rectangle } from 'electron';

import type { IStorageService } from 'cs/platform/storage/common/storage';
import {
	StorageScope,
	StorageTarget,
} from 'cs/platform/storage/common/storage';
import {
	defaultWindowState,
	type IWindowState,
	serializeBrowserWindowState,
} from 'cs/platform/window/electron-main/window';

interface ISerializedWindowState {
	readonly uiState: IWindowState;
}

interface ISerializedWindowsState {
	readonly lastActiveWindow?: ISerializedWindowState;
}

export class WindowsStateHandler {
	private static readonly windowsStateStorageKey = 'windowsState';

	constructor(private readonly storageService: IStorageService) {}

	getNewWindowState(): IWindowState {
		const storedWindowState = this.getStoredWindowState();
		if (storedWindowState) {
			return storedWindowState;
		}

		return this.createDefaultWindowState();
	}

	saveWindowState(window: BrowserWindow): void {
		if (window.isDestroyed()) {
			return;
		}

		this.storageService.store(
			WindowsStateHandler.windowsStateStorageKey,
			{
				lastActiveWindow: {
					uiState: serializeBrowserWindowState(window),
				},
			},
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
	}

	private getStoredWindowState(): IWindowState | undefined {
		const windowsState = this.storageService.getObject<ISerializedWindowsState>(
			WindowsStateHandler.windowsStateStorageKey,
			StorageScope.APPLICATION,
		);
		const windowState = windowsState?.lastActiveWindow?.uiState;
		if (!windowState) {
			return undefined;
		}

		return this.validateWindowState(windowState);
	}

	private createDefaultWindowState(): IWindowState {
		const display = screen.getPrimaryDisplay();
		const state = defaultWindowState();
		state.x = Math.round(display.bounds.x + (display.bounds.width / 2) - (state.width! / 2));
		state.y = Math.round(display.bounds.y + (display.bounds.height / 2) - (state.height! / 2));
		return state;
	}

	private validateWindowState(state: IWindowState): IWindowState | undefined {
		if (
			typeof state.x !== 'number' ||
			typeof state.y !== 'number' ||
			typeof state.width !== 'number' ||
			typeof state.height !== 'number' ||
			state.width <= 0 ||
			state.height <= 0
		) {
			return undefined;
		}

		const displays = screen.getAllDisplays();
		if (displays.length === 1) {
			return this.validateSingleDisplayWindowState(state, displays[0]);
		}

		const display = screen.getDisplayMatching({
			x: state.x,
			y: state.y,
			width: state.width,
			height: state.height,
		});

		return this.isWindowStateOnDisplay(state, display) ? state : undefined;
	}

	private validateSingleDisplayWindowState(state: IWindowState, display: Display): IWindowState | undefined {
		const displayWorkingArea = getWorkingArea(display);
		if (!displayWorkingArea) {
			return undefined;
		}

		const nextState = { ...state };
		nextState.x = Math.max(nextState.x!, displayWorkingArea.x);
		nextState.y = Math.max(nextState.y!, displayWorkingArea.y);
		nextState.width = Math.min(nextState.width!, displayWorkingArea.width);
		nextState.height = Math.min(nextState.height!, displayWorkingArea.height);

		if (nextState.x > displayWorkingArea.x + displayWorkingArea.width - 128) {
			nextState.x = displayWorkingArea.x + displayWorkingArea.width - nextState.width;
		}

		if (nextState.y > displayWorkingArea.y + displayWorkingArea.height - 128) {
			nextState.y = displayWorkingArea.y + displayWorkingArea.height - nextState.height;
		}

		nextState.x = Math.max(nextState.x, displayWorkingArea.x);
		nextState.y = Math.max(nextState.y, displayWorkingArea.y);
		return nextState;
	}

	private isWindowStateOnDisplay(state: IWindowState, display: Display): boolean {
		const displayWorkingArea = getWorkingArea(display);
		return Boolean(
			displayWorkingArea &&
			state.x! + state.width! > displayWorkingArea.x &&
			state.y! + state.height! > displayWorkingArea.y &&
			state.x! < displayWorkingArea.x + displayWorkingArea.width &&
			state.y! < displayWorkingArea.y + displayWorkingArea.height
		);
	}
}

function getWorkingArea(display: Display): Rectangle | undefined {
	if (display.workArea.width > 0 && display.workArea.height > 0) {
		return display.workArea;
	}

	if (display.bounds.width > 0 && display.bounds.height > 0) {
		return display.bounds;
	}

	return undefined;
}
