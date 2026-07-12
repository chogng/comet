/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// The reusable Workbench foundation must register before Sessions services and Parts.
import 'cs/workbench/workbench.common.main';

import 'cs/sessions/services/layout/browser/layoutService';
import 'cs/sessions/services/sessions/browser/sessionsProvidersService';
import 'cs/sessions/services/sessions/browser/sessionsManagementService';
import 'cs/sessions/browser/parts/editor/editorParts';
import 'cs/sessions/browser/parts/sessions/sessionsPart';
import 'cs/sessions/services/sessions/browser/sessionsService';
import 'cs/sessions/contrib/chat/browser/chat.contribution';
import 'cs/sessions/contrib/sessions/browser/sessions.contribution';
import 'cs/sessions/browser/sessions.contribution';
