/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { BrowserWindow } from 'electron';

import type { AppSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { AppSettingsConfigurationService } from 'cs/platform/configuration/common/configuration';
import type { IStorageService } from 'cs/platform/storage/common/storage';
import type { IThemeMainService } from 'cs/platform/theme/electron-main/themeMainService';
import { createMainWindow } from 'cs/platform/windows/electron-main/windows';
import { WindowsStateHandler } from 'cs/platform/windows/electron-main/windowsStateHandler';

export class WindowsMainService {
	private readonly windowsStateHandler: WindowsStateHandler;

	constructor(
		private readonly storageService: IStorageService & AppSettingsConfigurationService,
		private readonly themeMainService: IThemeMainService,
	) {
		this.windowsStateHandler = new WindowsStateHandler(this.storageService);
	}

	async openMainWindow(settings?: AppSettings): Promise<BrowserWindow> {
		const resolvedSettings = settings ?? await this.storageService.loadSettings();
		const window = createMainWindow({
			windowState: this.windowsStateHandler.getNewWindowState(),
			useMica: resolvedSettings.useMica,
			backgroundColor: this.themeMainService.getBackgroundColor(),
		});
		this.registerWindow(window);
		return window;
	}

	private registerWindow(window: BrowserWindow): void {
		window.on('blur', () => this.windowsStateHandler.saveWindowState(window));
		window.on('close', () => this.windowsStateHandler.saveWindowState(window));
	}
}
