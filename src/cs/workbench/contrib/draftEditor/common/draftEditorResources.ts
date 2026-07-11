/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';

export const DraftEditorInputScheme = 'comet-draft';
export const CreateDraftEditorCommandId = 'workbench.action.createDraftEditor';

export function createDraftEditorResource(): URI {
	return URI.from({ scheme: DraftEditorInputScheme, path: generateUuid() });
}
