/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type {
	AgentChatId,
	AgentHostAuthorityId,
	AgentSessionId,
} from 'cs/platform/agentHost/common/identities';
import type { SessionsProviderId } from 'cs/sessions/services/sessions/common/session';

const AgentHostSessionResourceScheme = 'comet-agent-host-session';
const AgentHostChatResourceScheme = 'comet-agent-host-chat';

/** Builds the stable Sessions provider identity for one Agent Host authority. */
export function createAgentHostSessionsProviderId(authority: AgentHostAuthorityId): SessionsProviderId {
	return `agentHost.${authority}`;
}

/** Builds the product Session resource for one exact Host Session identity. */
export function createAgentHostSessionResource(
	authority: AgentHostAuthorityId,
	session: AgentSessionId,
): URI {
	return URI.from({
		scheme: AgentHostSessionResourceScheme,
		path: `/${authority}/${session}`,
	});
}

/** Builds the product Chat resource for one exact Host Session and Chat identity. */
export function createAgentHostChatResource(
	authority: AgentHostAuthorityId,
	session: AgentSessionId,
	chat: AgentChatId,
): URI {
	return URI.from({
		scheme: AgentHostChatResourceScheme,
		path: `/${authority}/${session}/${chat}`,
	});
}
