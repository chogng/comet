/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IStorageService } from 'cs/platform/storage/common/storage';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { EditorGroupsService } from 'cs/workbench/services/editor/browser/editorGroupsService';
import type { MainEditorPart } from 'cs/workbench/browser/parts/editor/editorPart';
import type { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';

export abstract class EditorParts<TMainPart extends MainEditorPart = MainEditorPart>
	extends EditorGroupsService implements IEditorGroupsService {
	readonly mainPart: TMainPart;

	constructor(
		storageService: IStorageService,
		instantiationService: IInstantiationService,
	) {
		super(storageService, instantiationService);
		this.mainPart = this._register(this.createMainEditorPart());
	}

	protected abstract createMainEditorPart(): TMainPart;
}
