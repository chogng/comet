/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// #######################################################################
// ###                                                                 ###
// ### !!! PLEASE ADD COMMON IMPORTS INTO WORKBENCH.COMMON.MAIN.TS !!! ###
// ###                                                                 ###
// #######################################################################

//#region --- workbench common
import 'cs/workbench/workbench.common.main';
//#endregion

import { ElectronIPCMainProcessService } from 'cs/platform/ipc/electron-browser/mainProcessService';
import { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import { nativeHostService } from 'cs/workbench/services/host/electron-browser/nativeHostService';
import {
  registerWorkbenchDisposable,
  registerWorkbenchService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

//#region --- workbench (desktop main)
import 'cs/workbench/contrib/browserView/electron-browser/browserView.contribution';
import 'cs/workbench/contrib/window/window.contribution';
import 'cs/workbench/contrib/splash/browser/partsSplash';
//#endregion

//#region --- workbench (desktop services)
import 'cs/workbench/services/dialogs/electron-browser/fileDialogService';

const ipc = nativeHostService.ipc;
if (!ipc) {
  throw new Error('Desktop IPC bridge is unavailable.');
}
const mainProcessService = new ElectronIPCMainProcessService(ipc);
registerWorkbenchService(IMainProcessService, mainProcessService);
registerWorkbenchDisposable(mainProcessService);
//#endregion
