/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import type { IUntypedEditorInput } from 'cs/workbench/common/editor';
import type { IEditorOptions } from 'cs/workbench/common/editor';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
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
	) {}

	get activeEditorPane() {
		return this.editorGroupsService.mainPart.activeEditorPane;
	}

	get activeEditor(): EditorInput | undefined {
		return this.editorGroupsService.activeGroup.activeEditor ?? undefined;
	}

	async openEditor(
		input: EditorInput | IUntypedEditorInput,
		options: IEditorOpenOptions = {},
	): Promise<EditorInput> {
		const ownsResolvedInput = !(input instanceof EditorInput);
		const resolved = ownsResolvedInput
			? this.resolveEditorInput(input, options)
			: { editor: input, options: options.editorOptions };
		let openResult: ReturnType<IEditorGroupsService['openEditor']>;
		try {
			openResult = this.editorGroupsService.openEditor(resolved.editor, options);
		} catch (error) {
			if (ownsResolvedInput) {
				resolved.editor.dispose();
			}
			throw error;
		}
		if (options.active === false) {
			return openResult.editor;
		}
		this.editorGroupsService.mainPart.revealEditor();
		await this.editorGroupsService.mainPart.openEditor(
			openResult.editor,
			resolved.options,
			{
				...options.context,
				newInGroup: openResult.newInGroup,
			},
		);
		return openResult.editor;
	}

	async activateEditor(editor: EditorInput): Promise<void> {
		const match = this.editorGroupsService.findEditor(editor);
		if (!match) {
			return;
		}
		match.group.setActive(match.editor);
		this.editorGroupsService.activateGroup(match.group);
		this.editorGroupsService.mainPart.revealEditor();
		await this.editorGroupsService.mainPart.openEditor(match.editor, undefined, { newInGroup: false });
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
	): { editor: EditorInput; options: IEditorOptions | undefined } {
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
		return resolved;
	}

}

registerSingleton(IEditorService, EditorService, InstantiationType.Delayed);
