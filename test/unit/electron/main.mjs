/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rendererUrl = process.argv[2];
if (!rendererUrl) {
	throw new Error('Electron unit runtime requires a renderer URL.');
}

if (process.platform === 'linux') {
	app.commandLine.appendSwitch('no-sandbox');
}

let finished = false;

function finish(result) {
	if (finished) {
		return;
	}
	finished = true;
	console.log(`[unit/electron] ${result.passed} passed, ${result.failed} failed, ${result.skipped} skipped`);
	app.exit(result.failed === 0 ? 0 : 1);
}

ipcMain.on('comet-unit-result', (_event, result) => finish(result));
ipcMain.on('comet-unit-error', (_event, error) => {
	console.error(`[unit/electron] renderer error: ${JSON.stringify(error)}`);
	app.exit(1);
});

await app.whenReady();
const window = new BrowserWindow({
	show: false,
	webPreferences: {
		preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
		nodeIntegration: false,
		contextIsolation: true,
		sandbox: false,
	},
});
window.webContents.on('render-process-gone', (_event, details) => {
	console.error(`[unit/electron] renderer process exited: ${JSON.stringify(details)}`);
	app.exit(1);
});
window.webContents.on('console-message', (_event, details) => {
	if (details.type === 'error') {
		console.error(`[unit/electron] renderer console: ${details.message}`);
	}
});
await window.loadURL(rendererUrl.startsWith('file:') ? rendererUrl : pathToFileURL(rendererUrl).href);
setTimeout(() => {
	if (!finished) {
		console.error('[unit/electron] renderer did not report a result within 30 seconds.');
		app.exit(1);
	}
}, 30_000).unref();
