/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IpcMainInvokeEvent, WebContents } from 'electron';

import { raceCancellationError } from 'cs/base/common/async';
import {
	CancellationError,
	type CancellationToken,
	CancellationTokenNone,
	isCancellationError,
} from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from 'cs/base/common/lifecycle';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import type { ElectronMainChannelServer } from 'cs/base/parts/ipc/electron-main/ipcMain';
import { appError, isAppError } from 'cs/base/parts/sandbox/common/appError';
import type { IAgentWorkspace } from 'cs/platform/agentHost/common/agent';
import {
	assertAgentHostAttachment,
	assertAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	type IAgentConfigurationCandidate,
	type IAgentConfigurationState,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationCompletions,
	validateAndFreezeAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import { validateAndFreezeAgentCredentialReference } from 'cs/platform/agentHost/common/credentials';
import {
	localAgentHostClientContentResourceChannelName,
	localAgentHostClientToolChannelName,
} from 'cs/platform/agentHost/common/connectionChannel';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentConfigurationPropertyId,
	createAgentConfigurationSchemaRevision,
	createAgentConfigurationStateRevision,
	createAgentChatId,
	createAgentExecutionPresetId,
	createAgentHostCapabilityId,
	createAgentHostCapabilityRevision,
	createAgentHostChannelId,
	createAgentHostClientConnectionId,
	type AgentHostClientConnectionId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentHostProtocolVersion,
	createAgentHostSequence,
	createAgentId,
	createAgentModelId,
	createAgentPackageId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSessionTypeId,
	createAgentSubmissionId,
	createAgentToolCallId,
	createAgentToolId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentPackageOperationOutcome,
	assertAgentPackageOperationOutcomeRequest,
	assertAgentPackageOperationRequest,
} from 'cs/platform/agentHost/common/packages';
import {
	assertAgentHostReconnectResult,
	assertAgentHostSetSubscriptionsResult,
	type AgentHostMutationPayload,
	type AgentHostReconnectResult,
	type IAgentHostInitializeRequest,
	type IAgentHostMutationRequest,
	type IAgentHostOperationOutcomeRequest,
	type IAgentHostPrepareSubmissionRequest,
	type IAgentHostPreparedSubmission,
	type IAgentHostReconnectRequest,
	type IAgentHostResolveSessionConfigurationRequest,
	type IAgentHostResolveSessionConfigurationResult,
	type IAgentHostSetSubscriptionsRequest,
	type IAgentHostSetSubscriptionsResult,
	type IAgentHostSessionConfigurationCompletionsRequest,
	type IAgentHostSessionConfigurationCompletionsResult,
} from 'cs/platform/agentHost/common/protocol';
import {
	assertAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	validateAndFreezeAgentClientToolPublicationSnapshot,
} from 'cs/platform/agentHost/common/tools';
import type { IAgentContentResourceClientRouter } from 'cs/platform/agentHost/node/content/agentContentResourceService';
import { AgentClientToolPublication } from 'cs/platform/agentHost/node/tools/agentClientToolPublication';
import { AgentToolEndpointRegistry } from 'cs/platform/agentHost/node/tools/agentToolExecution';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';
import { ClientAgentToolChannelClient } from './clientAgentToolChannel.js';
import { ClientContentResourceChannelClient } from './clientContentResourceChannel.js';

const localAgentHostErrorCode = 'AGENT_HOST_ERROR';
const localAgentHostCancellationErrorCode = 'AGENT_HOST_CANCELLED';
const localAgentHostChannelErrorCode = 'AGENT_HOST_CHANNEL_ERROR';
const localAgentHostProtocolVersion = createAgentHostProtocolVersion('5');

type ProtocolRecord = Readonly<Record<string, unknown>>;

function invalidProtocol(field: string, value: unknown): never {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid local Agent Host connection request',
		{ field, value: diagnostic },
	);
}

function requireRecord(value: unknown, field: string): ProtocolRecord {
	assertAgentHostProtocolValue(value);
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidProtocol(field, value);
	}
	return value as ProtocolRecord;
}

function requireExactKeys(
	record: ProtocolRecord,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			invalidProtocol(`${field}.${key}`, key);
		}
	}
	for (const key of required) {
		if (!Object.hasOwn(record, key)) {
			invalidProtocol(`${field}.${key}`, 'missing');
		}
	}
}

function requireString(value: unknown, field: string, allowEmpty = false): string {
	if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
		return invalidProtocol(field, value);
	}
	return value;
}

function requireBoolean(value: unknown, field: string): boolean {
	if (typeof value !== 'boolean') {
		return invalidProtocol(field, value);
	}
	return value;
}

function requireArray(value: unknown, field: string): readonly unknown[] {
	if (!Array.isArray(value)) {
		return invalidProtocol(field, value);
	}
	return value;
}

function requireSafeCounter(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		return invalidProtocol(field, value);
	}
	return value;
}

function validateConfigurationCandidateShape(value: unknown, field: string): IAgentConfigurationCandidate {
	const candidate = requireRecord(value, field);
	requireExactKeys(candidate, ['schema', 'values'], [], field);
	const schema = createAgentConfigurationSchemaRevision(requireString(candidate.schema, `${field}.schema`));
	const values = requireRecord(candidate.values, `${field}.values`) as Readonly<Record<string, AgentHostProtocolValue>>;
	return Object.freeze({
		schema,
		values: Object.freeze({ ...values }),
	});
}

function validateSessionConfigurationState(
	value: unknown,
	field: string,
	agent?: ReturnType<typeof createAgentId>,
): IAgentConfigurationState {
	const state = requireRecord(value, field);
	const schema = validateAndFreezeAgentConfigurationSchema(state.schema);
	return validateAndFreezeAgentConfigurationState(value as IAgentConfigurationState, {
		agent: agent ?? schema.agent,
		scope: 'session',
	});
}

function assertDistinct(values: readonly string[], field: string): void {
	if (new Set(values).size !== values.length) {
		invalidProtocol(field, values.length);
	}
}

function assertWorkspace(value: unknown, field: string): asserts value is IAgentWorkspace {
	const workspace = requireRecord(value, field);
	requireExactKeys(workspace, ['resource', 'label', 'folders'], [], field);
	requireString(workspace.resource, `${field}.resource`);
	requireString(workspace.label, `${field}.label`);
	for (const [index, folderValue] of requireArray(workspace.folders, `${field}.folders`).entries()) {
		const folderField = `${field}.folders.${index}`;
		const folder = requireRecord(folderValue, folderField);
		requireExactKeys(folder, ['resource', 'workingDirectory', 'name'], ['repository'], folderField);
		requireString(folder.resource, `${folderField}.resource`);
		requireString(folder.workingDirectory, `${folderField}.workingDirectory`);
		requireString(folder.name, `${folderField}.name`);
		if (folder.repository !== undefined) {
			const repositoryField = `${folderField}.repository`;
			const repository = requireRecord(folder.repository, repositoryField);
			requireExactKeys(repository, ['root'], ['branch', 'baseBranch'], repositoryField);
			requireString(repository.root, `${repositoryField}.root`);
			if (repository.branch !== undefined) {
				requireString(repository.branch, `${repositoryField}.branch`, true);
			}
			if (repository.baseBranch !== undefined) {
				requireString(repository.baseBranch, `${repositoryField}.baseBranch`, true);
			}
		}
	}
}

function assertChatOrigin(value: unknown, field: string): void {
	const origin = requireRecord(value, field);
	const kind = requireString(origin.kind, `${field}.kind`);
	if (kind === 'user') {
		requireExactKeys(origin, ['kind'], [], field);
		return;
	}
	if (kind === 'fork') {
		requireExactKeys(origin, ['kind', 'parentChat', 'parentTurn'], [], field);
		createAgentChatId(requireString(origin.parentChat, `${field}.parentChat`));
		createAgentTurnId(requireString(origin.parentTurn, `${field}.parentTurn`));
		return;
	}
	if (kind === 'tool') {
		requireExactKeys(origin, ['kind', 'parentChat', 'parentTurn', 'toolCall'], [], field);
		createAgentChatId(requireString(origin.parentChat, `${field}.parentChat`));
		createAgentTurnId(requireString(origin.parentTurn, `${field}.parentTurn`));
		createAgentToolCallId(requireString(origin.toolCall, `${field}.toolCall`));
		return;
	}
	invalidProtocol(`${field}.kind`, kind);
}

function assertPreparedSubmission(value: unknown, field: string): asserts value is IAgentHostPreparedSubmission {
	const submission = requireRecord(value, field);
	requireExactKeys(submission, [
		'submission',
		'payloadDigest',
		'message',
		'attachments',
		'interactionTargets',
		'sessionConfiguration',
		'modelConfiguration',
		'credentials',
		'executionProfile',
		'runtimeRegistration',
		'toolSet',
		'requestedDeadline',
		'outputConstraints',
	], [], field);
	createAgentSubmissionId(requireString(submission.submission, `${field}.submission`));
	createAgentHostPayloadDigest(requireString(submission.payloadDigest, `${field}.payloadDigest`));
	requireString(submission.message, `${field}.message`, true);
	for (const attachment of requireArray(submission.attachments, `${field}.attachments`)) {
		assertAgentHostAttachment(attachment);
	}
	for (const target of requireArray(submission.interactionTargets, `${field}.interactionTargets`)) {
		assertAgentHostInteractionTarget(target);
	}
	validateSessionConfigurationState(submission.sessionConfiguration, `${field}.sessionConfiguration`);
	validateConfigurationCandidateShape(submission.modelConfiguration, `${field}.modelConfiguration`);
	for (const credential of requireArray(submission.credentials, `${field}.credentials`)) {
		validateAndFreezeAgentCredentialReference(credential);
	}
	requireRecord(submission.executionProfile, `${field}.executionProfile`);
	createAgentRuntimeRegistrationRevision(requireString(submission.runtimeRegistration, `${field}.runtimeRegistration`));
	requireRecord(submission.toolSet, `${field}.toolSet`);
	requireSafeCounter(submission.requestedDeadline, `${field}.requestedDeadline`);
	assertAgentHostProtocolValue(submission.outputConstraints);
}

function assertPrepareSubmissionRequest(value: unknown): asserts value is IAgentHostPrepareSubmissionRequest {
	const request = requireRecord(value, 'prepareSubmission');
	requireExactKeys(request, [
		'submission',
		'target',
		'capture',
		'captureDigest',
		'executionSelection',
		'toolPolicy',
	], [], 'prepareSubmission');
	createAgentSubmissionId(requireString(request.submission, 'prepareSubmission.submission'));
	createAgentHostPayloadDigest(requireString(request.captureDigest, 'prepareSubmission.captureDigest'));

	const target = requireRecord(request.target, 'prepareSubmission.target');
	const targetKind = requireString(target.kind, 'prepareSubmission.target.kind');
	if (targetKind === 'chat') {
		requireExactKeys(target, ['kind', 'session', 'chat'], [], 'prepareSubmission.target');
		createAgentSessionId(requireString(target.session, 'prepareSubmission.target.session'));
		createAgentChatId(requireString(target.chat, 'prepareSubmission.target.chat'));
	} else if (targetKind === 'draft') {
		requireExactKeys(target, ['kind', 'sessionType', 'configuration'], ['workspace'], 'prepareSubmission.target');
		createAgentSessionTypeId(requireString(target.sessionType, 'prepareSubmission.target.sessionType'));
		validateConfigurationCandidateShape(target.configuration, 'prepareSubmission.target.configuration');
		if (target.workspace !== undefined) {
			assertWorkspace(target.workspace, 'prepareSubmission.target.workspace');
		}
	} else {
		invalidProtocol('prepareSubmission.target.kind', targetKind);
	}

	const capture = requireRecord(request.capture, 'prepareSubmission.capture');
	requireExactKeys(capture, ['message', 'attachments', 'interactionTargets'], [], 'prepareSubmission.capture');
	requireString(capture.message, 'prepareSubmission.capture.message', true);
	for (const attachment of requireArray(capture.attachments, 'prepareSubmission.capture.attachments')) {
		assertAgentHostAttachment(attachment);
	}
	for (const interactionTarget of requireArray(capture.interactionTargets, 'prepareSubmission.capture.interactionTargets')) {
		assertAgentHostInteractionTarget(interactionTarget);
	}

	const selection = requireRecord(request.executionSelection, 'prepareSubmission.executionSelection');
	const selectionKind = requireString(selection.kind, 'prepareSubmission.executionSelection.kind');
	if (selectionKind === 'model') {
		requireExactKeys(selection, ['kind', 'model', 'configuration'], [], 'prepareSubmission.executionSelection');
		createAgentModelId(requireString(selection.model, 'prepareSubmission.executionSelection.model'));
		validateConfigurationCandidateShape(
			selection.configuration,
			'prepareSubmission.executionSelection.configuration',
		);
	} else if (selectionKind === 'preset') {
		requireExactKeys(selection, ['kind', 'preset', 'configuration'], [], 'prepareSubmission.executionSelection');
		createAgentExecutionPresetId(requireString(selection.preset, 'prepareSubmission.executionSelection.preset'));
		validateConfigurationCandidateShape(
			selection.configuration,
			'prepareSubmission.executionSelection.configuration',
		);
	} else {
		invalidProtocol('prepareSubmission.executionSelection.kind', selectionKind);
	}

	const toolPolicy = requireRecord(request.toolPolicy, 'prepareSubmission.toolPolicy');
	const toolPolicyKind = requireString(toolPolicy.kind, 'prepareSubmission.toolPolicy.kind');
	if (toolPolicyKind === 'all') {
		requireExactKeys(toolPolicy, ['kind'], [], 'prepareSubmission.toolPolicy');
	} else if (toolPolicyKind === 'selected') {
		requireExactKeys(toolPolicy, ['kind', 'tools'], [], 'prepareSubmission.toolPolicy');
		const tools = requireArray(toolPolicy.tools, 'prepareSubmission.toolPolicy.tools').map((tool, index) => (
			createAgentToolId(requireString(tool, `prepareSubmission.toolPolicy.tools.${index}`))
		));
		assertDistinct(tools, 'prepareSubmission.toolPolicy.tools');
	} else {
		invalidProtocol('prepareSubmission.toolPolicy.kind', toolPolicyKind);
	}
}

function assertCreateSessionChat(value: unknown, field: string): void {
	const chat = requireRecord(value, field);
	requireExactKeys(chat, ['model', 'origin'], ['title', 'initialSubmission'], field);
	if (chat.title !== undefined) {
		requireString(chat.title, `${field}.title`, true);
	}
	if (chat.model !== null) {
		createAgentModelId(requireString(chat.model, `${field}.model`));
	}
	assertChatOrigin(chat.origin, `${field}.origin`);
	if (chat.initialSubmission !== undefined) {
		assertPreparedSubmission(chat.initialSubmission, `${field}.initialSubmission`);
	}
}

function assertMutationPayload(value: unknown): asserts value is AgentHostMutationPayload {
	const payload = requireRecord(value, 'mutation.payload');
	const kind = requireString(payload.kind, 'mutation.payload.kind');
	switch (kind) {
		case 'createSession': {
			requireExactKeys(
				payload,
				['kind', 'sessionType', 'configuration', 'chats'],
				['workspace'],
				'mutation.payload',
			);
			createAgentSessionTypeId(requireString(payload.sessionType, 'mutation.payload.sessionType'));
			validateConfigurationCandidateShape(payload.configuration, 'mutation.payload.configuration');
			if (payload.workspace !== undefined) {
				assertWorkspace(payload.workspace, 'mutation.payload.workspace');
			}
			for (const [index, chat] of requireArray(payload.chats, 'mutation.payload.chats').entries()) {
				assertCreateSessionChat(chat, `mutation.payload.chats.${index}`);
			}
			return;
		}
		case 'updateAgentDefaults':
			requireExactKeys(
				payload,
				['kind', 'agent', 'expectedRevision', 'candidate'],
				[],
				'mutation.payload',
			);
			createAgentId(requireString(payload.agent, 'mutation.payload.agent'));
			createAgentConfigurationStateRevision(requireString(
				payload.expectedRevision,
				'mutation.payload.expectedRevision',
			));
			validateConfigurationCandidateShape(payload.candidate, 'mutation.payload.candidate');
			return;
		case 'updateSessionConfiguration':
			requireExactKeys(
				payload,
				['kind', 'session', 'expectedRevision', 'candidate'],
				[],
				'mutation.payload',
			);
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			createAgentConfigurationStateRevision(requireString(
				payload.expectedRevision,
				'mutation.payload.expectedRevision',
			));
			validateConfigurationCandidateShape(payload.candidate, 'mutation.payload.candidate');
			return;
		case 'createChat':
			requireExactKeys(payload, ['kind', 'session', 'model', 'origin'], ['title'], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			if (payload.title !== undefined) {
				requireString(payload.title, 'mutation.payload.title', true);
			}
			if (payload.model !== null) {
				createAgentModelId(requireString(payload.model, 'mutation.payload.model'));
			}
			assertChatOrigin(payload.origin, 'mutation.payload.origin');
			return;
		case 'forkChat':
			requireExactKeys(payload, ['kind', 'session', 'sourceChat', 'sourceTurn'], [], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			createAgentChatId(requireString(payload.sourceChat, 'mutation.payload.sourceChat'));
			createAgentTurnId(requireString(payload.sourceTurn, 'mutation.payload.sourceTurn'));
			return;
		case 'renameSession':
			requireExactKeys(payload, ['kind', 'session', 'title'], [], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			requireString(payload.title, 'mutation.payload.title');
			return;
		case 'renameChat':
			requireExactKeys(payload, ['kind', 'session', 'chat', 'title'], [], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			createAgentChatId(requireString(payload.chat, 'mutation.payload.chat'));
			requireString(payload.title, 'mutation.payload.title');
			return;
		case 'setChatModel':
			requireExactKeys(payload, ['kind', 'session', 'chat', 'model'], [], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			createAgentChatId(requireString(payload.chat, 'mutation.payload.chat'));
			if (payload.model !== null) {
				createAgentModelId(requireString(payload.model, 'mutation.payload.model'));
			}
			return;
		case 'setSessionArchived':
			requireExactKeys(payload, ['kind', 'session', 'archived'], [], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			requireBoolean(payload.archived, 'mutation.payload.archived');
			return;
		case 'materializeSession':
		case 'releaseSession':
		case 'deleteSession':
			requireExactKeys(payload, ['kind', 'session'], [], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			return;
		case 'materializeChat':
		case 'releaseChat':
		case 'deleteChat':
			requireExactKeys(payload, ['kind', 'session', 'chat'], [], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			createAgentChatId(requireString(payload.chat, 'mutation.payload.chat'));
			return;
		case 'submitTurn':
			requireExactKeys(payload, ['kind', 'session', 'chat', 'submission'], [], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			createAgentChatId(requireString(payload.chat, 'mutation.payload.chat'));
			assertPreparedSubmission(payload.submission, 'mutation.payload.submission');
			return;
		case 'cancelTurn':
			requireExactKeys(payload, ['kind', 'session', 'chat', 'turn'], [], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			createAgentChatId(requireString(payload.chat, 'mutation.payload.chat'));
			createAgentTurnId(requireString(payload.turn, 'mutation.payload.turn'));
			return;
		case 'steerTurn':
			requireExactKeys(payload, ['kind', 'session', 'chat', 'turn', 'message'], [], 'mutation.payload');
			createAgentSessionId(requireString(payload.session, 'mutation.payload.session'));
			createAgentChatId(requireString(payload.chat, 'mutation.payload.chat'));
			createAgentTurnId(requireString(payload.turn, 'mutation.payload.turn'));
			requireString(payload.message, 'mutation.payload.message');
			return;
		case 'authenticateAgent': {
			requireExactKeys(
				payload,
				['kind', 'packageId', 'agentId', 'registration', 'credential'],
				[],
				'mutation.payload',
			);
			createAgentPackageId(requireString(payload.packageId, 'mutation.payload.packageId'));
			createAgentId(requireString(payload.agentId, 'mutation.payload.agentId'));
			createAgentRuntimeRegistrationRevision(requireString(
				payload.registration,
				'mutation.payload.registration',
			));
			const credential = requireRecord(payload.credential, 'mutation.payload.credential');
			requireExactKeys(
				credential,
				['provider', 'scope', 'reference'],
				[],
				'mutation.payload.credential',
			);
			requireString(credential.provider, 'mutation.payload.credential.provider');
			requireString(credential.scope, 'mutation.payload.credential.scope');
			requireString(credential.reference, 'mutation.payload.credential.reference');
			return;
		}
	}
	invalidProtocol('mutation.payload.kind', kind);
}

function assertInitializeRequest(value: unknown, connection: IAgentHostConnection): asserts value is IAgentHostInitializeRequest {
	const request = requireRecord(value, 'initialize');
	requireExactKeys(request, [
		'connection',
		'protocolVersions',
		'capabilities',
		'locale',
		'implementation',
		'subscriptions',
	], [], 'initialize');
	const requestedConnection = createAgentHostClientConnectionId(requireString(request.connection, 'initialize.connection'));
	if (requestedConnection !== connection.connection) {
		invalidProtocol('initialize.connection', requestedConnection);
	}
	const protocols = requireArray(request.protocolVersions, 'initialize.protocolVersions').map((version, index) => (
		createAgentHostProtocolVersion(requireString(version, `initialize.protocolVersions.${index}`))
	));
	if (protocols.length !== 1 || protocols[0] !== localAgentHostProtocolVersion) {
		invalidProtocol('initialize.protocolVersions', protocols.length);
	}
	const capabilityIds: string[] = [];
	for (const [index, capabilityValue] of requireArray(request.capabilities, 'initialize.capabilities').entries()) {
		const field = `initialize.capabilities.${index}`;
		const capability = requireRecord(capabilityValue, field);
		requireExactKeys(capability, ['id', 'revision'], [], field);
		capabilityIds.push(createAgentHostCapabilityId(requireString(capability.id, `${field}.id`)));
		createAgentHostCapabilityRevision(requireString(capability.revision, `${field}.revision`));
	}
	assertDistinct(capabilityIds, 'initialize.capabilities');
	requireString(request.locale, 'initialize.locale');
	const implementation = requireRecord(request.implementation, 'initialize.implementation');
	requireExactKeys(implementation, ['name', 'build'], [], 'initialize.implementation');
	requireString(implementation.name, 'initialize.implementation.name');
	requireString(implementation.build, 'initialize.implementation.build');
	const subscriptions = requireArray(request.subscriptions, 'initialize.subscriptions').map((channel, index) => (
		createAgentHostChannelId(requireString(channel, `initialize.subscriptions.${index}`))
	));
	assertDistinct(subscriptions, 'initialize.subscriptions');
}

function assertReconnectRequest(value: unknown, connection: IAgentHostConnection): asserts value is IAgentHostReconnectRequest {
	const request = requireRecord(value, 'reconnect');
	requireExactKeys(request, ['connection', 'lastHostSequence', 'subscriptions'], [], 'reconnect');
	const requestedConnection = createAgentHostClientConnectionId(requireString(request.connection, 'reconnect.connection'));
	if (requestedConnection !== connection.connection) {
		invalidProtocol('reconnect.connection', requestedConnection);
	}
	createAgentHostSequence(requireSafeCounter(request.lastHostSequence, 'reconnect.lastHostSequence'));
	const subscriptions = requireArray(request.subscriptions, 'reconnect.subscriptions').map((channel, index) => (
		createAgentHostChannelId(requireString(channel, `reconnect.subscriptions.${index}`))
	));
	assertDistinct(subscriptions, 'reconnect.subscriptions');
}

function assertSetSubscriptionsRequest(value: unknown): asserts value is IAgentHostSetSubscriptionsRequest {
	const request = requireRecord(value, 'setSubscriptions');
	requireExactKeys(request, ['subscriptions'], [], 'setSubscriptions');
	const subscriptions = requireArray(request.subscriptions, 'setSubscriptions.subscriptions').map((channel, index) => (
		createAgentHostChannelId(requireString(channel, `setSubscriptions.subscriptions.${index}`))
	));
	assertDistinct(subscriptions, 'setSubscriptions.subscriptions');
}

function assertResolveSessionConfigurationRequest(
	value: unknown,
): asserts value is IAgentHostResolveSessionConfigurationRequest {
	const request = requireRecord(value, 'resolveSessionConfiguration');
	requireExactKeys(
		request,
		['sessionType', 'candidate'],
		['workspace'],
		'resolveSessionConfiguration',
	);
	createAgentSessionTypeId(requireString(request.sessionType, 'resolveSessionConfiguration.sessionType'));
	validateConfigurationCandidateShape(request.candidate, 'resolveSessionConfiguration.candidate');
	if (request.workspace !== undefined) {
		assertWorkspace(request.workspace, 'resolveSessionConfiguration.workspace');
	}
}

function validateResolveSessionConfigurationResult(value: unknown): IAgentHostResolveSessionConfigurationResult {
	const result = requireRecord(value, 'resolveSessionConfiguration.result');
	requireExactKeys(
		result,
		['agent', 'runtimeRegistration', 'configuration'],
		[],
		'resolveSessionConfiguration.result',
	);
	const agent = createAgentId(requireString(result.agent, 'resolveSessionConfiguration.result.agent'));
	const runtimeRegistration = createAgentRuntimeRegistrationRevision(requireString(
		result.runtimeRegistration,
		'resolveSessionConfiguration.result.runtimeRegistration',
	));
	const configuration = validateSessionConfigurationState(
		result.configuration,
		'resolveSessionConfiguration.result.configuration',
		agent,
	);
	return Object.freeze({ agent, runtimeRegistration, configuration });
}

function assertSessionConfigurationCompletionsRequest(
	value: unknown,
): asserts value is IAgentHostSessionConfigurationCompletionsRequest {
	const request = requireRecord(value, 'completeSessionConfiguration');
	requireExactKeys(request, [
		'sessionType',
		'candidate',
		'resolvedSchema',
		'property',
		'query',
		'limit',
	], ['workspace'], 'completeSessionConfiguration');
	createAgentSessionTypeId(requireString(request.sessionType, 'completeSessionConfiguration.sessionType'));
	if (request.workspace !== undefined) {
		assertWorkspace(request.workspace, 'completeSessionConfiguration.workspace');
	}
	const schema = validateAndFreezeAgentConfigurationSchema(request.resolvedSchema);
	if (schema.scope !== 'session') {
		invalidProtocol('completeSessionConfiguration.resolvedSchema.scope', schema.scope);
	}
	validateAndFreezeAgentConfigurationCandidate(
		schema,
		validateConfigurationCandidateShape(request.candidate, 'completeSessionConfiguration.candidate'),
		'session',
	);
	createAgentConfigurationPropertyId(requireString(request.property, 'completeSessionConfiguration.property'));
	const query = requireString(request.query, 'completeSessionConfiguration.query', true);
	if (query.length > 4_096) {
		invalidProtocol('completeSessionConfiguration.query', query.length);
	}
	if (
		typeof request.limit !== 'number'
		|| !Number.isSafeInteger(request.limit)
		|| request.limit < 1
		|| request.limit > 100
	) {
		invalidProtocol('completeSessionConfiguration.limit', request.limit);
	}
}

function validateSessionConfigurationCompletionsResult(
	request: IAgentHostSessionConfigurationCompletionsRequest,
	value: unknown,
): IAgentHostSessionConfigurationCompletionsResult {
	const result = requireRecord(value, 'completeSessionConfiguration.result');
	requireExactKeys(
		result,
		['agent', 'runtimeRegistration', 'schema', 'completions'],
		[],
		'completeSessionConfiguration.result',
	);
	const agent = createAgentId(requireString(result.agent, 'completeSessionConfiguration.result.agent'));
	if (agent !== request.resolvedSchema.agent) {
		invalidProtocol('completeSessionConfiguration.result.agent', agent);
	}
	const runtimeRegistration = createAgentRuntimeRegistrationRevision(requireString(
		result.runtimeRegistration,
		'completeSessionConfiguration.result.runtimeRegistration',
	));
	const schema = createAgentConfigurationSchemaRevision(requireString(
		result.schema,
		'completeSessionConfiguration.result.schema',
	));
	if (schema !== request.resolvedSchema.revision) {
		invalidProtocol('completeSessionConfiguration.result.schema', schema);
	}
	if (!Array.isArray(result.completions)) {
		invalidProtocol('completeSessionConfiguration.result.completions', result.completions);
	}
	const completions = validateAndFreezeAgentConfigurationCompletions(
		request.resolvedSchema,
		request.property,
		result.completions,
	);
	return Object.freeze({ agent, runtimeRegistration, schema, completions });
}

function assertPrepareSubmissionResult(value: unknown): void {
	const result = requireRecord(value, 'prepareSubmission.result');
	const kind = requireString(result.kind, 'prepareSubmission.result.kind');
	if (kind === 'prepared') {
		requireExactKeys(result, ['kind', 'submission'], [], 'prepareSubmission.result');
		assertPreparedSubmission(result.submission, 'prepareSubmission.result.submission');
		return;
	}
	if (kind !== 'rejected') {
		invalidProtocol('prepareSubmission.result.kind', kind);
	}
	requireExactKeys(result, ['kind', 'failure'], [], 'prepareSubmission.result');
	const failure = requireRecord(result.failure, 'prepareSubmission.result.failure');
	requireExactKeys(
		failure,
		['code', 'message', 'reconciliation'],
		['data'],
		'prepareSubmission.result.failure',
	);
	requireString(failure.code, 'prepareSubmission.result.failure.code');
	requireString(failure.message, 'prepareSubmission.result.failure.message', true);
	requireString(failure.reconciliation, 'prepareSubmission.result.failure.reconciliation');
}

function assertMutationRequest(value: unknown): asserts value is IAgentHostMutationRequest {
	const request = requireRecord(value, 'mutation');
	requireExactKeys(request, ['operation', 'digest', 'payload'], [], 'mutation');
	createAgentHostOperationId(requireString(request.operation, 'mutation.operation'));
	createAgentHostPayloadDigest(requireString(request.digest, 'mutation.digest'));
	assertMutationPayload(request.payload);
}

function assertOperationOutcomeRequest(value: unknown): asserts value is IAgentHostOperationOutcomeRequest {
	const request = requireRecord(value, 'operationOutcome');
	requireExactKeys(request, ['operation', 'digest'], [], 'operationOutcome');
	createAgentHostOperationId(requireString(request.operation, 'operationOutcome.operation'));
	createAgentHostPayloadDigest(requireString(request.digest, 'operationOutcome.digest'));
}

function toIpcError(error: unknown): unknown {
	if (isAppError(error)) {
		return error;
	}
	if (isCancellationError(error)) {
		return appError(localAgentHostCancellationErrorCode, { message: error.message });
	}
	if (error instanceof AgentHostError) {
		assertAgentHostProtocolValue(error.data);
		return appError(localAgentHostErrorCode, {
			code: error.code,
			message: error.message,
			data: error.data,
		});
	}
	return error;
}

/** Exposes one exact Node Agent Host logical connection to one renderer. */
export class AgentHostConnectionChannel extends Disposable implements IServerChannel<IpcMainInvokeEvent> {
	private sender: WebContents | undefined;
	private wasBound = false;
	private readonly senderBinding = this._register(new MutableDisposable<DisposableStore>());
	private clientToolPublication: AgentClientToolPublication | undefined;

	constructor(
		private readonly connection: IAgentHostConnection,
		private readonly contentResources: IAgentContentResourceClientRouter,
		private readonly toolRegistry: AgentToolRegistry,
		private readonly toolEndpoints: AgentToolEndpointRegistry,
		private readonly channelServer: Pick<ElectronMainChannelServer, 'getRendererChannel'>,
	) {
		super();
	}

	async call<T = unknown>(
		context: IpcMainInvokeEvent,
		command: string,
		arg: unknown,
		cancellationToken: CancellationToken = CancellationTokenNone,
	): Promise<T> {
		try {
			this.bindContext(context);
			if (cancellationToken.isCancellationRequested) {
				throw new CancellationError();
			}

			let result: unknown;
			switch (command) {
				case 'identity':
					if (arg !== undefined) {
						invalidProtocol('identity', arg);
					}
					result = Object.freeze({
						authority: this.connection.authority,
						connection: this.connection.connection,
					});
					break;
				case 'initialize':
					assertInitializeRequest(arg, this.connection);
					result = await raceCancellationError(this.connection.initialize(arg), cancellationToken);
					if (requireRecord(result, 'initialize.result').protocolVersion !== localAgentHostProtocolVersion) {
						invalidProtocol('initialize.result.protocolVersion', requireRecord(result, 'initialize.result').protocolVersion);
					}
					break;
				case 'reconnect':
					assertReconnectRequest(arg, this.connection);
					result = await raceCancellationError(this.connection.reconnect(arg), cancellationToken);
					assertAgentHostReconnectResult(arg, result as AgentHostReconnectResult);
					break;
				case 'setSubscriptions':
					assertSetSubscriptionsRequest(arg);
					result = await raceCancellationError(this.connection.setSubscriptions(arg), cancellationToken);
					assertAgentHostSetSubscriptionsResult(arg, result as IAgentHostSetSubscriptionsResult);
					break;
				case 'resolveSessionConfiguration':
					assertResolveSessionConfigurationRequest(arg);
					result = validateResolveSessionConfigurationResult(
						await raceCancellationError(
							this.connection.resolveSessionConfiguration(arg),
							cancellationToken,
						),
					);
					break;
				case 'completeSessionConfiguration':
					assertSessionConfigurationCompletionsRequest(arg);
					result = validateSessionConfigurationCompletionsResult(
						arg,
						await raceCancellationError(
							this.connection.completeSessionConfiguration(arg),
							cancellationToken,
						),
					);
					break;
				case 'prepareSubmission':
					assertPrepareSubmissionRequest(arg);
					result = await raceCancellationError(this.connection.prepareSubmission(arg), cancellationToken);
					assertPrepareSubmissionResult(result);
					break;
				case 'mutate':
					assertMutationRequest(arg);
					result = await raceCancellationError(this.connection.mutate(arg), cancellationToken);
					break;
				case 'getOperationOutcome':
					assertOperationOutcomeRequest(arg);
					result = await raceCancellationError(this.connection.getOperationOutcome(arg), cancellationToken);
					break;
				case 'executePackageOperation':
					assertAgentPackageOperationRequest(arg);
					result = await raceCancellationError(this.connection.executePackageOperation(arg), cancellationToken);
					assertAgentPackageOperationOutcome(arg, result);
					break;
				case 'getPackageOperationOutcome':
					assertAgentPackageOperationOutcomeRequest(arg);
					result = await raceCancellationError(this.connection.getPackageOperationOutcome(arg), cancellationToken);
					assertAgentPackageOperationOutcome(arg, result);
					break;
				case 'synchronizeClientTools': {
					const snapshot = validateAndFreezeAgentClientToolPublicationSnapshot(arg);
					if (snapshot.connection !== this.connection.connection) {
						invalidProtocol('synchronizeClientTools.connection', snapshot.connection);
					}
					this.requireClientToolPublication(context).synchronize(snapshot);
					result = null;
					break;
				}
				default:
					throw appError(localAgentHostChannelErrorCode, { command });
			}

			assertAgentHostProtocolValue(result);
			return result as T;
		} catch (error) {
			throw toIpcError(error);
		}
	}

	listen<T = unknown>(context: IpcMainInvokeEvent, event: string, arg: unknown): Event<T> {
		try {
			this.bindContext(context);
			if (arg !== undefined) {
				throw appError(localAgentHostChannelErrorCode, { event });
			}
			if (event === 'onDidReceiveAction') {
				return (listener, thisArgs, disposables) => this.connection.onDidReceiveAction(action => {
					assertAgentHostProtocolValue(action);
					listener.call(thisArgs, action as T);
				}, undefined, disposables);
			}
			if (event === 'onDidProgress') {
				return (listener, thisArgs, disposables) => this.connection.onDidProgress(progress => {
					assertAgentHostProtocolValue(progress);
					listener.call(thisArgs, progress as T);
				}, undefined, disposables);
			}
			throw appError(localAgentHostChannelErrorCode, { event });
		} catch (error) {
			throw toIpcError(error);
		}
	}

	private bindContext(context: IpcMainInvokeEvent): void {
		if (this._store.isDisposed) {
			throw appError(localAgentHostChannelErrorCode, { state: 'disposed' });
		}
		if (this.sender === undefined) {
			if (this.wasBound) {
				throw appError(localAgentHostChannelErrorCode, { state: 'rendererReplaced' });
			}
			const sender = context.sender;
			const binding = new DisposableStore();
			const release = () => {
				if (this.sender?.id === sender.id) {
					this.sender = undefined;
					this.clientToolPublication = undefined;
					this.senderBinding.clear();
				}
			};
			sender.once('destroyed', release);
			binding.add(toDisposable(() => sender.off('destroyed', release)));
			try {
				binding.add(this.contentResources.bindClientReader(
					this.connection.connection,
					new ClientContentResourceChannelClient(this.channelServer.getRendererChannel(
						sender.id,
						localAgentHostClientContentResourceChannelName,
					)),
				));
				this.sender = sender;
				this.wasBound = true;
				this.senderBinding.value = binding;
			} catch (error) {
				binding.dispose();
				throw error;
			}
			return;
		}
		if (context.sender.id !== this.sender.id) {
			throw appError(localAgentHostChannelErrorCode, {
				state: 'anotherRenderer',
				expectedSender: this.sender.id,
				receivedSender: context.sender.id,
			});
		}
	}

	private requireClientToolPublication(context: IpcMainInvokeEvent): AgentClientToolPublication {
		if (this.clientToolPublication !== undefined) {
			return this.clientToolPublication;
		}
		if (this.sender?.id !== context.sender.id) {
			throw appError(localAgentHostChannelErrorCode, { state: 'rendererUnavailable' });
		}
		const binding = this.senderBinding.value;
		if (binding === undefined) {
			throw appError(localAgentHostChannelErrorCode, { state: 'rendererUnbound' });
		}
		const endpoint = binding.add(new ClientAgentToolChannelClient(
			this.channelServer.getRendererChannel(context.sender.id, localAgentHostClientToolChannelName),
		));
		const publication = binding.add(new AgentClientToolPublication(
			this.connection.connection,
			this.toolRegistry,
			this.toolEndpoints,
			endpoint,
		));
		this.clientToolPublication = publication;
		return publication;
	}
}

interface IAgentHostRendererChannelRecord {
	readonly channel: AgentHostConnectionChannel;
	readonly lifetime: DisposableStore;
}

/** Creates one fresh logical Agent Host connection for each renderer WebContents. */
export class AgentHostConnectionChannelFactory extends Disposable implements IServerChannel<IpcMainInvokeEvent> {
	private readonly channels = new Map<number, IAgentHostRendererChannelRecord>();
	private readonly issuedConnections = new Set<AgentHostClientConnectionId>();

	constructor(
		private readonly createConnection: (context: IpcMainInvokeEvent) => IAgentHostConnection,
		private readonly contentResources: IAgentContentResourceClientRouter,
		private readonly toolRegistry: AgentToolRegistry,
		private readonly toolEndpoints: AgentToolEndpointRegistry,
		private readonly channelServer: Pick<ElectronMainChannelServer, 'getRendererChannel'>,
	) {
		super();
	}

	call<T = unknown>(
		context: IpcMainInvokeEvent,
		command: string,
		arg: unknown,
		cancellationToken: CancellationToken = CancellationTokenNone,
	): Promise<T> {
		return this.resolve(context).call(context, command, arg, cancellationToken);
	}

	listen<T = unknown>(context: IpcMainInvokeEvent, event: string, arg: unknown): Event<T> {
		return this.resolve(context).listen(context, event, arg);
	}

	private resolve(context: IpcMainInvokeEvent): AgentHostConnectionChannel {
		if (this._store.isDisposed || context.sender.isDestroyed()) {
			throw appError(localAgentHostChannelErrorCode, { state: 'rendererUnavailable' });
		}
		const existing = this.channels.get(context.sender.id);
		if (existing !== undefined) {
			return existing.channel;
		}

		const lifetime = new DisposableStore();
		try {
			const connection = lifetime.add(this.createConnection(context));
			if (this.issuedConnections.has(connection.connection)) {
				throw appError(localAgentHostChannelErrorCode, {
					state: 'logicalConnectionReused',
					connection: connection.connection,
				});
			}
			this.issuedConnections.add(connection.connection);
			const channel = lifetime.add(new AgentHostConnectionChannel(
				connection,
				this.contentResources,
				this.toolRegistry,
				this.toolEndpoints,
				this.channelServer,
			));
			const senderId = context.sender.id;
			const release = () => {
				const record = this.channels.get(senderId);
				if (record?.lifetime === lifetime) {
					this.channels.delete(senderId);
					lifetime.dispose();
				}
			};
			context.sender.once('destroyed', release);
			lifetime.add(toDisposable(() => context.sender.off('destroyed', release)));
			this.channels.set(senderId, { channel, lifetime });
			return channel;
		} catch (error) {
			lifetime.dispose();
			throw error;
		}
	}

	override dispose(): void {
		if (this._store.isDisposed) {
			return;
		}
		for (const record of this.channels.values()) {
			record.lifetime.dispose();
		}
		this.channels.clear();
		super.dispose();
	}
}
