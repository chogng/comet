/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';

export const DraftEditorInputScheme = 'comet-draft';
export const PdfEditorInputScheme = 'comet-pdf';
export const EmptyEditorUrl = 'about:blank';
export const CreateDraftEditorCommandId = 'workbench.action.createDraftEditor';
export const CreatePdfEditorCommandId = 'workbench.action.createPdfEditor';

export function createDraftEditorResource(): URI {
	return URI.from({ scheme: DraftEditorInputScheme, path: generateUuid() });
}

export function createPdfEditorResource(): URI {
	return URI.from({ scheme: PdfEditorInputScheme, path: generateUuid() });
}
