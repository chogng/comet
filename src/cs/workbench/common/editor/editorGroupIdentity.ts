/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const DEFAULT_EDITOR_GROUP_ID = 'editor-group-default';

export function createEditorGroupId(prefix = 'editor-group'): string {
	const normalizedPrefix = prefix.trim() || 'editor-group';
	const randomPart = Math.random().toString(36).slice(2, 8);
	return `${normalizedPrefix}-${Date.now().toString(36)}-${randomPart}`;
}
