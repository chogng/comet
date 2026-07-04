import { app, BrowserWindow } from 'electron';

type AppLifecycleHandlers = {
  createMainWindow: () => void;
};

let lifecycleHandlersRegistered = false;

export function registerAppLifecycleHandlers({ createMainWindow }: AppLifecycleHandlers) {
  if (lifecycleHandlersRegistered) {
    return;
  }

  lifecycleHandlersRegistered = true;

  if (process.platform === 'darwin') {
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  }

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
