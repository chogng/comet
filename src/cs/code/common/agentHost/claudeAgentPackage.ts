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
	createAgentDescriptorRevision,
	createAgentExecutionPresetId,
	createAgentId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPackageContentDigest,
	createAgentPackageId,
	createAgentPackageRevision,
	createAgentResumeSchemaId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionTypeId,
	type AgentPackageContentDigest,
} from 'cs/platform/agentHost/common/identities';
import type {
	IAgentPackageManifest,
	IAgentPackageOffering,
	IAgentPackageTarget,
	IInstalledAgentPackage,
} from 'cs/platform/agentHost/common/packages';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type { IAgentHostSessionTypeDescriptor } from 'cs/platform/agentHost/common/protocol';
import { COMET_TOOL_SCHEMA_PROFILE } from 'cs/platform/agentHost/common/tools';
import type { IVerifiedAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageTypes';
import type { ILocalAgentPackageProduct } from './agentPackageProducts.js';
import {
	localAgentRuntimeProcessPrivilege,
	localAgentRuntimeStateFilesystemPrivilege,
} from './localAgentRuntimeProtocol.js';

export const CLAUDE_AGENT_SDK_VERSION = '0.3.208';
export const CLAUDE_AGENT_PACKAGE_ID = createAgentPackageId('claude');
export const CLAUDE_AGENT_ID = createAgentId('claude');
export const CLAUDE_AGENT_RUNTIME_ENTRY_POINT = 'electron-utility/agentRuntime/claudeAgentRuntimeMain.js';
export const CLAUDE_AGENT_SDK_EXECUTABLE_TARGET = 'vendor/claude-agent-sdk/claude';
export const CLAUDE_AGENT_SDK_EXECUTABLE_WINDOWS_TARGET = 'vendor/claude-agent-sdk/claude.exe';
export const CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER = 'claude.provider-api-key';
export const CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE = 'anthropic';
export const CLAUDE_AGENT_NETWORK_PRIVILEGE = 'api.anthropic.com';
export const CLAUDE_AGENT_TOOL_EXECUTOR_PRIVILEGE = 'host.bound-tools';
export const CLAUDE_AGENT_PERMISSION_MODE_PROPERTY = createAgentConfigurationPropertyId('claude.permissionMode');
export const CLAUDE_AGENT_THINKING_LEVEL_PROPERTY = createAgentConfigurationPropertyId('claude.thinkingLevel');
export const CLAUDE_AGENT_CREDENTIAL_PROPERTY = createAgentConfigurationPropertyId('claude.model.credential');

export const CLAUDE_AGENT_RESUME_SCHEMA = createAgentResumeSchemaId('claude.agent-sdk.resume.v2');

const displayName = localize('claudeAgent.displayName', 'Claude');
const description = localize('claudeAgent.description', 'Claude Agent SDK runtime');

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

export const CLAUDE_AGENT_MODEL_CONFIGURATION_SCHEMA = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: CLAUDE_AGENT_ID,
	scope: 'model',
	revision: createAgentConfigurationSchemaRevision('claude.agent-sdk.model.v1'),
	properties: [{
		id: CLAUDE_AGENT_THINKING_LEVEL_PROPERTY,
		owner: { kind: 'agent', agent: CLAUDE_AGENT_ID },
		scopes: ['model'],
		value: { type: 'string', enum: ['none', 'low', 'medium', 'high'] },
		required: true,
		default: 'medium',
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

const descriptorRevision = createAgentDescriptorRevision('claude.agent-sdk.descriptor.v1');
const capabilityRevision = createAgentCapabilityRevision('claude.agent-sdk.capabilities.v1');
const model = Object.freeze({
	id: createAgentModelId('claude.agent-sdk-default'),
	revision: createAgentModelDescriptorRevision('claude.agent-sdk-default.v1'),
	displayName: localize('claudeAgent.model', 'Claude SDK Default'),
	enabled: true,
	configurationSchema: CLAUDE_AGENT_MODEL_CONFIGURATION_SCHEMA,
	toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
	attachments: Object.freeze({
		carriers: Object.freeze([]),
		shapes: Object.freeze([]),
		mediaTypes: Object.freeze([]),
		maximumCount: 0,
		maximumItemBytes: 0,
		maximumTotalBytes: 0,
		maximumTreeDepth: 0,
		maximumTreeEntries: 0,
		supportsClientContentForBackgroundExecution: false,
	}),
});

export const CLAUDE_AGENT_DESCRIPTOR: IAgentDescriptor = Object.freeze({
	id: CLAUDE_AGENT_ID,
	packageId: CLAUDE_AGENT_PACKAGE_ID,
	revision: descriptorRevision,
	displayName,
	description,
	capabilities: Object.freeze({
		revision: capabilityRevision,
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
	models: Object.freeze([model]),
	requiresAgentAuthentication: false,
});

export const CLAUDE_AGENT_RUNTIME_REGISTRATION: IAgentRuntimeRegistration = Object.freeze({
	packageId: CLAUDE_AGENT_PACKAGE_ID,
	agentId: CLAUDE_AGENT_ID,
	revision: createAgentRuntimeRegistrationRevision('claude.agent-sdk-runtime.v1'),
	descriptorRevision,
	capabilityRevision,
	hostDefaultsSchema,
	initialSessionConfigurationSchema: CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA.revision,
	supportedSessionConfigurationSchemas: Object.freeze([CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA.revision]),
	supportedToolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
	supportedResumeSchemas: Object.freeze([CLAUDE_AGENT_RESUME_SCHEMA]),
	resumeMigrationEdges: Object.freeze([]),
});

const automaticPreset = createAgentExecutionPresetId('claude.automatic');
export const CLAUDE_AGENT_SESSION_TYPE: IAgentHostSessionTypeDescriptor = Object.freeze({
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
	models: Object.freeze([model.id]),
	executionPresets: Object.freeze([Object.freeze({
		id: automaticPreset,
		displayName: Object.freeze({ kind: 'literal', value: localize('claudeAgent.executionPreset.automatic', 'Automatic') }),
		model: model.id,
	})]),
	automaticExecutionPreset: automaticPreset,
	toolPolicy: Object.freeze({ kind: 'all' }),
});

export const CLAUDE_AGENT_PACKAGE_DEFINITION = Object.freeze({
	packageId: CLAUDE_AGENT_PACKAGE_ID,
	agentId: CLAUDE_AGENT_ID,
	displayName,
	registration: CLAUDE_AGENT_RUNTIME_REGISTRATION,
	descriptor: CLAUDE_AGENT_DESCRIPTOR,
	sessionConfigurationSchema: CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA,
	modelConfigurationSchema: CLAUDE_AGENT_MODEL_CONFIGURATION_SCHEMA,
	sessionType: CLAUDE_AGENT_SESSION_TYPE,
});

export interface IClaudeAgentPackageArtifact {
	readonly source: string;
	readonly contentDigest: AgentPackageContentDigest;
}

export interface IClaudeAgentPackageArtifacts {
	readonly contentDigest: AgentPackageContentDigest;
	readonly runtime: IClaudeAgentPackageArtifact;
	readonly executable: IClaudeAgentPackageArtifact;
}

export interface IClaudeAgentPackageProduct extends ILocalAgentPackageProduct {
	readonly definition: typeof CLAUDE_AGENT_PACKAGE_DEFINITION;
	readonly verifiedPackage: IVerifiedAgentPackage;
}

export function claudeAgentSdkExecutableTarget(target: IAgentPackageTarget): string {
	return target.operatingSystem === 'win32'
		? CLAUDE_AGENT_SDK_EXECUTABLE_WINDOWS_TARGET
		: CLAUDE_AGENT_SDK_EXECUTABLE_TARGET;
}

/** Creates the exact Claude SDK product for one desktop target. */
export function createClaudeAgentPackageProduct(
	target: IAgentPackageTarget,
	artifacts: IClaudeAgentPackageArtifacts,
): IClaudeAgentPackageProduct {
	const revision = createAgentPackageRevision(
		`claude.agent-sdk.${CLAUDE_AGENT_SDK_VERSION}.${target.operatingSystem}.${target.architecture}`,
	);
	const executableTarget = claudeAgentSdkExecutableTarget(target);
	const dependencies = Object.freeze([Object.freeze({
		id: 'claude.agent-runtime',
		source: artifacts.runtime.source,
		target: CLAUDE_AGENT_RUNTIME_ENTRY_POINT,
		digest: artifacts.runtime.contentDigest,
		license: 'MIT and Anthropic Commercial Terms',
	}), Object.freeze({
		id: 'claude.agent-sdk-executable',
		source: artifacts.executable.source,
		target: executableTarget,
		digest: artifacts.executable.contentDigest,
		license: 'Anthropic Commercial Terms',
	})]);
	const privileges = Object.freeze([
		Object.freeze({ kind: 'process' as const, value: localAgentRuntimeProcessPrivilege }),
		Object.freeze({ kind: 'filesystem' as const, value: localAgentRuntimeStateFilesystemPrivilege }),
		Object.freeze({ kind: 'network' as const, value: CLAUDE_AGENT_NETWORK_PRIVILEGE }),
		Object.freeze({ kind: 'secret' as const, value: 'configured.model.api-key' }),
		Object.freeze({ kind: 'toolExecutor' as const, value: CLAUDE_AGENT_TOOL_EXECUTOR_PRIVILEGE }),
	]);
	const offering: IAgentPackageOffering = Object.freeze({
		packageId: CLAUDE_AGENT_PACKAGE_ID,
		revision,
		contentDigest: createAgentPackageContentDigest(artifacts.contentDigest),
		source: artifacts.runtime.source,
		distribution: 'user',
	});
	const manifest: IAgentPackageManifest = Object.freeze({
		schema: 1,
		packageId: CLAUDE_AGENT_PACKAGE_ID,
		revision,
		contentDigest: offering.contentDigest,
		publisher: 'Comet',
		target: Object.freeze({ ...target }),
		runtimeForm: 'connected',
		runtimeEntryPoint: CLAUDE_AGENT_RUNTIME_ENTRY_POINT,
		agentIds: Object.freeze([CLAUDE_AGENT_ID]),
		dependencies,
		privileges,
	});
	const verifiedPackage: IVerifiedAgentPackage = Object.freeze({
		offering,
		manifest,
		dependencyClosure: Object.freeze(dependencies.map(dependency => Object.freeze({
			...dependency,
			verifiedDigest: dependency.digest,
			immutable: true as const,
		}))),
		grantedPrivileges: privileges,
	});
	return Object.freeze({ definition: CLAUDE_AGENT_PACKAGE_DEFINITION, offering, verifiedPackage });
}

/** Rejects any installed bytes or authority outside the exact Claude SDK product. */
export function validateInstalledClaudeAgentPackage(
	installedPackage: IInstalledAgentPackage,
	authorizedProduct: IClaudeAgentPackageProduct,
): void {
	const expected: IInstalledAgentPackage = Object.freeze({
		...authorizedProduct.offering,
		manifest: authorizedProduct.verifiedPackage.manifest,
		dependencyClosure: authorizedProduct.verifiedPackage.dependencyClosure,
		grantedPrivileges: authorizedProduct.verifiedPackage.grantedPrivileges,
	});
	if (encodeAgentHostProtocolValue(installedPackage) !== encodeAgentHostProtocolValue(expected)) {
		throw new Error('Installed Claude Agent package does not match its exact SDK product artifact.');
	}
}
