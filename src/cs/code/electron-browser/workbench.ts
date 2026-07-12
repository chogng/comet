/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ElectronAPI } from 'cs/base/parts/sandbox/common/electronTypes';

type DesktopBridgeWindow = Window & {
	electronAPI?: ElectronAPI;
};

function assertDesktopIpcBridge() {
	const electronAPI = (window as DesktopBridgeWindow).electronAPI;
	if (!electronAPI) {
		throw new Error(
			[
				'Desktop renderer was loaded without the Electron preload bridge.',
				'Launch the desktop workbench through scripts/code.sh or scripts/code.bat instead of opening the renderer URL in a browser.',
			].join(' '),
		);
	}

	if (!electronAPI.ipc) {
		throw new Error(
			'Desktop renderer preload is missing the IPC bridge. Rebuild the Electron preload and restart the desktop workbench.',
		);
	}
}

function isSmokeTestDriverEnabled() {
	const query = new URLSearchParams(window.location.search);
	return query.get('enableSmokeTestDriver') === 'true';
}

async function main() {
	assertDesktopIpcBridge();
	await import('cs/sessions/sessions.desktop.main');

	const { startSessionsWorkbench } = await import('cs/sessions/browser/sessionsWorkbench');
	await startSessionsWorkbench();

	if (isSmokeTestDriverEnabled()) {
		const { registerWindowDriver } = await import(
			'cs/workbench/services/driver/browser/driver'
		);
		const { getWorkbenchInstantiationService } = await import(
			'cs/workbench/services/instantiation/browser/workbenchInstantiationService'
		);
		const driver = registerWindowDriver(getWorkbenchInstantiationService());
		window.addEventListener('beforeunload', () => driver.dispose(), {
			once: true,
		});
	}

}

void main();
