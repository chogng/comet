/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { writingEditorDocumentToPlainText, type WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import { DraftEditorInput } from 'cs/workbench/contrib/draftEditor/common/draftEditorInput';

export const IDraftEditorService = createDecorator<IDraftEditorService>('draftEditorService');

export interface IDraftEditorService {
	readonly _serviceBrand: undefined;
	readonly activeInput: DraftEditorInput | undefined;
	canSaveActive(): boolean;
	saveActive(): boolean;
	getActiveBody(): string;
	getActiveDocument(): WritingEditorDocument | null;
	setActiveDocument(value: WritingEditorDocument): void;
}

export class DraftEditorService implements IDraftEditorService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
	) {}

	get activeInput(): DraftEditorInput | undefined {
		const activeEditor = this.editorGroupsService.activeGroup.activeEditor;
		return activeEditor instanceof DraftEditorInput ? activeEditor : undefined;
	}

	canSaveActive(): boolean {
		return this.activeInput?.isDirty() ?? false;
	}

	saveActive(): boolean {
		const input = this.activeInput;
		if (!input) {
			return false;
		}
		void input.save();
		return true;
	}

	getActiveBody(): string {
		const input = this.activeInput;
		return input ? writingEditorDocumentToPlainText(input.document) : '';
	}

	getActiveDocument(): WritingEditorDocument | null {
		return this.activeInput?.document ?? null;
	}

	setActiveDocument(value: WritingEditorDocument): void {
		this.activeInput?.setDocument(value);
	}
}

registerSingleton(IDraftEditorService, DraftEditorService, InstantiationType.Delayed);
