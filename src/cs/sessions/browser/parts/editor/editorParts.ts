/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IStorageService } from 'cs/platform/storage/common/storage';
import { SessionsMainEditorPart } from 'cs/sessions/browser/parts/editor/editorPart';
import { EditorParts as WorkbenchEditorParts } from 'cs/workbench/browser/parts/editor/editorParts';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';

export class SessionsEditorParts extends WorkbenchEditorParts<SessionsMainEditorPart> {
	constructor(
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(storageService, instantiationService);
	}

	protected override createMainEditorPart(): SessionsMainEditorPart {
		return this.instantiationService.createInstance(SessionsMainEditorPart, this);
	}
}

registerSingleton(IEditorGroupsService, SessionsEditorParts, InstantiationType.Delayed);
