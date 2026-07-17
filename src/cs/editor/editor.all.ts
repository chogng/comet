/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Editor-owned browser registrations are loaded through this single entry point.
// Shells may load the Editor, but must not reach into individual Editor services.
import 'cs/editor/browser/services/identityService';
import 'cs/editor/browser/services/openerService';
import 'cs/editor/browser/text/editorDraftStyleService';
