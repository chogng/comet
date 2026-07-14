/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'cs/nls';
import type { IAgentDescriptor, IAgentRuntimeRegistration } from 'cs/platform/agentHost/common/agent';
import {
	AgentConfigurationSchemaProfile,
	type AgentConfigurationScope,
	type IAgentConfigurationPropertySchema,
	type IAgentConfigurationSchema,
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
	type AgentId,
	type AgentPackageContentDigest,
	type AgentPackageId,
} from 'cs/platform/agentHost/common/identities';
import type {
	IAgentPackageManifest,
	IAgentPackageOffering,
	IAgentPackageTarget,
	IInstalledAgentPackage,
} from 'cs/platform/agentHost/common/packages';
import type { IVerifiedAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageTypes';
import type { IAgentHostSessionTypeDescriptor } from 'cs/platform/agentHost/common/protocol';
import {
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import { COMET_TOOL_SCHEMA_PROFILE } from 'cs/platform/agentHost/common/tools';
import type { ILocalAgentPackageProduct } from './agentPackageProducts.js';
import { localAgentRuntimeProcessPrivilege } from './localAgentRuntimeProtocol.js';

/** Stable runtime and presentation definition for one explicit mock Agent package. */
export interface IMockAgentPackageDefinition {
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly displayName: string;
	readonly registration: IAgentRuntimeRegistration;
	readonly descriptor: IAgentDescriptor;
	readonly sessionConfigurationSchema: IAgentConfigurationSchema;
	readonly modelConfigurationSchema: IAgentConfigurationSchema;
	readonly sessionType: IAgentHostSessionTypeDescriptor;
}
interface IConfigurationAxis {
	readonly id: string;
	readonly label: string;
	readonly values: readonly string[];
	readonly defaultValue: string;
	readonly scopes: readonly AgentConfigurationScope[];
	readonly sessionMutable: boolean;
}

interface IMockAgentDefinitionSpec {
	readonly id: 'copilot' | 'codex';
	readonly displayName: string;
	readonly description: string;
	readonly modelDisplayName: string;
	readonly sessionAxes: readonly IConfigurationAxis[];
	readonly modelAxes: readonly IConfigurationAxis[];
}

export interface IMockAgentRuntimeArtifact {
	readonly source: string;
	readonly contentDigest: AgentPackageContentDigest;
}

/** One exact product-authorized mock package and its connected runtime definition. */
export interface IMockAgentPackageProduct extends ILocalAgentPackageProduct {
	readonly definition: IMockAgentPackageDefinition;
	readonly offering: IAgentPackageOffering;
	readonly verifiedPackage: IVerifiedAgentPackage;
}

export const mockAgentRuntimeEntryPoint = 'electron-utility/agentRuntime/mockAgentRuntimeMain.js';

function axis(
	id: string,
	label: string,
	values: readonly string[],
	defaultValue: string,
	scopes: readonly AgentConfigurationScope[],
	sessionMutable: boolean,
): IConfigurationAxis {
	return Object.freeze({
		id,
		label,
		values: Object.freeze([...values]),
		defaultValue,
		scopes: Object.freeze([...scopes]),
		sessionMutable,
	});
}

const definitionSpecs: readonly IMockAgentDefinitionSpec[] = Object.freeze([
	Object.freeze({
		id: 'copilot' as const,
		displayName: localize('mockAgent.copilot.displayName', 'Copilot'),
		description: localize('mockAgent.copilot.description', 'Explicit connected mock for the Copilot Agent package'),
		modelDisplayName: localize('mockAgent.copilot.model', 'Copilot Mock Model'),
		sessionAxes: Object.freeze([
			axis('copilot.mode', localize('mockAgent.copilot.mode', 'Mode'), ['interactive', 'plan', 'autopilot'], 'interactive', ['hostDefault', 'session'], true),
			axis('copilot.autoApprove', localize('mockAgent.copilot.autoApprove', 'Auto Approve'), ['default', 'autoApprove'], 'default', ['hostDefault', 'session'], true),
			axis('copilot.isolation', localize('mockAgent.copilot.isolation', 'Isolation'), ['folder', 'worktree'], 'folder', ['hostDefault', 'session'], true),
		]),
		modelAxes: Object.freeze([]),
	}),
	Object.freeze({
		id: 'codex' as const,
		displayName: localize('mockAgent.codex.displayName', 'Codex'),
		description: localize('mockAgent.codex.description', 'Explicit connected mock for the Codex Agent package'),
		modelDisplayName: localize('mockAgent.codex.model', 'Codex Mock Model'),
		sessionAxes: Object.freeze([
			axis('codex.approvalPolicy', localize('mockAgent.codex.approvalPolicy', 'Approval Policy'), ['never', 'on-request', 'on-failure', 'untrusted'], 'on-request', ['hostDefault', 'session'], true),
			axis('codex.sandboxMode', localize('mockAgent.codex.sandboxMode', 'Sandbox Mode'), ['read-only', 'workspace-write', 'danger-full-access'], 'workspace-write', ['hostDefault', 'session'], true),
			axis('codex.webSearchMode', localize('mockAgent.codex.webSearchMode', 'Web Search Mode'), ['disabled', 'cached', 'live'], 'disabled', ['hostDefault', 'session'], true),
			axis('codex.personality', localize('mockAgent.codex.personality', 'Personality'), ['none', 'friendly', 'pragmatic'], 'none', ['hostDefault', 'session'], true),
		]),
		modelAxes: Object.freeze([
			axis('codex.modelReasoningEffort', localize('mockAgent.codex.modelReasoningEffort', 'Model Reasoning Effort'), ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], 'medium', ['model'], false),
			axis('codex.reasoningSummary', localize('mockAgent.codex.reasoningSummary', 'Reasoning Summary'), ['none', 'auto', 'concise', 'detailed'], 'auto', ['model'], false),
		]),
	}),
]);

function property(agent: AgentId, value: IConfigurationAxis): IAgentConfigurationPropertySchema {
	return Object.freeze({
		id: createAgentConfigurationPropertyId(value.id),
		owner: Object.freeze({ kind: 'agent' as const, agent }),
		scopes: value.scopes,
		value: Object.freeze({ type: 'string' as const, enum: value.values }),
		required: true,
		default: value.defaultValue,
		sessionMutable: value.sessionMutable,
		dynamicCompletion: false,
		display: Object.freeze({ label: value.label }),
		persistence: 'persisted' as const,
		redaction: 'public' as const,
	});
}

function schema(
	agent: AgentId,
	scope: AgentConfigurationScope,
	revision: string,
	axes: readonly IConfigurationAxis[],
): IAgentConfigurationSchema {
	return validateAndFreezeAgentConfigurationSchema(Object.freeze({
		profile: AgentConfigurationSchemaProfile,
		agent,
		scope,
		revision: createAgentConfigurationSchemaRevision(revision),
		properties: Object.freeze(axes.map(value => property(agent, value))),
	}));
}

function createDefinition(spec: IMockAgentDefinitionSpec): IMockAgentPackageDefinition {
	const packageId = createAgentPackageId(spec.id);
	const agentId = createAgentId(spec.id);
	const hostDefaultsSchema = schema(agentId, 'hostDefault', `${spec.id}.mock.host-defaults.v1`, spec.sessionAxes);
	const sessionConfigurationSchema = schema(agentId, 'session', `${spec.id}.mock.session.v1`, spec.sessionAxes);
	const modelConfigurationSchema = schema(agentId, 'model', `${spec.id}.mock.model.v1`, spec.modelAxes);
	const descriptorRevision = createAgentDescriptorRevision(`${spec.id}.mock.descriptor.v1`);
	const capabilityRevision = createAgentCapabilityRevision(`${spec.id}.mock.capabilities.v1`);
	const model = Object.freeze({
		id: createAgentModelId(`${spec.id}.mock-model`),
		revision: createAgentModelDescriptorRevision(`${spec.id}.mock-model.v1`),
		displayName: spec.modelDisplayName,
		enabled: true,
		configurationSchema: modelConfigurationSchema,
		toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
		attachments: Object.freeze({
			carriers: Object.freeze(['inline' as const, 'reference' as const]),
			shapes: Object.freeze(['blob' as const, 'tree' as const]),
			mediaTypes: Object.freeze(['text/plain', 'application/json', 'image/png', 'image/jpeg']),
			maximumCount: 32,
			maximumItemBytes: 16 * 1024 * 1024,
			maximumTotalBytes: 64 * 1024 * 1024,
			maximumTreeDepth: 16,
			maximumTreeEntries: 4_096,
			supportsClientContentForBackgroundExecution: false,
		}),
	});
	const descriptor: IAgentDescriptor = Object.freeze({
		id: agentId,
		packageId,
		revision: descriptorRevision,
		displayName: spec.displayName,
		description: spec.description,
		capabilities: Object.freeze({
			revision: capabilityRevision,
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
		models: Object.freeze([model]),
		requiresAgentAuthentication: false,
	});
	const registration: IAgentRuntimeRegistration = Object.freeze({
		packageId,
		agentId,
		revision: createAgentRuntimeRegistrationRevision(`${spec.id}.mock-runtime.v1`),
		descriptorRevision,
		capabilityRevision,
		hostDefaultsSchema,
		initialSessionConfigurationSchema: sessionConfigurationSchema.revision,
		supportedSessionConfigurationSchemas: Object.freeze([sessionConfigurationSchema.revision]),
		supportedToolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
		supportedResumeSchemas: Object.freeze([createAgentResumeSchemaId(`${spec.id}.mock-resume.v1`)]),
		resumeMigrationEdges: Object.freeze([]),
	});
	const automaticPreset = createAgentExecutionPresetId(`${spec.id}.automatic`);
	const sessionType: IAgentHostSessionTypeDescriptor = Object.freeze({
		id: createAgentSessionTypeId(spec.id),
		packageId,
		agentId,
		displayName: Object.freeze({ kind: 'literal' as const, value: spec.displayName }),
		description: Object.freeze({ kind: 'literal' as const, value: spec.description }),
		capabilities: Object.freeze({
			workspace: 'optional' as const,
			supportsEmptySession: true,
			supportsInitialTurn: true,
			supportsCreateChat: true,
			maximumChatCount: 64,
			supportsForkChat: true,
		}),
		models: Object.freeze([model.id]),
		executionPresets: Object.freeze([Object.freeze({
			id: automaticPreset,
			displayName: Object.freeze({
				kind: 'literal' as const,
				value: localize('mockAgent.executionPreset.automatic', 'Automatic'),
			}),
			model: model.id,
		})]),
		automaticExecutionPreset: automaticPreset,
		toolPolicy: Object.freeze({ kind: 'all' as const }),
	});
	return Object.freeze({
		packageId,
		agentId,
		displayName: spec.displayName,
		registration,
		descriptor,
		sessionConfigurationSchema,
		modelConfigurationSchema,
		sessionType,
	});
}

const definitions = Object.freeze(definitionSpecs.map(createDefinition));

export const mockAgentPackageIds = Object.freeze(definitions.map(definition => definition.packageId));

/** Resolves one exact product mock definition by package identity. */
export function getMockAgentPackageDefinition(packageId: AgentPackageId): IMockAgentPackageDefinition {
	const definition = definitions.find(candidate => candidate.packageId === packageId);
	if (definition === undefined) {
		throw new Error(`Unknown mock Agent package "${packageId}".`);
	}
	return definition;
}

/** Creates installable products for the addressed Host target without installing them. */
export function createMockAgentPackageProducts(
	target: IAgentPackageTarget,
	artifact: IMockAgentRuntimeArtifact,
): readonly IMockAgentPackageProduct[] {
	return Object.freeze(definitionSpecs.map((spec, index) => {
		const definition = definitions[index];
		const revision = createAgentPackageRevision(
			`${spec.id}.mock.v1.${target.operatingSystem}.${target.architecture}`,
		);
		const contentDigest = createAgentPackageContentDigest(artifact.contentDigest);
		const source = artifact.source;
		const privileges = Object.freeze([Object.freeze({
			kind: 'process' as const,
			value: localAgentRuntimeProcessPrivilege,
		})]);
		const dependency = Object.freeze({
			id: `${spec.id}.mock-runtime`,
			source,
			target: mockAgentRuntimeEntryPoint,
			digest: contentDigest,
			license: 'MIT',
		});
		const offering: IAgentPackageOffering = Object.freeze({
			packageId: definition.packageId,
			revision,
			contentDigest,
			source,
			distribution: 'user',
		});
		const targetValue = Object.freeze({ ...target });
		const manifest: IAgentPackageManifest = Object.freeze({
			schema: 1,
			packageId: definition.packageId,
			revision,
			contentDigest,
			publisher: 'Comet',
			target: targetValue,
			runtimeForm: 'connected',
			runtimeEntryPoint: dependency.target,
			agentIds: Object.freeze([definition.agentId]),
			dependencies: Object.freeze([dependency]),
			privileges,
		});
		const verifiedPackage = Object.freeze({
			offering,
			manifest,
			dependencyClosure: Object.freeze([Object.freeze({
				...dependency,
				verifiedDigest: contentDigest,
				immutable: true as const,
			})]),
			grantedPrivileges: privileges,
		});
		return Object.freeze({ definition, offering, verifiedPackage });
	}));
}

/** Validates one installed package against the exact mock product authorized for its target. */
export function validateInstalledMockAgentPackage(
	installedPackage: IInstalledAgentPackage,
	authorizedProducts: readonly IMockAgentPackageProduct[],
): IMockAgentPackageDefinition {
	const matchingProducts = authorizedProducts.filter(candidate => (
		candidate.offering.packageId === installedPackage.packageId
	));
	if (matchingProducts.length !== 1) {
		throw new Error(`Mock Agent package "${installedPackage.packageId}" has no unique product authorization.`);
	}
	const product = matchingProducts[0];
	const expectedInstalledPackage: IInstalledAgentPackage = Object.freeze({
		...product.offering,
		manifest: product.verifiedPackage.manifest,
		dependencyClosure: product.verifiedPackage.dependencyClosure,
		grantedPrivileges: product.verifiedPackage.grantedPrivileges,
	});
	if (encodeAgentHostProtocolValue(installedPackage) !== encodeAgentHostProtocolValue(expectedInstalledPackage)) {
		throw new Error(`Installed mock Agent package "${installedPackage.packageId}" does not match its exact product artifact.`);
	}
	return product.definition;
}

/** Returns canonical values for all configurable axes of one mock Agent. */
export function mockAgentConfigurationDefaults(
	definition: IMockAgentPackageDefinition,
	scope: 'session' | 'model',
): Readonly<Record<string, AgentHostProtocolValue>> {
	const schemaValue = scope === 'session'
		? definition.sessionConfigurationSchema
		: definition.modelConfigurationSchema;
	return Object.freeze(Object.fromEntries(
		schemaValue.properties.map(value => [value.id, value.default as AgentHostProtocolValue]),
	));
}
