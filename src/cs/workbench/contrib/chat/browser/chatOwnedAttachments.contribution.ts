/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { ChatOwnedAttachmentsContribution } from 'cs/workbench/contrib/chat/browser/chatOwnedAttachments';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(ChatOwnedAttachmentsContribution),
);
