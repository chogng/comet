/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// #######################################################################
// ###                                                                 ###
// ### !!! PLEASE ADD COMMON IMPORTS INTO WORKBENCH.COMMON.MAIN.TS !!! ###
// ###                                                                 ###
// #######################################################################

//#region --- workbench common
import 'ls/workbench/workbench.common.main';
//#endregion

import { IMainProcessService } from 'ls/base/parts/ipc/common/mainProcessService';
import { createElectronMainProcessService } from 'ls/base/parts/ipc/electron-browser/ipc.electron';
import { INativeHostService } from 'ls/platform/native/common/native';
import { nativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostServiceProxy';
import {
  registerWorkbenchDisposable,
  registerWorkbenchService,
} from 'ls/workbench/services/instantiation/browser/workbenchInstantiationService';

//#region --- workbench (desktop main)
import 'ls/workbench/contrib/window/window.contribution';
import 'ls/workbench/contrib/splash/browser/partsSplash';
//#endregion

//#region --- workbench (desktop services)
registerWorkbenchService(INativeHostService, nativeHostService);

const mainProcessService = createElectronMainProcessService(nativeHostService.ipc);
if (mainProcessService) {
  registerWorkbenchService(IMainProcessService, mainProcessService);
  registerWorkbenchDisposable(mainProcessService);
}
//#endregion
