/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	type AgentHostClientConnectionId,
	createAgentInteractionTargetId,
	createAgentInteractionTargetOwnerId,
	createAgentInteractionTargetRevision,
	createAgentInteractionTargetTypeId,
} from 'cs/platform/agentHost/common/identities';
import { computeAgentHostPayloadDigest } from 'cs/platform/agentHost/common/protocolValues';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';

export const BrowserDocumentTargetOwner = createAgentInteractionTargetOwnerId('browser-view');
export const BrowserDocumentTargetType = createAgentInteractionTargetTypeId('browser.document');

/** Captures one exact Browser main-frame document identity without reading its content. */
export async function createBrowserDocumentTarget(
	model: IBrowserViewModel,
	connection: AgentHostClientConnectionId,
	label: string,
): Promise<IAgentHostInteractionTarget> {
	const document = await model.captureDocumentIdentity();
	const digest = await computeAgentHostPayloadDigest({
		owner: BrowserDocumentTargetOwner,
		type: BrowserDocumentTargetType,
		resource: model.id,
		resourceVersion: document.documentEpoch,
	});
	return Object.freeze({
		id: createAgentInteractionTargetId(`browser:${digest.slice('sha256:'.length)}`),
		owner: BrowserDocumentTargetOwner,
		type: BrowserDocumentTargetType,
		schemaVersion: 1,
		resource: model.id,
		resourceVersion: document.documentEpoch,
		revision: createAgentInteractionTargetRevision(document.documentEpoch),
		authority: Object.freeze({ kind: 'client', connection }),
		availability: 'turn',
		display: Object.freeze({ label, description: document.url }),
	});
}
