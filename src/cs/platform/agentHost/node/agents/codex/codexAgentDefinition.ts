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

export const CODEX_AGENT_PACKAGE_ID = createAgentPackageId('codex');
export const CODEX_AGENT_ID = createAgentId('codex');
export const CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER = 'codex.provider-api-key';
export const CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE = 'openai';
export const CODEX_AGENT_NETWORK_PRIVILEGE = 'api.openai.com';
export const CODEX_AGENT_CATALOG_NETWORK_PRIVILEGE = 'chatgpt.com';
export const CODEX_AGENT_TOOL_EXECUTOR_PRIVILEGE = 'host.bound-tools';
export const CODEX_AGENT_APPROVAL_POLICY_PROPERTY = createAgentConfigurationPropertyId('codex.approvalPolicy');
export const CODEX_AGENT_SANDBOX_MODE_PROPERTY = createAgentConfigurationPropertyId('codex.sandboxMode');
export const CODEX_AGENT_WEB_SEARCH_MODE_PROPERTY = createAgentConfigurationPropertyId('codex.webSearchMode');
export const CODEX_AGENT_PERSONALITY_PROPERTY = createAgentConfigurationPropertyId('codex.personality');
export const CODEX_AGENT_REASONING_EFFORT_PROPERTY = createAgentConfigurationPropertyId('codex.modelReasoningEffort');
export const CODEX_AGENT_REASONING_SUMMARY_PROPERTY = createAgentConfigurationPropertyId('codex.reasoningSummary');
export const CODEX_AGENT_CREDENTIAL_PROPERTY = createAgentConfigurationPropertyId('codex.model.credential');
export const CODEX_AGENT_RESUME_SCHEMA = createAgentResumeSchemaId('codex.app-server.resume.v1');

export type CodexApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type CodexSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

const displayName = localize('codexAgent.displayName', 'Codex');
const description = localize('codexAgent.description', 'OpenAI Codex SDK');

const hostDefaultsSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: CODEX_AGENT_ID,
	scope: 'hostDefault',
	revision: createAgentConfigurationSchemaRevision('codex.app-server.host-defaults.v1'),
	properties: [{
		id: CODEX_AGENT_APPROVAL_POLICY_PROPERTY,
		owner: { kind: 'agent', agent: CODEX_AGENT_ID },
		scopes: ['hostDefault', 'session'],
		value: { type: 'string', enum: ['untrusted', 'on-failure', 'on-request', 'never'] },
		required: true,
		default: 'on-request',
		sessionMutable: true,
		dynamicCompletion: false,
		display: { label: localize('codexAgent.approvalPolicy', 'Approval Policy') },
		persistence: 'persisted',
		redaction: 'public',
	}, {
		id: CODEX_AGENT_SANDBOX_MODE_PROPERTY,
		owner: { kind: 'agent', agent: CODEX_AGENT_ID },
		scopes: ['hostDefault', 'session'],
		value: { type: 'string', enum: ['read-only', 'workspace-write', 'danger-full-access'] },
		required: true,
		default: 'workspace-write',
		sessionMutable: true,
		dynamicCompletion: false,
		display: { label: localize('codexAgent.sandboxMode', 'Sandbox Mode') },
		persistence: 'persisted',
		redaction: 'public',
	}, {
		id: CODEX_AGENT_WEB_SEARCH_MODE_PROPERTY,
		owner: { kind: 'agent', agent: CODEX_AGENT_ID },
		scopes: ['hostDefault', 'session'],
		value: { type: 'string', enum: ['disabled', 'cached', 'live'] },
		required: true,
		default: 'disabled',
		sessionMutable: true,
		dynamicCompletion: false,
		display: { label: localize('codexAgent.webSearchMode', 'Web Search') },
		persistence: 'persisted',
		redaction: 'public',
	}, {
		id: CODEX_AGENT_PERSONALITY_PROPERTY,
		owner: { kind: 'agent', agent: CODEX_AGENT_ID },
		scopes: ['hostDefault', 'session'],
		value: { type: 'string', enum: ['none', 'friendly', 'pragmatic'] },
		required: true,
		default: 'none',
		sessionMutable: true,
		dynamicCompletion: false,
		display: { label: localize('codexAgent.personality', 'Personality') },
		persistence: 'persisted',
		redaction: 'public',
	}],
});

export const CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA = validateAndFreezeAgentConfigurationSchema({
	...hostDefaultsSchema,
	scope: 'session',
	revision: createAgentConfigurationSchemaRevision('codex.app-server.session.v1'),
});

export const CODEX_AGENT_CAPABILITY_REVISION = createAgentCapabilityRevision('codex.app-server.capabilities.v2');

export function createCodexAgentRegistrationRevision(descriptorRevision: AgentDescriptorRevision) {
	return createAgentRuntimeRegistrationRevision(`codex.app-server.host.v1.${descriptorRevision}`);
}

export function createCodexAgentModelConfigurationSchema(
	revision: AgentConfigurationSchemaRevision,
	reasoningEfforts: readonly string[],
) {
	const defaultReasoningEffort = reasoningEfforts[0];
	if (defaultReasoningEffort === undefined) {
		throw new Error('Codex model must expose at least one reasoning effort.');
	}
	return validateAndFreezeAgentConfigurationSchema({
		profile: AgentConfigurationSchemaProfile,
		agent: CODEX_AGENT_ID,
		scope: 'model',
		revision,
		properties: [{
			id: CODEX_AGENT_REASONING_EFFORT_PROPERTY,
			owner: { kind: 'agent', agent: CODEX_AGENT_ID },
			scopes: ['model'],
			value: { type: 'string', enum: reasoningEfforts },
			required: true,
			default: defaultReasoningEffort,
			sessionMutable: false,
			dynamicCompletion: false,
			display: { label: localize('codexAgent.reasoningEffort', 'Reasoning Effort') },
			persistence: 'persisted',
			redaction: 'public',
		}, {
			id: CODEX_AGENT_REASONING_SUMMARY_PROPERTY,
			owner: { kind: 'agent', agent: CODEX_AGENT_ID },
			scopes: ['model'],
			value: { type: 'string', enum: ['none', 'auto', 'concise', 'detailed'] },
			required: true,
			default: 'auto',
			sessionMutable: false,
			dynamicCompletion: false,
			display: { label: localize('codexAgent.reasoningSummary', 'Reasoning Summary') },
			persistence: 'persisted',
			redaction: 'public',
		}, {
			id: CODEX_AGENT_CREDENTIAL_PROPERTY,
			owner: { kind: 'agent', agent: CODEX_AGENT_ID },
			scopes: ['model'],
			value: {
				type: 'credentialReference',
				providers: [CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER],
				scopes: ['llm'],
				references: [CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE],
			},
			required: true,
			default: {
				provider: CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER,
				scope: 'llm',
				reference: CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE,
			},
			sessionMutable: false,
			dynamicCompletion: false,
			display: {
				label: localize('codexAgent.credential', 'Credential'),
				description: localize('codexAgent.credential.description', 'OpenAI API key used by Codex.'),
			},
			persistence: 'persisted',
			redaction: 'credentialReference',
		}],
	});
}

export function createCodexAgentDescriptor(
	descriptorRevision: AgentDescriptorRevision,
	models: IAgentDescriptor['models'],
): IAgentDescriptor {
	if (models.length === 0) {
		throw new Error('Codex SDK model discovery returned an empty catalog.');
	}
	return Object.freeze({
		id: CODEX_AGENT_ID,
		packageId: CODEX_AGENT_PACKAGE_ID,
		revision: descriptorRevision,
		displayName,
		description,
		capabilities: Object.freeze({
			revision: CODEX_AGENT_CAPABILITY_REVISION,
			supportsEmptySession: true,
			supportsCreateChat: true,
			maximumChatCount: 64,
			supportsForkChat: true,
			supportsQueue: false,
			supportsSteering: true,
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

export function createCodexAgentRegistration(
	descriptorRevision: AgentDescriptorRevision,
): IAgentRuntimeRegistration {
	return Object.freeze({
		packageId: CODEX_AGENT_PACKAGE_ID,
		agentId: CODEX_AGENT_ID,
		revision: createCodexAgentRegistrationRevision(descriptorRevision),
		descriptorRevision,
		capabilityRevision: CODEX_AGENT_CAPABILITY_REVISION,
		hostDefaultsSchema,
		initialSessionConfigurationSchema: CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA.revision,
		supportedSessionConfigurationSchemas: Object.freeze([CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA.revision]),
		supportedToolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
		supportedResumeSchemas: Object.freeze([CODEX_AGENT_RESUME_SCHEMA]),
		resumeMigrationEdges: Object.freeze([]),
	});
}

export function createCodexAgentSessionType(descriptor: IAgentDescriptor): IAgentHostSessionTypeDescriptor {
	if (descriptor.id !== CODEX_AGENT_ID || descriptor.packageId !== CODEX_AGENT_PACKAGE_ID) {
		throw new Error('Codex Agent package received another Agent descriptor.');
	}
	return Object.freeze({
		id: createAgentSessionTypeId('codex'),
		packageId: CODEX_AGENT_PACKAGE_ID,
		agentId: CODEX_AGENT_ID,
		displayName: Object.freeze({ kind: 'literal', value: displayName }),
		description: Object.freeze({ kind: 'literal', value: description }),
		capabilities: Object.freeze({
			workspace: 'optional',
			supportsEmptySession: true,
			supportsInitialTurn: true,
			supportsCreateChat: true,
			maximumChatCount: 64,
			supportsForkChat: true,
		}),
		models: Object.freeze(descriptor.models.map(model => model.id)),
		executionPresets: Object.freeze([]),
		automaticExecutionPreset: null,
		toolPolicy: Object.freeze({ kind: 'all' }),
	});
}

export const CODEX_AGENT_PACKAGE_DEFINITION = Object.freeze({
	packageId: CODEX_AGENT_PACKAGE_ID,
	agentId: CODEX_AGENT_ID,
	resolveRegistrationRevision: (descriptor: IAgentDescriptor) => createCodexAgentRegistrationRevision(descriptor.revision),
	displayName,
	sessionConfigurationSchema: CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA,
	resolveSessionType: createCodexAgentSessionType,
});
