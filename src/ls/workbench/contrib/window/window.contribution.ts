import {
  connectWorkbenchWindowControls,
  registerWorkbenchWindowControlsProvider,
} from 'ls/workbench/browser/window';
import { hasDesktopRuntime } from 'ls/base/common/platform';
import { getNativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostServiceAccessor';
import { registerWorkbenchContribution } from 'ls/workbench/contrib/workbench/workbench.contribution';

registerWorkbenchWindowControlsProvider({
  getState: async () => {
    const controls = getNativeHostService().windowControls;
    if (!controls) {
      return {
        isMaximized: false,
        isFullscreen: false,
      };
    }

    return controls.getState();
  },
  onStateChange: (listener) => {
    const controls = getNativeHostService().windowControls;
    if (!controls) {
      return () => {};
    }

    return controls.onStateChange(listener);
  },
  perform: (action) => {
    getNativeHostService().windowControls?.perform(action);
  },
});

registerWorkbenchContribution(() => {
  return {
    dispose: connectWorkbenchWindowControls(hasDesktopRuntime()),
  };
});
