import {
  connectWorkbenchWindowControls,
  registerWorkbenchWindowControlsProvider,
} from 'cs/workbench/browser/window';
import { hasDesktopRuntime } from 'cs/base/common/platform';
import { getNativeHostService } from 'cs/platform/native/electron-sandbox/nativeHostServiceAccessor';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';

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
