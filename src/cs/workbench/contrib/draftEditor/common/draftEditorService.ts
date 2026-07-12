/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { normalizeWritingEditorDocument, type WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import { getComparisonKey } from 'cs/base/common/resources';
import type { URI } from 'cs/base/common/uri';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import { DraftEditorInput } from 'cs/workbench/contrib/draftEditor/common/draftEditorInput';
import {
	ChatRequestAttachmentKind,
	type IChatRequestEditorAttachment,
} from 'cs/workbench/contrib/chat/common/chatRequest';

export const IDraftEditorService = createDecorator<IDraftEditorService>('draftEditorService');

export interface IDraftEditorService {
	readonly _serviceBrand: undefined;
	readonly activeInput: DraftEditorInput | undefined;
	canSaveActive(): boolean;
	saveActive(): boolean;
	getDocument(resource: URI): WritingEditorDocument | null;
	setDocument(resource: URI, value: WritingEditorDocument): void;
	getActiveRequestAttachment(): IChatRequestEditorAttachment | undefined;
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

	getDocument(resource: URI): WritingEditorDocument | null {
		const input = this.findOpenInput(resource);
		return input ? normalizeWritingEditorDocument(input.document) : null;
	}

	setDocument(resource: URI, value: WritingEditorDocument): void {
		const input = this.findOpenInput(resource);
		if (!input) {
			throw new Error(`Draft editor resource '${resource.toString()}' is not open.`);
		}
		input.setDocument(value);
	}

	getActiveRequestAttachment(): IChatRequestEditorAttachment | undefined {
		const input = this.activeInput;
		if (!input) {
			return undefined;
		}
		const selection = input.getPaneSelectionSnapshot();
		if (selection === undefined) {
			return undefined;
		}
		return {
			kind: ChatRequestAttachmentKind.Editor,
			id: `editor:${input.resource.toString()}`,
			name: input.getName(),
			resource: input.resource,
			document: normalizeWritingEditorDocument(input.document),
			selection: selection ? { ...selection } : null,
		};
	}

	private findOpenInput(resource: URI): DraftEditorInput | undefined {
		const resourceKey = getComparisonKey(resource);
		const matches = new Set<DraftEditorInput>();
		for (const group of this.editorGroupsService.getGroups()) {
			for (const editor of group.getEditors()) {
				if (editor instanceof DraftEditorInput && getComparisonKey(editor.resource) === resourceKey) {
					matches.add(editor);
				}
			}
		}
		if (matches.size > 1) {
			throw new Error(`Draft editor resource '${resource.toString()}' is open in multiple inputs.`);
		}
		return matches.values().next().value;
	}
}

registerSingleton(IDraftEditorService, DraftEditorService, InstantiationType.Delayed);
