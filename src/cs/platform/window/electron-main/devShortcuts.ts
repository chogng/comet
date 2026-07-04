import { app, BrowserWindow } from 'electron';

type RegisterDevShortcutsOptions = {
  getMainWindow: () => BrowserWindow | null;
};

function isDevToolsShortcut(input: Electron.Input) {
  if (input.type !== 'keyDown') {
    return false;
  }

  const key = input.key.toLowerCase();
  const isF12 = key === 'f12';
  const isCtrlShiftI = (input.control || input.meta) && input.shift && key === 'i';

  return isF12 || isCtrlShiftI;
}

function isReloadShortcut(input: Electron.Input) {
  if (input.type !== 'keyDown') {
    return false;
  }

  const key = input.key.toLowerCase();
  const isF5 = key === 'f5';
  const isCtrlOrCmdR = (input.control || input.meta) && key === 'r';

  return isF5 || isCtrlOrCmdR;
}

function toggleDevTools(targetContents: Electron.WebContents, getMainWindow: () => BrowserWindow | null) {
  const fallbackWindow = BrowserWindow.getFocusedWindow() ?? getMainWindow();
  const contents = targetContents.isDestroyed() ? fallbackWindow?.webContents : targetContents;

  if (!contents || contents.isDestroyed()) {
    return;
  }

  if (contents.isDevToolsOpened()) {
    contents.closeDevTools();
  } else {
    contents.openDevTools({ mode: 'detach' });
  }
}

function reloadMainWindow(getMainWindow: () => BrowserWindow | null) {
  const mainWindow = getMainWindow();
  const contents = mainWindow?.webContents ?? BrowserWindow.getFocusedWindow()?.webContents;

  if (!contents || contents.isDestroyed()) {
    return;
  }

  contents.reload();
}

export function registerDevShortcuts({ getMainWindow }: RegisterDevShortcutsOptions) {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('before-input-event', (event, input) => {
      if (isDevToolsShortcut(input)) {
        event.preventDefault();
        toggleDevTools(contents, getMainWindow);
        return;
      }

      if (!isReloadShortcut(input)) {
        return;
      }

      event.preventDefault();
      reloadMainWindow(getMainWindow);
    });
  });
}
