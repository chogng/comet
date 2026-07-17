/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IAgentSdkPackage,
	IAgentSdkProductConfiguration,
} from 'cs/platform/agentHost/node/agentSdkDownloader';
import { CODEX_GENERATED_PROTOCOL_SDK_VERSION } from './codex/protocol/protocolMetadata.js';

export const CLAUDE_AGENT_SDK_VERSION = '0.3.208';
export const CODEX_AGENT_SDK_VERSION = CODEX_GENERATED_PROTOCOL_SDK_VERSION;

export const CLAUDE_AGENT_SDK_PACKAGE: IAgentSdkPackage = Object.freeze({
	id: 'claude',
	displayName: 'Claude',
	developmentRootEnvironmentVariable: 'COMET_CLAUDE_AGENT_SDK_ROOT',
	hasSeparateMuslLinuxTarget: true,
});

export const CODEX_AGENT_SDK_PACKAGE: IAgentSdkPackage = Object.freeze({
	id: 'codex',
	displayName: 'Codex',
	developmentRootEnvironmentVariable: 'COMET_CODEX_AGENT_SDK_ROOT',
	hasSeparateMuslLinuxTarget: false,
});

export const PRODUCT_AGENT_SDKS: Readonly<Record<string, IAgentSdkProductConfiguration>> = Object.freeze({
	[CLAUDE_AGENT_SDK_PACKAGE.id]: Object.freeze({
		version: CLAUDE_AGENT_SDK_VERSION,
		urlTemplate: `https://github.com/chogng/comet/releases/download/agent-sdk-claude-v${CLAUDE_AGENT_SDK_VERSION}/claude-{sdkTarget}.tgz`,
	}),
	[CODEX_AGENT_SDK_PACKAGE.id]: Object.freeze({
		version: CODEX_AGENT_SDK_VERSION,
		urlTemplate: `https://github.com/chogng/comet/releases/download/agent-sdk-codex-v${CODEX_AGENT_SDK_VERSION}/codex-{sdkTarget}.tgz`,
	}),
});
