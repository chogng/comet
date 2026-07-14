/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'cs/nls';
import type { IAgentDescriptor, IAgentRuntimeRegistration } from 'cs/platform/agentHost/common/agent';
import {
	AgentConfigurationSchemaProfile,
	validateAndFreezeAgentConfigurationSchema,
} from 'cs/platform/agentHost/common/configuration';
import {
	createAgentCapabilityRevision,
	createAgentConfigurationPropertyId,
	createAgentConfigurationSchemaRevision,
	createAgentId,
	createAgentPackageId,
	createAgentResumeSchemaId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionTypeId,
	type AgentConfigurationSchemaRevision,
	type AgentDescriptorRevision,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentHostSessionTypeDescriptor } from 'cs/platform/agentHost/common/protocol';
import { COMET_TOOL_SCHEMA_PROFILE } from 'cs/platform/agentHost/common/tools';

export const CLAUDE_AGENT_PACKAGE_ID = createAgentPackageId('claude');
export const CLAUDE_AGENT_ID = createAgentId('claude');
export const CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER = 'claude.provider-api-key';
export const CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE = 'anthropic';
export const CLAUDE_AGENT_NETWORK_PRIVILEGE = 'api.anthropic.com';
export const CLAUDE_AGENT_TOOL_EXECUTOR_PRIVILEGE = 'host.bound-tools';
export const CLAUDE_AGENT_PERMISSION_MODE_PROPERTY = createAgentConfigurationPropertyId('claude.permissionMode');
export const CLAUDE_AGENT_THINKING_LEVEL_PROPERTY = createAgentConfigurationPropertyId('claude.thinkingLevel');
export const CLAUDE_AGENT_CREDENTIAL_PROPERTY = createAgentConfigurationPropertyId('claude.model.credential');
export const CLAUDE_AGENT_RESUME_SCHEMA = createAgentResumeSchemaId('claude.agent-sdk.resume.v2');

const displayName = localize('claudeAgent.displayName', 'Claude');
const description = localize('claudeAgent.description', 'Claude Agent SDK');

const hostDefaultsSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: CLAUDE_AGENT_ID,
	scope: 'hostDefault',
	revision: createAgentConfigurationSchemaRevision('claude.agent-sdk.host-defaults.v1'),
	properties: [{
		id: CLAUDE_AGENT_PERMISSION_MODE_PROPERTY,
		owner: { kind: 'agent', agent: CLAUDE_AGENT_ID },
		scopes: ['hostDefault', 'session'],
		value: { type: 'string', enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'] },
		required: true,
		default: 'default',
		sessionMutable: true,
		dynamicCompletion: false,
		display: { label: localize('claudeAgent.permissionMode', 'Permission Mode') },
		persistence: 'persisted',
		redaction: 'public',
	}],
});

export const CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA = validateAndFreezeAgentConfigurationSchema({
	...hostDefaultsSchema,
	scope: 'session',
	revision: createAgentConfigurationSchemaRevision('claude.agent-sdk.session.v1'),
});

export type ClaudeAgentThinkingLevel = 'none' | 'adaptive' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const CLAUDE_AGENT_CAPABILITY_REVISION = createAgentCapabilityRevision('claude.agent-sdk.capabilities.v1');

export function createClaudeAgentRegistrationRevision(
	descriptorRevision: AgentDescriptorRevision,
) {
	return createAgentRuntimeRegistrationRevision(`claude.agent-sdk.host.v1.${descriptorRevision}`);
}

export function createClaudeAgentModelConfigurationSchema(
	revision: AgentConfigurationSchemaRevision,
	thinkingLevels: readonly ClaudeAgentThinkingLevel[],
) {
	return validateAndFreezeAgentConfigurationSchema({
		profile: AgentConfigurationSchemaProfile,
		agent: CLAUDE_AGENT_ID,
		scope: 'model',
		revision,
		properties: [{
			id: CLAUDE_AGENT_THINKING_LEVEL_PROPERTY,
			owner: { kind: 'agent', agent: CLAUDE_AGENT_ID },
			scopes: ['model'],
			value: { type: 'string', enum: thinkingLevels },
			required: false,
			sessionMutable: false,
			dynamicCompletion: false,
			display: { label: localize('claudeAgent.thinkingLevel', 'Thinking Level') },
			persistence: 'persisted',
			redaction: 'public',
		}, {
			id: CLAUDE_AGENT_CREDENTIAL_PROPERTY,
			owner: { kind: 'agent', agent: CLAUDE_AGENT_ID },
			scopes: ['model'],
			value: {
				type: 'credentialReference',
				providers: [CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER],
				scopes: ['llm'],
				references: [CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE],
			},
			required: true,
			default: {
				provider: CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
				scope: 'llm',
				reference: CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
			},
			sessionMutable: false,
			dynamicCompletion: false,
			display: {
				label: localize('claudeAgent.credential', 'Credential'),
				description: localize('claudeAgent.credential.description', 'Anthropic API key used by the Claude Agent SDK.'),
			},
			persistence: 'persisted',
			redaction: 'credentialReference',
		}],
	});
}

export function createClaudeAgentDescriptor(
	descriptorRevision: AgentDescriptorRevision,
	models: IAgentDescriptor['models'],
): IAgentDescriptor {
	if (models.length === 0) {
		throw new Error('Claude Agent SDK model discovery returned an empty catalog.');
	}
	return Object.freeze({
		id: CLAUDE_AGENT_ID,
		packageId: CLAUDE_AGENT_PACKAGE_ID,
		revision: descriptorRevision,
		displayName,
		description,
		capabilities: Object.freeze({
			revision: CLAUDE_AGENT_CAPABILITY_REVISION,
			supportsEmptySession: true,
			supportsCreateChat: true,
			maximumChatCount: 64,
			supportsForkChat: false,
			supportsQueue: false,
			supportsSteering: false,
			supportsCancellation: true,
			supportsReleaseSession: true,
			supportsReleaseChat: true,
			supportsDeleteSession: true,
			supportsDeleteChat: true,
		}),
		models: Object.freeze([...models]),
		requiresAgentAuthentication: false,
	});
}

export function createClaudeAgentRegistration(
	descriptorRevision: AgentDescriptorRevision,
): IAgentRuntimeRegistration {
	return Object.freeze({
		packageId: CLAUDE_AGENT_PACKAGE_ID,
		agentId: CLAUDE_AGENT_ID,
		revision: createClaudeAgentRegistrationRevision(descriptorRevision),
		descriptorRevision,
		capabilityRevision: CLAUDE_AGENT_CAPABILITY_REVISION,
		hostDefaultsSchema,
		initialSessionConfigurationSchema: CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA.revision,
		supportedSessionConfigurationSchemas: Object.freeze([CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA.revision]),
		supportedToolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
		supportedResumeSchemas: Object.freeze([CLAUDE_AGENT_RESUME_SCHEMA]),
		resumeMigrationEdges: Object.freeze([]),
	});
}

export function createClaudeAgentSessionType(descriptor: IAgentDescriptor): IAgentHostSessionTypeDescriptor {
	if (descriptor.id !== CLAUDE_AGENT_ID || descriptor.packageId !== CLAUDE_AGENT_PACKAGE_ID) {
		throw new Error('Claude Agent package received another Agent descriptor.');
	}
	return Object.freeze({
		id: createAgentSessionTypeId('claude'),
		packageId: CLAUDE_AGENT_PACKAGE_ID,
		agentId: CLAUDE_AGENT_ID,
		displayName: Object.freeze({ kind: 'literal', value: displayName }),
		description: Object.freeze({ kind: 'literal', value: description }),
		capabilities: Object.freeze({
			workspace: 'optional',
			supportsEmptySession: true,
			supportsInitialTurn: true,
			supportsCreateChat: true,
			maximumChatCount: 64,
			supportsForkChat: false,
		}),
		models: Object.freeze(descriptor.models.map(model => model.id)),
		executionPresets: Object.freeze([]),
		automaticExecutionPreset: null,
		toolPolicy: Object.freeze({ kind: 'all' }),
	});
}

export const CLAUDE_AGENT_PACKAGE_DEFINITION = Object.freeze({
	packageId: CLAUDE_AGENT_PACKAGE_ID,
	agentId: CLAUDE_AGENT_ID,
	resolveRegistrationRevision: (descriptor: IAgentDescriptor) => (
		createClaudeAgentRegistrationRevision(descriptor.revision)
	),
	displayName,
	sessionConfigurationSchema: CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA,
	resolveSessionType: createClaudeAgentSessionType,
});
