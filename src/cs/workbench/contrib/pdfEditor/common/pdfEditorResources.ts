/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';

export const PdfEditorInputScheme = 'comet-pdf';
export const CreatePdfEditorCommandId = 'workbench.action.createPdfEditor';
export const EmptyPdfEditorUrl = 'about:blank';

export function createPdfEditorResource(): URI {
	return URI.from({ scheme: PdfEditorInputScheme, path: generateUuid() });
}
