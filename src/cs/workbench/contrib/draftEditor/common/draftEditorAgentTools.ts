/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	createAgentInteractionTargetId,
	createAgentInteractionTargetOwnerId,
	createAgentInteractionTargetRevision,
	createAgentInteractionTargetTypeId,
	createAgentToolId,
	type AgentHostClientConnectionId,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import type { URI } from 'cs/base/common/uri';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';

export const DraftEditorInteractionTargetOwner = createAgentInteractionTargetOwnerId('comet.draft-editor');
export const DraftEditorInteractionTargetType = createAgentInteractionTargetTypeId('editor.draft-document');
export const DraftEditorInteractionTargetSchemaVersion = 1;

export const DraftEditorGetSelectionContextToolId = createAgentToolId(
	'comet.draft-editor.get-selection-context',
);
export const DraftEditorListTextUnitsToolId = createAgentToolId(
	'comet.draft-editor.list-text-units',
);
export const DraftEditorProposeEditorPatchToolId = createAgentToolId(
	'comet.draft-editor.propose-editor-patch',
);

export interface IDraftEditorInteractionTargetSnapshot {
	readonly resource: URI;
	readonly name: string;
	readonly document: WritingEditorDocument;
}

async function sha256(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Creates the one canonical target identity for an exact normalized Draft version. */
export async function createDraftEditorInteractionTarget(
	snapshot: IDraftEditorInteractionTargetSnapshot,
	connection: AgentHostClientConnectionId,
): Promise<IAgentHostInteractionTarget> {
	assertAgentHostProtocolValue(snapshot.document);
	const resource = snapshot.resource.toString(true);
	const resourceVersion = `sha256:${await sha256(encodeAgentHostProtocolValue(snapshot.document))}`;
	const identityDigest = await sha256(encodeAgentHostProtocolValue({ resource, resourceVersion }));
	const target: IAgentHostInteractionTarget = {
		id: createAgentInteractionTargetId(`draft:${identityDigest}`),
		owner: DraftEditorInteractionTargetOwner,
		type: DraftEditorInteractionTargetType,
		schemaVersion: DraftEditorInteractionTargetSchemaVersion,
		resource,
		resourceVersion,
		revision: createAgentInteractionTargetRevision(resourceVersion),
		authority: { kind: 'client', connection },
		availability: 'connection',
		display: { label: snapshot.name, description: resource },
	};
	assertAgentHostInteractionTarget(target);
	return Object.freeze(target);
}
