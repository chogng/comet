/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import { isEqual } from 'cs/base/common/resources';

export const DefaultSessionsProviderId = 'comet.default';
export const DefaultSessionTypeId = 'comet.default.agent';

const DefaultSessionResourceScheme = 'comet-default-session';

/** Creates the canonical resource shared by one default Session and its main Chat. */
export function createDefaultSessionResource(conversationId: string): URI {
	if (!conversationId || conversationId !== conversationId.trim() || conversationId.includes('/')) {
		throw new Error('A default Session conversation ID must be non-empty, trimmed, and contain no slash.');
	}

	return URI.from({
		scheme: DefaultSessionResourceScheme,
		path: `/${conversationId}`,
	});
}

/** Extracts the provider-local conversation identity from its canonical resource. */
export function getDefaultSessionConversationId(resource: URI): string {
	if (resource.scheme !== DefaultSessionResourceScheme
		|| resource.authority
		|| resource.query
		|| resource.fragment
		|| !resource.path.startsWith('/')) {
		throw new Error(`Resource '${resource.toString()}' is not a canonical default Session resource.`);
	}
	const conversationId = resource.path.slice(1);
	const canonical = createDefaultSessionResource(conversationId);
	if (!isEqual(resource, canonical)) {
		throw new Error(`Resource '${resource.toString()}' is not a canonical default Session resource.`);
	}
	return conversationId;
}
