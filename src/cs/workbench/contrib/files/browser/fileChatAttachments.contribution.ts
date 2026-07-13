/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { FileChatAttachmentsContribution } from 'cs/workbench/contrib/files/browser/fileChatAttachments';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(FileChatAttachmentsContribution),
);
