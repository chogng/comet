/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//#region --- workbench core

import 'ls/base/browser/ui/button/button.css';
import 'ls/workbench/browser/contextkeys';
import 'ls/workbench/contrib/workbench/workbench.contribution';
import 'ls/workbench/contrib/webContentView/webContentView.contribution';

//#endregion


//#region --- workbench actions

import 'ls/workbench/browser/actions/layoutActions';

//#endregion


//#region --- workbench services

import 'ls/workbench/services/commands/common/commandService';
import 'ls/workbench/services/configuration/browser/configurationService';
import 'ls/workbench/services/environment/browser/environmentService';
import 'ls/workbench/services/host/browser/host';
import 'ls/workbench/services/keybinding/browser/keybindingService';
import 'ls/workbench/services/language/common/languageService';
import 'ls/workbench/services/layout/browser/layoutService';
import 'ls/workbench/services/lifecycle/browser/lifecycleService';
import 'ls/workbench/services/localization/browser/localeService';
import 'ls/workbench/services/notification/common/notificationService';
import 'ls/workbench/services/views/browser/viewsService';

//#endregion


//#region --- workbench contributions

import 'ls/workbench/contrib/localization/common/localization.contribution';
import 'ls/workbench/contrib/sash/browser/sash.contribution';

//#endregion
