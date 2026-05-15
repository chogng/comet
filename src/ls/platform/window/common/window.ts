import { getRuntimeMode, getRuntimePlatform } from 'ls/base/common/platform';
import type { RuntimeMode, RuntimePlatform } from 'ls/base/common/platform';

export type WindowChromeTitleBarStyle = 'native' | 'custom';
export type WindowControlsContainerMode = 'none' | 'native';

export type WindowChromeLayout = {
  mode: RuntimeMode;
  platform: RuntimePlatform;
  titleBarStyle: WindowChromeTitleBarStyle;
  nativeWindowControlsOverlay: boolean;
  renderCustomWindowControls: boolean;
  windowControlsContainerMode: WindowControlsContainerMode;
  leadingWindowControlsWidthPx: number;
  trailingWindowControlsWidthPx: number;
};

const MACOS_WINDOW_CONTROLS_WIDTH_PX = 70;
const WINDOWS_WINDOW_CONTROLS_WIDTH_PX = 138;

export function getWindowChromeLayout(): WindowChromeLayout {
  const mode = getRuntimeMode();
  const platform = getRuntimePlatform();
  const titleBarStyle: WindowChromeTitleBarStyle =
    platform === 'linux' ? 'native' : 'custom';
  const nativeWindowControlsOverlay =
    mode === 'desktop' &&
    titleBarStyle === 'custom' &&
    platform === 'windows';
  const renderCustomWindowControls = false;
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
    renderCustomWindowControls,
    windowControlsContainerMode,
    leadingWindowControlsWidthPx:
      windowControlsContainerMode === 'native' ? MACOS_WINDOW_CONTROLS_WIDTH_PX : 0,
    trailingWindowControlsWidthPx: nativeWindowControlsOverlay
      ? WINDOWS_WINDOW_CONTROLS_WIDTH_PX
      : 0,
  };
}
