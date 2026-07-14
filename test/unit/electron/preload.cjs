/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__cometUnitBridge', {
	report(result) {
		ipcRenderer.send('comet-unit-result', result);
	},
	reportError(error) {
		ipcRenderer.send('comet-unit-error', error);
	},
	getProcessType() {
		return process.type;
	},
});
