import { themeService } from 'ls/platform/theme/browser/themeService';
import type {
  AppColorScheme,
  PartsSplash,
} from 'ls/platform/theme/common/theme';
import { DisposableStore, toDisposable } from 'ls/base/common/lifecycle';
import { getNativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostServiceAccessor';
import {
  getWorkbenchLayoutStateSnapshot,
  getWorkbenchPartDomSnapshot,
  subscribeWorkbenchLayoutState,
  subscribeWorkbenchPartDom,
  WORKBENCH_PART_IDS,
} from 'ls/workbench/browser/layout';
import { registerWorkbenchContribution } from 'ls/workbench/contrib/workbench/workbench.contribution';
import {
  setWorkbenchHostColorScheme,
} from 'ls/workbench/services/themes/browser/workbenchThemeService';

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

export function createWorkbenchPartsSplashContribution() {
  const nativeHost = getNativeHostService();
  if (!nativeHost.ipc) {
    throw new Error('Native host IPC is required for parts splash.');
  }

  const ipc = nativeHost.ipc;
  const store = new DisposableStore();
  let saveHandle: number | null = null;

  const saveWindowSplash = () => {
    saveHandle = null;
    void ipc.call('nativeHost', 'save_window_splash', createPartsSplash());
  };

  const scheduleSaveWindowSplash = () => {
    if (saveHandle !== null) {
      window.clearTimeout(saveHandle);
    }

    saveHandle = window.setTimeout(saveWindowSplash, 250);
  };

  store.add(toDisposable(subscribeWorkbenchPartDom(scheduleSaveWindowSplash)));
  store.add(toDisposable(subscribeWorkbenchLayoutState(scheduleSaveWindowSplash)));
  store.add(themeService.onDidColorThemeChange(scheduleSaveWindowSplash));
  store.add(toDisposable(ipc.listen<AppColorScheme>(
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

  return {
    dispose() {
      if (saveHandle !== null) {
        window.clearTimeout(saveHandle);
        saveHandle = null;
      }

      store.dispose();
    },
  };
}

registerWorkbenchContribution(createWorkbenchPartsSplashContribution);
