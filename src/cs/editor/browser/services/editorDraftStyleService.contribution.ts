/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorDraftStyleService } from 'cs/editor/browser/services/editorDraftStyleService';
import { IEditorDraftStyleService } from 'cs/editor/common/services/editorDraftStyleService';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';

registerSingleton(
	IEditorDraftStyleService,
	EditorDraftStyleService,
	InstantiationType.Delayed,
);
