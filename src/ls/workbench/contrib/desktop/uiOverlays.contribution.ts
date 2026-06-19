import { registerToastBridge } from 'ls/base/browser/ui/toast/toast';
import { getNativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostServiceAccessor';

function canUseNativeToastOverlay() {
  if (typeof window === 'undefined') {
    return false;
  }

  if (new URLSearchParams(window.location.search).get('nativeOverlay') === 'toast') {
    return false;
  }

  return typeof getNativeHostService().toast?.show === 'function';
}

registerToastBridge({
  canHandle: canUseNativeToastOverlay,
  show: (options) => {
    getNativeHostService().toast?.show(options);
    return -1;
  },
  dismiss: (id) => {
    getNativeHostService().toast?.dismiss(id);
  },
});
