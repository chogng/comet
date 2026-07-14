/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	AgentConfigurationSchemaProfile,
	IAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationSchema,
} from 'cs/platform/agentHost/common/configuration';
import {
	AgentConfigurationSchemaRevision,
	createAgentConfigurationPropertyId,
	createAgentConfigurationSchemaRevision,
	createAgentId,
} from 'cs/platform/agentHost/common/identities';

const cometAgentId = createAgentId('comet');

export const COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA_REVISION =
	createAgentConfigurationSchemaRevision('comet.host-defaults.v1');
export const COMET_SESSION_CONFIGURATION_SCHEMA_REVISION =
	createAgentConfigurationSchemaRevision('comet.session.v1');
export const COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY =
	createAgentConfigurationPropertyId('comet.model.endpoint');
export const COMET_MODEL_PROVIDER_MODEL_CONFIGURATION_PROPERTY =
	createAgentConfigurationPropertyId('comet.model.provider-model');
export const COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY =
	createAgentConfigurationPropertyId('comet.model.credential');
export const COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER = 'comet.provider-api-key';

function createEmptySchema(
	scope: IAgentConfigurationSchema['scope'],
	revision: AgentConfigurationSchemaRevision,
): IAgentConfigurationSchema {
	return validateAndFreezeAgentConfigurationSchema({
		profile: AgentConfigurationSchemaProfile,
		agent: cometAgentId,
		scope,
		revision,
		properties: [],
	});
}

export const COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA = createEmptySchema(
	'hostDefault',
	COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA_REVISION,
);

export const COMET_SESSION_CONFIGURATION_SCHEMA = createEmptySchema(
	'session',
	COMET_SESSION_CONFIGURATION_SCHEMA_REVISION,
);

export interface ICometModelConfigurationSchemaOptions {
	readonly revision: AgentConfigurationSchemaRevision;
	readonly endpoint: string;
	readonly providerModel: string;
	readonly credentialReference: string;
}

/** Defines the exact SDK-neutral connection surface for one Comet model descriptor. */
export function createCometModelConfigurationSchema(
	options: ICometModelConfigurationSchemaOptions,
): IAgentConfigurationSchema {
	return validateAndFreezeAgentConfigurationSchema({
		profile: AgentConfigurationSchemaProfile,
		agent: cometAgentId,
		scope: 'model',
		revision: options.revision,
		properties: [
			{
				id: COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY,
				owner: { kind: 'agent', agent: cometAgentId },
				scopes: ['model'],
				value: {
					type: 'string',
					minimumLength: 1,
					maximumLength: 4_096,
					enum: [options.endpoint],
				},
				required: true,
				default: options.endpoint,
				sessionMutable: false,
				dynamicCompletion: false,
				display: {
					label: 'Endpoint',
					description: 'Exact model-provider request endpoint for this model.',
				},
				persistence: 'persisted',
				redaction: 'public',
			},
			{
				id: COMET_MODEL_PROVIDER_MODEL_CONFIGURATION_PROPERTY,
				owner: { kind: 'agent', agent: cometAgentId },
				scopes: ['model'],
				value: {
					type: 'string',
					minimumLength: 1,
					maximumLength: 256,
					enum: [options.providerModel],
				},
				required: true,
				default: options.providerModel,
				sessionMutable: false,
				dynamicCompletion: false,
				display: {
					label: 'Provider model',
					description: 'Exact provider-native model identity used for this selection.',
				},
				persistence: 'persisted',
				redaction: 'public',
			},
			{
				id: COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY,
				owner: { kind: 'agent', agent: cometAgentId },
				scopes: ['model'],
				value: {
					type: 'credentialReference',
					providers: [COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER],
					scopes: ['llm'],
					references: [options.credentialReference],
				},
				required: true,
				default: {
					provider: COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER,
					scope: 'llm',
					reference: options.credentialReference,
				},
				sessionMutable: false,
				dynamicCompletion: false,
				display: {
					label: 'Credential',
					description: 'Reference to the provider API key authorized for this Turn.',
				},
				persistence: 'persisted',
				redaction: 'credentialReference',
			},
		],
	});
}
