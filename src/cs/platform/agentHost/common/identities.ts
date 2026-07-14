/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentHostError, AgentHostErrorCode } from './errors.js';

declare const agentHostIdentityBrand: unique symbol;

type AgentHostIdentity<TName extends string> = string & { readonly [agentHostIdentityBrand]: TName };
type AgentHostCounter<TName extends string> = number & { readonly [agentHostIdentityBrand]: TName };

export type AgentHostAuthorityId = AgentHostIdentity<'AgentHostAuthorityId'>;
export type AgentHostClientConnectionId = AgentHostIdentity<'AgentHostClientConnectionId'>;
export type AgentRuntimeConnectionId = AgentHostIdentity<'AgentRuntimeConnectionId'>;
export type AgentRuntimeConnectionGeneration = AgentHostCounter<'AgentRuntimeConnectionGeneration'>;
export type AgentRuntimeCallId = AgentHostIdentity<'AgentRuntimeCallId'>;
export type AgentRuntimeHostOperationId = AgentHostIdentity<'AgentRuntimeHostOperationId'>;
export type AgentRuntimeActionSequence = AgentHostCounter<'AgentRuntimeActionSequence'>;
export type AgentPackageId = AgentHostIdentity<'AgentPackageId'>;
export type AgentPackageRevision = AgentHostIdentity<'AgentPackageRevision'>;
export type AgentPackageContentDigest = AgentHostIdentity<'AgentPackageContentDigest'>;
export type AgentPackageOperationId = AgentHostIdentity<'AgentPackageOperationId'>;
export type AgentId = AgentHostIdentity<'AgentId'>;
export type AgentConfigurationSchemaRevision = AgentHostIdentity<'AgentConfigurationSchemaRevision'>;
export type AgentConfigurationPropertyId = AgentHostIdentity<'AgentConfigurationPropertyId'>;
export type AgentConfigurationStateRevision = AgentHostIdentity<'AgentConfigurationStateRevision'>;
export type AgentDescriptorRevision = AgentHostIdentity<'AgentDescriptorRevision'>;
export type AgentModelDescriptorRevision = AgentHostIdentity<'AgentModelDescriptorRevision'>;
export type AgentModelId = AgentHostIdentity<'AgentModelId'>;
export type AgentSessionTypeId = AgentHostIdentity<'AgentSessionTypeId'>;
export type AgentCapabilityRevision = AgentHostIdentity<'AgentCapabilityRevision'>;
export type AgentRuntimeRegistrationRevision = AgentHostIdentity<'AgentRuntimeRegistrationRevision'>;
export type AgentExecutionProfileRevision = AgentHostIdentity<'AgentExecutionProfileRevision'>;
export type AgentExecutionProfileDigest = AgentHostIdentity<'AgentExecutionProfileDigest'>;
export type AgentExecutionPresetId = AgentHostIdentity<'AgentExecutionPresetId'>;
export type AgentResumeSchemaId = AgentHostIdentity<'AgentResumeSchemaId'>;
export type AgentResumeStateDigest = AgentHostIdentity<'AgentResumeStateDigest'>;
export type AgentSessionId = AgentHostIdentity<'AgentSessionId'>;
export type AgentChatId = AgentHostIdentity<'AgentChatId'>;
export type AgentTurnId = AgentHostIdentity<'AgentTurnId'>;
export type AgentSubmissionId = AgentHostIdentity<'AgentSubmissionId'>;
export type AgentCancellationId = AgentHostIdentity<'AgentCancellationId'>;
export type AgentToolSetRevision = AgentHostIdentity<'AgentToolSetRevision'>;
export type AgentToolSchemaProfileId = AgentHostIdentity<'AgentToolSchemaProfileId'>;
export type AgentToolId = AgentHostIdentity<'AgentToolId'>;
export type AgentToolCallId = AgentHostIdentity<'AgentToolCallId'>;
export type AgentToolDescriptorRevision = AgentHostIdentity<'AgentToolDescriptorRevision'>;
export type AgentToolRegistrationId = AgentHostIdentity<'AgentToolRegistrationId'>;
export type AgentToolRegistrationRevision = AgentHostIdentity<'AgentToolRegistrationRevision'>;
export type AgentToolExecutorId = AgentHostIdentity<'AgentToolExecutorId'>;
export type AgentToolContributorId = AgentHostIdentity<'AgentToolContributorId'>;
export type AgentMcpServerId = AgentHostIdentity<'AgentMcpServerId'>;
export type AgentHostOperationId = AgentHostIdentity<'AgentHostOperationId'>;
export type AgentHostPayloadDigest = AgentHostIdentity<'AgentHostPayloadDigest'>;
export type AgentHostActionDigest = AgentHostIdentity<'AgentHostActionDigest'>;
export type AgentHostChannelId = AgentHostIdentity<'AgentHostChannelId'>;
export type AgentHostProtocolVersion = AgentHostIdentity<'AgentHostProtocolVersion'>;
export type AgentRuntimeProtocolVersion = AgentHostIdentity<'AgentRuntimeProtocolVersion'>;
export type AgentHostCapabilityId = AgentHostIdentity<'AgentHostCapabilityId'>;
export type AgentHostCapabilityRevision = AgentHostIdentity<'AgentHostCapabilityRevision'>;
export type AgentAttachmentId = AgentHostIdentity<'AgentAttachmentId'>;
export type AgentAttachmentProducerTypeId = AgentHostIdentity<'AgentAttachmentProducerTypeId'>;
export type AgentAttachmentRepresentationSchemaId = AgentHostIdentity<'AgentAttachmentRepresentationSchemaId'>;
export type AgentContentReferenceId = AgentHostIdentity<'AgentContentReferenceId'>;
export type AgentContentVersion = AgentHostIdentity<'AgentContentVersion'>;
export type AgentContentDigest = AgentHostIdentity<'AgentContentDigest'>;
export type AgentContentLeaseId = AgentHostIdentity<'AgentContentLeaseId'>;
export type AgentContentMaterializationId = AgentHostIdentity<'AgentContentMaterializationId'>;
export type AgentInteractionTargetId = AgentHostIdentity<'AgentInteractionTargetId'>;
export type AgentInteractionTargetTypeId = AgentHostIdentity<'AgentInteractionTargetTypeId'>;
export type AgentInteractionTargetOwnerId = AgentHostIdentity<'AgentInteractionTargetOwnerId'>;
export type AgentInteractionTargetRevision = AgentHostIdentity<'AgentInteractionTargetRevision'>;
export type AgentHostSequence = AgentHostCounter<'AgentHostSequence'>;
export type AgentHostChannelRevision = AgentHostCounter<'AgentHostChannelRevision'>;

const namedIdentityPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const configurationPropertyIdentityPattern = /^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/;
const opaqueIdentityPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const channelIdentityPattern = /^[\x21-\x7E]+$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const protocolVersionPattern = /^[1-9][0-9]*$/;

function assertIdentity(value: string, identity: string, maximumLength: number, pattern: RegExp): string {
	if (value.length === 0 || value.length > maximumLength || !pattern.test(value)) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidIdentity,
			`Invalid ${identity}`,
			{ identity, value: value.slice(0, 256) },
		);
	}

	return value;
}

function createNamedIdentity<TName extends string>(value: string, identity: TName): AgentHostIdentity<TName> {
	return assertIdentity(value, identity, 128, namedIdentityPattern) as AgentHostIdentity<TName>;
}

function createOpaqueIdentity<TName extends string>(value: string, identity: TName): AgentHostIdentity<TName> {
	return assertIdentity(value, identity, 128, opaqueIdentityPattern) as AgentHostIdentity<TName>;
}

function createDigest<TName extends string>(value: string, identity: TName): AgentHostIdentity<TName> {
	return assertIdentity(value, identity, 71, digestPattern) as AgentHostIdentity<TName>;
}

function createCounter<TName extends string>(value: number, identity: TName): AgentHostCounter<TName> {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			`Invalid ${identity}`,
			{ field: identity, value },
		);
	}

	return value as AgentHostCounter<TName>;
}

export function createAgentHostAuthorityId(value: string): AgentHostAuthorityId {
	return assertIdentity(value, 'AgentHostAuthorityId', 512, channelIdentityPattern) as AgentHostAuthorityId;
}

export function createAgentHostClientConnectionId(value: string): AgentHostClientConnectionId {
	return createOpaqueIdentity(value, 'AgentHostClientConnectionId');
}

export function createAgentRuntimeConnectionId(value: string): AgentRuntimeConnectionId {
	return createOpaqueIdentity(value, 'AgentRuntimeConnectionId');
}

export function createAgentRuntimeConnectionGeneration(value: number): AgentRuntimeConnectionGeneration {
	return createCounter(value, 'AgentRuntimeConnectionGeneration');
}

export function createAgentRuntimeCallId(value: string): AgentRuntimeCallId {
	return createOpaqueIdentity(value, 'AgentRuntimeCallId');
}

export function createAgentRuntimeHostOperationId(value: string): AgentRuntimeHostOperationId {
	return createOpaqueIdentity(value, 'AgentRuntimeHostOperationId');
}

export function createAgentRuntimeActionSequence(value: number): AgentRuntimeActionSequence {
	return createCounter(value, 'AgentRuntimeActionSequence');
}

export function createAgentPackageId(value: string): AgentPackageId {
	return createNamedIdentity(value, 'AgentPackageId');
}

export function createAgentPackageRevision(value: string): AgentPackageRevision {
	return createOpaqueIdentity(value, 'AgentPackageRevision');
}

export function createAgentPackageContentDigest(value: string): AgentPackageContentDigest {
	return createDigest(value, 'AgentPackageContentDigest');
}

export function createAgentPackageOperationId(value: string): AgentPackageOperationId {
	return createOpaqueIdentity(value, 'AgentPackageOperationId');
}

export function createAgentId(value: string): AgentId {
	return createNamedIdentity(value, 'AgentId');
}

export function createAgentConfigurationSchemaRevision(value: string): AgentConfigurationSchemaRevision {
	return createOpaqueIdentity(value, 'AgentConfigurationSchemaRevision');
}

export function createAgentConfigurationPropertyId(value: string): AgentConfigurationPropertyId {
	return assertIdentity(
		value,
		'AgentConfigurationPropertyId',
		128,
		configurationPropertyIdentityPattern,
	) as AgentConfigurationPropertyId;
}

export function createAgentConfigurationStateRevision(value: string): AgentConfigurationStateRevision {
	return createOpaqueIdentity(value, 'AgentConfigurationStateRevision');
}

export function createAgentDescriptorRevision(value: string): AgentDescriptorRevision {
	return createOpaqueIdentity(value, 'AgentDescriptorRevision');
}

export function createAgentModelDescriptorRevision(value: string): AgentModelDescriptorRevision {
	return createOpaqueIdentity(value, 'AgentModelDescriptorRevision');
}

export function createAgentModelId(value: string): AgentModelId {
	return createOpaqueIdentity(value, 'AgentModelId');
}

export function createAgentSessionTypeId(value: string): AgentSessionTypeId {
	return createNamedIdentity(value, 'AgentSessionTypeId');
}

export function createAgentCapabilityRevision(value: string): AgentCapabilityRevision {
	return createOpaqueIdentity(value, 'AgentCapabilityRevision');
}

export function createAgentRuntimeRegistrationRevision(value: string): AgentRuntimeRegistrationRevision {
	return createOpaqueIdentity(value, 'AgentRuntimeRegistrationRevision');
}

export function createAgentExecutionProfileRevision(value: string): AgentExecutionProfileRevision {
	return createOpaqueIdentity(value, 'AgentExecutionProfileRevision');
}

export function createAgentExecutionProfileDigest(value: string): AgentExecutionProfileDigest {
	return createDigest(value, 'AgentExecutionProfileDigest');
}

export function createAgentExecutionPresetId(value: string): AgentExecutionPresetId {
	return createNamedIdentity(value, 'AgentExecutionPresetId');
}

export function createAgentResumeSchemaId(value: string): AgentResumeSchemaId {
	return createNamedIdentity(value, 'AgentResumeSchemaId');
}

export function createAgentResumeStateDigest(value: string): AgentResumeStateDigest {
	return createDigest(value, 'AgentResumeStateDigest');
}

export function createAgentSessionId(value: string): AgentSessionId {
	return createOpaqueIdentity(value, 'AgentSessionId');
}

export function createAgentChatId(value: string): AgentChatId {
	return createOpaqueIdentity(value, 'AgentChatId');
}

export function createAgentTurnId(value: string): AgentTurnId {
	return createOpaqueIdentity(value, 'AgentTurnId');
}

export function createAgentSubmissionId(value: string): AgentSubmissionId {
	return createOpaqueIdentity(value, 'AgentSubmissionId');
}

export function createAgentCancellationId(value: string): AgentCancellationId {
	return createOpaqueIdentity(value, 'AgentCancellationId');
}

export function createAgentToolSetRevision(value: string): AgentToolSetRevision {
	return createOpaqueIdentity(value, 'AgentToolSetRevision');
}

export function createAgentToolSchemaProfileId(value: string): AgentToolSchemaProfileId {
	return createNamedIdentity(value, 'AgentToolSchemaProfileId');
}

export function createAgentToolId(value: string): AgentToolId {
	return createNamedIdentity(value, 'AgentToolId');
}

export function createAgentToolCallId(value: string): AgentToolCallId {
	return createOpaqueIdentity(value, 'AgentToolCallId');
}

export function createAgentToolDescriptorRevision(value: string): AgentToolDescriptorRevision {
	return createOpaqueIdentity(value, 'AgentToolDescriptorRevision');
}

export function createAgentToolRegistrationId(value: string): AgentToolRegistrationId {
	return createOpaqueIdentity(value, 'AgentToolRegistrationId');
}

export function createAgentToolRegistrationRevision(value: string): AgentToolRegistrationRevision {
	return createOpaqueIdentity(value, 'AgentToolRegistrationRevision');
}

export function createAgentToolExecutorId(value: string): AgentToolExecutorId {
	return createOpaqueIdentity(value, 'AgentToolExecutorId');
}

export function createAgentToolContributorId(value: string): AgentToolContributorId {
	return createNamedIdentity(value, 'AgentToolContributorId');
}

export function createAgentMcpServerId(value: string): AgentMcpServerId {
	return createOpaqueIdentity(value, 'AgentMcpServerId');
}

export function createAgentHostOperationId(value: string): AgentHostOperationId {
	return createOpaqueIdentity(value, 'AgentHostOperationId');
}

export function createAgentHostPayloadDigest(value: string): AgentHostPayloadDigest {
	return createDigest(value, 'AgentHostPayloadDigest');
}

export function createAgentHostActionDigest(value: string): AgentHostActionDigest {
	return createDigest(value, 'AgentHostActionDigest');
}

export function createAgentHostChannelId(value: string): AgentHostChannelId {
	return assertIdentity(value, 'AgentHostChannelId', 256, channelIdentityPattern) as AgentHostChannelId;
}

export function createAgentHostProtocolVersion(value: string): AgentHostProtocolVersion {
	return assertIdentity(value, 'AgentHostProtocolVersion', 8, protocolVersionPattern) as AgentHostProtocolVersion;
}

export function createAgentRuntimeProtocolVersion(value: string): AgentRuntimeProtocolVersion {
	return assertIdentity(value, 'AgentRuntimeProtocolVersion', 8, protocolVersionPattern) as AgentRuntimeProtocolVersion;
}

export function createAgentHostCapabilityId(value: string): AgentHostCapabilityId {
	return createNamedIdentity(value, 'AgentHostCapabilityId');
}

export function createAgentHostCapabilityRevision(value: string): AgentHostCapabilityRevision {
	return createOpaqueIdentity(value, 'AgentHostCapabilityRevision');
}

export function createAgentAttachmentId(value: string): AgentAttachmentId {
	return createOpaqueIdentity(value, 'AgentAttachmentId');
}

export function createAgentAttachmentProducerTypeId(value: string): AgentAttachmentProducerTypeId {
	return createNamedIdentity(value, 'AgentAttachmentProducerTypeId');
}

export function createAgentAttachmentRepresentationSchemaId(value: string): AgentAttachmentRepresentationSchemaId {
	return createNamedIdentity(value, 'AgentAttachmentRepresentationSchemaId');
}

export function createAgentContentReferenceId(value: string): AgentContentReferenceId {
	return assertIdentity(value, 'AgentContentReferenceId', 2_048, channelIdentityPattern) as AgentContentReferenceId;
}

export function createAgentContentVersion(value: string): AgentContentVersion {
	return createOpaqueIdentity(value, 'AgentContentVersion');
}

export function createAgentContentDigest(value: string): AgentContentDigest {
	return createDigest(value, 'AgentContentDigest');
}

export function createAgentContentLeaseId(value: string): AgentContentLeaseId {
	return createOpaqueIdentity(value, 'AgentContentLeaseId');
}

export function createAgentContentMaterializationId(value: string): AgentContentMaterializationId {
	return createOpaqueIdentity(value, 'AgentContentMaterializationId');
}

export function createAgentInteractionTargetId(value: string): AgentInteractionTargetId {
	return createOpaqueIdentity(value, 'AgentInteractionTargetId');
}

export function createAgentInteractionTargetTypeId(value: string): AgentInteractionTargetTypeId {
	return createNamedIdentity(value, 'AgentInteractionTargetTypeId');
}

export function createAgentInteractionTargetOwnerId(value: string): AgentInteractionTargetOwnerId {
	return createNamedIdentity(value, 'AgentInteractionTargetOwnerId');
}

export function createAgentInteractionTargetRevision(value: string): AgentInteractionTargetRevision {
	return createOpaqueIdentity(value, 'AgentInteractionTargetRevision');
}

export function createAgentHostSequence(value: number): AgentHostSequence {
	return createCounter(value, 'AgentHostSequence');
}

export function createAgentHostChannelRevision(value: number): AgentHostChannelRevision {
	return createCounter(value, 'AgentHostChannelRevision');
}
