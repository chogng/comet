/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//#region --- workbench core

import 'cs/base/browser/ui/button/button.css';
import 'cs/workbench/browser/contextkeys';
import 'cs/workbench/contrib/workbench/workbench.contribution';

//#endregion


//#region --- workbench actions

import 'cs/workbench/browser/actions/sidebarActions';
import 'cs/workbench/browser/actions/commandPaletteActions';

//#endregion


//#region --- workbench services

import { INativeHostService } from 'cs/platform/native/common/native';
import { ILogService } from 'cs/platform/log/common/log';
import { BrowserLogService } from 'cs/platform/log/browser/log';
import { IThemeService } from 'cs/platform/theme/common/themeService';
import { themeService } from 'cs/platform/theme/browser/themeService';
import { AgentNetworkFilterService, IAgentNetworkFilterService } from 'cs/platform/networkFilter/common/networkFilterService';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import {
  ITelemetryService,
  NullTelemetryService,
} from 'cs/platform/telemetry/common/telemetry';
import { nativeHostService } from 'cs/workbench/services/host/electron-browser/nativeHostService';
import {
  registerWorkbenchService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import 'cs/workbench/services/commands/common/commandService';
import 'cs/workbench/services/configuration/browser/configurationService';
import 'cs/workbench/services/environment/browser/environmentService';
import 'cs/workbench/services/dialogs/browser/dialogService';
import 'cs/workbench/services/editor/browser/editorResolverService';
import 'cs/workbench/services/editor/browser/editorService';
import 'cs/workbench/services/host/browser/host';
import {
  contextKeyService,
  IContextKeyService,
} from 'cs/platform/contextkey/common/contextkey';
import 'cs/platform/contextview/browser/contextViewService';
import 'cs/platform/contextview/browser/contextMenuService';
import 'cs/platform/hover/browser/hoverService';
import 'cs/editor/browser/services/openerService';
import 'cs/workbench/services/keybinding/browser/keybindingService';
import 'cs/workbench/services/language/common/languageService';
import 'cs/workbench/services/lifecycle/browser/lifecycleService';
import 'cs/workbench/services/localization/browser/localeService';
import 'cs/workbench/services/knowledgeBase/libraryModel';
import 'cs/workbench/services/notification/common/notificationService';
import 'cs/workbench/services/quickInput/browser/quickInputService';
import 'cs/workbench/services/views/browser/viewsService';
import 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import 'cs/workbench/contrib/chat/browser/chat.contribution';
import 'cs/workbench/contrib/draftEditor/browser/draftEditorCloseService';
import 'cs/workbench/contrib/draftEditor/browser/draftEditor.contribution';
import 'cs/workbench/contrib/pdfEditor/browser/pdfEditor.contribution';
import 'cs/workbench/contrib/preferences/browser/settings.contribution';
import 'cs/workbench/contrib/translation/browser/articleSummaryTranslationExport';

registerWorkbenchService(INativeHostService, nativeHostService);
registerWorkbenchService(IContextKeyService, contextKeyService);
registerWorkbenchService(ILogService, new BrowserLogService());
registerWorkbenchService(IThemeService, themeService);
registerWorkbenchService(ITelemetryService, new NullTelemetryService());
registerSingleton(IAgentNetworkFilterService, AgentNetworkFilterService, InstantiationType.Delayed);

//#endregion


//#region --- workbench contributions

import 'cs/workbench/contrib/localization/common/localization.contribution';
import 'cs/workbench/contrib/quickaccess/browser/quickAccess.contribution';
import 'cs/workbench/contrib/sash/browser/sash.contribution';

//#endregion
