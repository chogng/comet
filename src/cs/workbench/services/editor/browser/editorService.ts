/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import type { IUntypedEditorInput } from 'cs/workbench/common/editor';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { IWorkbenchLayoutService } from 'cs/workbench/services/layout/browser/layoutService';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import { IEditorResolverService } from 'cs/workbench/services/editor/common/editorResolverService';
import {
	IEditorService,
	type IEditorOpenOptions,
} from 'cs/workbench/services/editor/common/editorService';

export class EditorService implements IEditorService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorResolverService private readonly editorResolverService: IEditorResolverService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
	) {}

	async openEditor(
		input: EditorInput | IUntypedEditorInput,
		options: IEditorOpenOptions = {},
	): Promise<EditorInput> {
		const ownsResolvedInput = !(input instanceof EditorInput);
		const typedInput = ownsResolvedInput ? this.resolveEditorInput(input, options) : input;
		let openedInput: EditorInput;
		try {
			openedInput = this.editorGroupsService.openEditor(typedInput, options);
		} catch (error) {
			if (ownsResolvedInput) {
				typedInput.dispose();
			}
			throw error;
		}
		this.ensureEditorPartVisible();
		return openedInput;
	}

	activateEditor(editor: EditorInput): void {
		const match = this.editorGroupsService.findEditor(editor);
		if (!match) {
			return;
		}
		match.group.setActive(match.editor);
		this.editorGroupsService.activateGroup(match.group);
	}

	closeEditor(editor: EditorInput): Promise<boolean> {
		return this.editorGroupsService.closeEditor(editor);
	}

	getEditors() {
		return this.editorGroupsService.getGroups().flatMap(group =>
			group.getEditors().map(editor => ({ groupId: group.id, editor })),
		);
	}

	getActiveGroupId(): string {
		return this.editorGroupsService.activeGroup.id;
	}

	private resolveEditorInput(
		input: IUntypedEditorInput,
		options: IEditorOpenOptions,
	): EditorInput {
		if (!('resource' in input) || !input.resource) {
			throw new Error('Cannot resolve an editor input without a resource.');
		}
		const resolved = this.editorResolverService.resolveEditor({
			resource: input.resource,
			options: options.editorOptions ?? input.options,
		});
		if (!resolved) {
			throw new Error(`No editor resolver is registered for '${input.resource.toString()}'.`);
		}
		return resolved.editor;
	}

	private ensureEditorPartVisible(): void {
		const { isEditorCollapsed, expandedEditorSize } = this.layoutService.getLayoutState();
		if (isEditorCollapsed) {
			this.layoutService.setEditorCollapsed(false, expandedEditorSize);
		}
	}
}

registerSingleton(IEditorService, EditorService, InstantiationType.Delayed);
