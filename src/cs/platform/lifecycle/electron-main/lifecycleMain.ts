import { app, BrowserWindow } from 'electron';
import { ApplicationQuitCoordinator } from 'cs/platform/lifecycle/electron-main/applicationQuit';

type AppLifecycleHandlers = {
	createMainWindow: () => void;
	prepareApplicationQuit: () => Promise<void>;
};

let lifecycleHandlersRegistered = false;

export function registerAppLifecycleHandlers({ createMainWindow, prepareApplicationQuit }: AppLifecycleHandlers) {
	if (lifecycleHandlersRegistered) {
		return;
	}

	lifecycleHandlersRegistered = true;
	const quitCoordinator = new ApplicationQuitCoordinator(
		() => BrowserWindow.getAllWindows(),
		prepareApplicationQuit,
		() => app.quit(),
		error => console.error('Failed to prepare application quit.', error),
	);

	app.on('before-quit', event => quitCoordinator.handleBeforeQuit(event));

	if (process.platform === 'darwin') {
		app.on('activate', () => quitCoordinator.handleActivate(createMainWindow));
	}

	app.on('window-all-closed', () => quitCoordinator.handleWindowAllClosed(process.platform === 'darwin'));
}
