/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import type { AppColorScheme, PartsSplash } from 'cs/platform/theme/common/theme';
import { themeService } from 'cs/platform/theme/browser/themeService';
import { INativeHostService } from 'cs/platform/native/common/native';
import { SESSION_PART_IDS } from 'cs/sessions/browser/parts/parts';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import {
	getWorkbenchPartDomSnapshot,
	subscribeWorkbenchPartDom,
} from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { setWorkbenchHostColorScheme } from 'cs/workbench/services/themes/browser/workbenchThemeService';

function getElementWidth(element: HTMLElement | null | undefined): number {
	return element?.getBoundingClientRect().width ?? 0;
}

function getElementHeight(element: HTMLElement | null | undefined): number {
	return element?.getBoundingClientRect().height ?? 0;
}

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

		this._register(toDisposable(subscribeWorkbenchPartDom(this.scheduleSaveWindowSplash)));
		this._register(this.layoutService.onDidChangeLayoutState(this.scheduleSaveWindowSplash));
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
		const partDom = getWorkbenchPartDomSnapshot();
		const layoutState = this.layoutService.getLayoutState();
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
				titleBarHeight: getElementHeight(partDom[WORKBENCH_PART_IDS.titlebar]),
				sideBarWidth: layoutState.isSidebarVisible
					? getElementWidth(partDom[WORKBENCH_PART_IDS.sidebar])
					: 0,
				agentBarWidth: getElementWidth(partDom[SESSION_PART_IDS.sessions]),
				statusBarHeight: getElementHeight(partDom[WORKBENCH_PART_IDS.statusbar]),
			},
		};
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(SessionsPartsSplashContribution),
);
