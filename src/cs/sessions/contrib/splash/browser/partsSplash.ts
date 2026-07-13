/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import type { AppColorScheme, PartsSplash } from 'cs/platform/theme/common/theme';
import { themeService } from 'cs/platform/theme/browser/themeService';
import { INativeHostService } from 'cs/platform/native/common/native';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { setWorkbenchHostColorScheme } from 'cs/workbench/services/themes/browser/workbenchThemeService';

function requireThemeColor(colorId: Parameters<typeof themeService.getColor>[0]): string {
	const color = themeService.getColor(colorId);
	if (color === null) {
		throw new Error(`Theme color '${colorId}' is not registered.`);
	}
	return color;
}

class SessionsPartsSplashContribution extends Disposable {
	private saveHandle: number | undefined;

	constructor(
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@ISessionsLayoutService private readonly layoutService: ISessionsLayoutService,
	) {
		super();
		const ipc = this.nativeHostService.ipc;
		if (!ipc) {
			throw new Error('Native host IPC is required for the Sessions parts splash.');
		}

		this._register(this.layoutService.onDidChangeLayoutGeometry(this.scheduleSaveWindowSplash));
		this._register(themeService.onDidColorThemeChange(this.scheduleSaveWindowSplash));
		this._register(toDisposable(ipc.listen<AppColorScheme>(
			'nativeHost',
			'on_did_change_color_scheme',
			undefined,
			colorScheme => {
				setWorkbenchHostColorScheme(colorScheme);
				this.scheduleSaveWindowSplash();
			},
		)));
		void this.initializeColorScheme();
		this.scheduleSaveWindowSplash();
	}

	override dispose(): void {
		if (this.saveHandle !== undefined) {
			window.clearTimeout(this.saveHandle);
			this.saveHandle = undefined;
		}
		super.dispose();
	}

	private async initializeColorScheme(): Promise<void> {
		const ipc = this.nativeHostService.ipc;
		if (!ipc) {
			throw new Error('Native host IPC is required for the Sessions parts splash.');
		}
		const colorScheme = await ipc.call<AppColorScheme>('nativeHost', 'get_os_color_scheme');
		setWorkbenchHostColorScheme(colorScheme);
		this.scheduleSaveWindowSplash();
	}

	private readonly scheduleSaveWindowSplash = (): void => {
		if (!this.layoutService.getLayoutGeometry()) {
			return;
		}
		if (this.saveHandle !== undefined) {
			window.clearTimeout(this.saveHandle);
		}
		this.saveHandle = window.setTimeout(() => {
			this.saveHandle = undefined;
			const ipc = this.nativeHostService.ipc;
			if (!ipc) {
				throw new Error('Native host IPC is required for the Sessions parts splash.');
			}
			void ipc.call('nativeHost', 'save_window_splash', this.createPartsSplash());
		}, 250);
	};

	private createPartsSplash(): PartsSplash {
		const theme = themeService.getTheme();
		const layoutGeometry = this.layoutService.getLayoutGeometry();
		if (!layoutGeometry) {
			throw new Error('Sessions layout geometry is required for the parts splash.');
		}
		return {
			baseTheme: theme.kind,
			colorInfo: {
				foreground: requireThemeColor('workbench.foreground'),
				background: requireThemeColor('workbench.chromeBackground'),
				titleBarBackground: requireThemeColor('workbench.chromeBackgroundTransparent'),
				titleBarBorder: null,
				sideBarBackground: requireThemeColor('sideBar.background'),
				sideBarBorder: requireThemeColor('sideBar.border'),
				agentBarBackground: requireThemeColor('agentBar.background'),
				statusBarBackground: requireThemeColor('workbench.chromeBackground'),
				statusBarBorder: null,
				windowBorder: requireThemeColor('workbench.panelBorder'),
			},
			layoutInfo: {
				titleBarHeight: layoutGeometry.titlebarHeight,
				sideBarWidth: layoutGeometry.sidebar.visible
					? layoutGeometry.sidebar.width
					: 0,
				agentBarWidth: layoutGeometry.sessions.width,
				statusBarHeight: layoutGeometry.statusbarHeight,
			},
		};
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(SessionsPartsSplashContribution),
);
