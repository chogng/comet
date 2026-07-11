/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export function getEditorInputId(input: EditorInput): string {
	const resource = input.resource;
	if (!resource) {
		throw new Error(`Editor input '${input.typeId}' has no resource identity.`);
	}
	return resource.toString();
}
