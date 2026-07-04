/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { themeService } from 'cs/platform/theme/browser/themeService';
import type {
  AppColorScheme,
  PartsSplash,
} from 'cs/platform/theme/common/theme';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { INativeHostService } from 'cs/platform/native/common/native';
import {
  getWorkbenchLayoutStateSnapshot,
  getWorkbenchPartDomSnapshot,
  subscribeWorkbenchLayoutState,
  subscribeWorkbenchPartDom,
  WORKBENCH_PART_IDS,
} from 'cs/workbench/browser/layout';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import {
  setWorkbenchHostColorScheme,
} from 'cs/workbench/services/themes/browser/workbenchThemeService';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

function getElementWidth(element: HTMLElement | null) {
  return element?.getBoundingClientRect().width ?? 0;
}

function getElementHeight(element: HTMLElement | null) {
  return element?.getBoundingClientRect().height ?? 0;
}

function requireThemeColor(colorId: Parameters<typeof themeService.getColor>[0]) {
  const color = themeService.getColor(colorId);
  if (color === null) {
    throw new Error(`Theme color '${colorId}' is not registered.`);
  }

  return color;
}

function createPartsSplash(): PartsSplash {
  const theme = themeService.getTheme();
  const partDom = getWorkbenchPartDomSnapshot();
  const layoutState = getWorkbenchLayoutStateSnapshot();

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
      sideBarWidth: layoutState.isPrimarySidebarVisible
        ? getElementWidth(partDom[WORKBENCH_PART_IDS.sidebar])
        : 0,
      agentBarWidth: layoutState.isAgentSidebarVisible
        ? getElementWidth(partDom[WORKBENCH_PART_IDS.agentSidebar])
        : 0,
      statusBarHeight: getElementHeight(partDom[WORKBENCH_PART_IDS.statusbar]),
    },
  };
}

export class WorkbenchPartsSplashContribution {
  private readonly store = new DisposableStore();
  private saveHandle: number | null = null;

  constructor(
    @INativeHostService nativeHostService: INativeHostService,
  ) {
    const ipc = nativeHostService.ipc;
    if (!ipc) {
      throw new Error('Native host IPC is required for parts splash.');
    }

    const saveWindowSplash = () => {
      this.saveHandle = null;
      void ipc.call('nativeHost', 'save_window_splash', createPartsSplash());
    };

    const scheduleSaveWindowSplash = () => {
      if (this.saveHandle !== null) {
        window.clearTimeout(this.saveHandle);
      }

      this.saveHandle = window.setTimeout(saveWindowSplash, 250);
    };

    this.store.add(toDisposable(subscribeWorkbenchPartDom(scheduleSaveWindowSplash)));
    this.store.add(toDisposable(subscribeWorkbenchLayoutState(scheduleSaveWindowSplash)));
    this.store.add(themeService.onDidColorThemeChange(scheduleSaveWindowSplash));
    this.store.add(toDisposable(ipc.listen<AppColorScheme>(
      'nativeHost',
      'on_did_change_color_scheme',
      undefined,
      colorScheme => {
        setWorkbenchHostColorScheme(colorScheme);
        scheduleSaveWindowSplash();
      },
    )));
    void ipc.call<AppColorScheme>('nativeHost', 'get_os_color_scheme')
      .then(colorScheme => {
        setWorkbenchHostColorScheme(colorScheme);
        scheduleSaveWindowSplash();
      });
    scheduleSaveWindowSplash();
  }

  dispose() {
    if (this.saveHandle !== null) {
      window.clearTimeout(this.saveHandle);
      this.saveHandle = null;
    }

    this.store.dispose();
  }
}

registerWorkbenchContribution(() =>
  getWorkbenchInstantiationService().createInstance(WorkbenchPartsSplashContribution),
);
