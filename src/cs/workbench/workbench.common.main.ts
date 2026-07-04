/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//#region --- workbench core

import 'cs/base/browser/ui/button/button.css';
import 'cs/workbench/browser/contextkeys';
import 'cs/workbench/contrib/workbench/workbench.contribution';

//#endregion


//#region --- workbench actions

import 'cs/workbench/browser/actions/layoutActions';

//#endregion


//#region --- workbench services

import { INativeHostService } from 'cs/platform/native/common/native';
import { nativeHostService } from 'cs/workbench/services/host/electron-browser/nativeHostService';
import {
  registerWorkbenchService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import 'cs/workbench/services/commands/common/commandService';
import 'cs/workbench/services/configuration/browser/configurationService';
import 'cs/workbench/services/environment/browser/environmentService';
import 'cs/workbench/services/host/browser/host';
import 'cs/platform/hover/browser/hoverService';
import 'cs/workbench/services/keybinding/browser/keybindingService';
import 'cs/workbench/services/language/common/languageService';
import 'cs/workbench/services/layout/browser/layoutService';
import 'cs/workbench/services/lifecycle/browser/lifecycleService';
import 'cs/workbench/services/localization/browser/localeService';
import 'cs/workbench/services/notification/common/notificationService';
import 'cs/workbench/services/views/browser/viewsService';

registerWorkbenchService(INativeHostService, nativeHostService);

//#endregion


//#region --- workbench contributions

import 'cs/workbench/contrib/localization/common/localization.contribution';
import 'cs/workbench/contrib/sash/browser/sash.contribution';

//#endregion
