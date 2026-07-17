/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { URI } from 'cs/base/common/uri';
import type { IAgentWorkspace } from 'cs/platform/agentHost/common/agent';
import {
	validateAndFreezeAgentConfigurationSchema,
	resolveAgentModelConfigurationCandidate,
} from 'cs/platform/agentHost/common/configuration';
import type { AgentChatId, AgentId, AgentModelId, AgentSessionTypeId } from 'cs/platform/agentHost/common/identities';
import type {
	AgentHostDisplayText,
	AgentHostLocalizedDisplayTextKey,
	AgentHostExecutionSelection,
	IAgentHostChatState,
	IAgentHostRootState,
	IAgentHostSessionState,
	IAgentHostSessionTypeDescriptor,
} from 'cs/platform/agentHost/common/protocol';
import {
	ChatInteractivity,
	ChatOriginKind,
	SessionChangeKind,
	SessionStatus,
	SessionWorkspaceKind,
	type IChat,
	type IChatOrigin,
	type ISessionChange,
	type ISessionResolvedWorkspaceState,
	type ISessionType,
} from 'cs/sessions/services/sessions/common/session';
import type { ISessionModel } from 'cs/sessions/services/sessions/common/sessionsProvider';
import type {
	IAgentHostChatModelState,
	IAgentHostSessionModelState,
} from 'cs/sessions/contrib/providers/agentHost/browser/agentHostSessionModels';

/** Projects one Host Session type into the provider-independent creation contract. */
export function resolveAgentHostDisplayText(
	displayText: AgentHostDisplayText,
	messages: Readonly<Record<AgentHostLocalizedDisplayTextKey, string>>,
): string {
	const resolved = displayText.kind === 'literal'
		? displayText.value
		: messages[displayText.key];
	if (typeof resolved !== 'string' || resolved.length === 0) {
		throw new Error('Agent Host display text did not resolve to a non-empty string.');
	}
	return resolved;
}

export type AgentHostDisplayTextResolver = (displayText: AgentHostDisplayText) => string;

export function toSessionType(
	descriptor: Pick<IAgentHostSessionTypeDescriptor, 'id' | 'displayName' | 'capabilities'>,
	resolveDisplayText: AgentHostDisplayTextResolver,
): ISessionType {
	return Object.freeze({
		id: descriptor.id,
		label: resolveDisplayText(descriptor.displayName),
		icon: Codicon.agent,
		supportsWorkspaceLess: descriptor.capabilities.workspace !== 'required',
	});
}

export function toAgentWorkspace(workspace: ISessionResolvedWorkspaceState): IAgentWorkspace | undefined {
	if (workspace.kind === SessionWorkspaceKind.WorkspaceLess) {
		return undefined;
	}

	return Object.freeze({
		resource: workspace.workspace.resource.toString(),
		label: workspace.workspace.label,
		folders: Object.freeze(workspace.workspace.folders.map(folder => Object.freeze({
			resource: folder.resource.toString(),
			workingDirectory: folder.workingDirectory.toString(),
			name: folder.name,
			...(folder.repository ? {
				repository: Object.freeze({
					root: folder.repository.root.toString(),
					...(folder.repository.branch === undefined ? {} : { branch: folder.repository.branch }),
					...(folder.repository.baseBranch === undefined ? {} : { baseBranch: folder.repository.baseBranch }),
				}),
			} : {}),
		}))),
	});
}

function requireResource(value: string, field: string): URI {
	const resource = URI.parse(value);
	if (!resource.scheme) {
		throw new Error(`Agent Host ${field} must be an absolute resource URI.`);
	}
	return resource;
}

function toWorkspace(workspace: IAgentWorkspace | undefined): ISessionResolvedWorkspaceState {
	if (!workspace) {
		return Object.freeze({ kind: SessionWorkspaceKind.WorkspaceLess });
	}

	const resource = requireResource(workspace.resource, 'workspace resource');
	return Object.freeze({
		kind: SessionWorkspaceKind.Workspace,
		workspace: Object.freeze({
			resource,
			label: workspace.label,
			folders: Object.freeze(workspace.folders.map(value => {
				const folder = requireResource(value.resource, 'workspace folder resource');
				return Object.freeze({
					resource: folder,
					workingDirectory: requireResource(value.workingDirectory, 'workspace working directory'),
					name: value.name,
					repository: value.repository && Object.freeze({
						root: requireResource(value.repository.root, 'workspace repository root'),
						branch: value.repository.branch,
						baseBranch: value.repository.baseBranch,
					}),
				});
			})),
		}),
	});
}

function toSessionStatus(status: IAgentHostSessionState['status']): SessionStatus {
	switch (status) {
		case 'running':
			return SessionStatus.Running;
		case 'needsInput':
			return SessionStatus.NeedsInput;
		case 'completed':
			return SessionStatus.Completed;
		case 'failed':
			return SessionStatus.Failed;
	}
}

function toChatInteractivity(state: IAgentHostChatState): ChatInteractivity {
	if (state.interactivity === 'hidden') {
		return ChatInteractivity.Hidden;
	}
	if (state.interactivity === 'readOnly' || state.lifecycle !== 'available') {
		return ChatInteractivity.ReadOnly;
	}
	return ChatInteractivity.Full;
}

function toSessionChanges(changes: IAgentHostSessionState['changes']): readonly ISessionChange[] {
	return Object.freeze(changes.map(change => Object.freeze({
		resource: requireResource(change.resource, 'change resource'),
		kind: change.kind === 'created'
			? SessionChangeKind.Created
			: change.kind === 'modified'
				? SessionChangeKind.Modified
				: SessionChangeKind.Deleted,
	})));
}

export function toChatOrigin(
	state: IAgentHostChatState,
	chatResources: ReadonlyMap<AgentChatId, URI>,
): IChatOrigin {
	if (state.origin.kind === 'user') {
		return Object.freeze({ kind: ChatOriginKind.User });
	}

	const parentChat = chatResources.get(state.origin.parentChat);
	if (!parentChat) {
		throw new Error(`Agent Host Chat '${state.id}' has a parent outside its Session.`);
	}
	return Object.freeze({
		kind: state.origin.kind === 'fork' ? ChatOriginKind.Fork : ChatOriginKind.Tool,
		parentChat,
	});
}

export function toChatModelState(state: IAgentHostChatState): IAgentHostChatModelState {
	return Object.freeze({
		title: state.title,
		updatedAt: new Date(state.modifiedAt),
		status: toSessionStatus(state.status),
		isRead: state.isRead,
		modelId: state.model ?? undefined,
		interactivity: toChatInteractivity(state),
		capabilities: Object.freeze({
			supportsRename: state.capabilities.supportsRename,
			supportsDelete: state.capabilities.supportsDelete,
		}),
		activeTurn: state.activeTurn,
	});
}

export function toSessionModelState(
	state: IAgentHostSessionState,
	chats: readonly IChat[],
): IAgentHostSessionModelState {
	return Object.freeze({
		title: state.title,
		updatedAt: new Date(state.modifiedAt),
		status: toSessionStatus(state.status),
		isRead: state.isRead,
		isArchived: state.archived,
		workspace: toWorkspace(state.workspace),
		changes: toSessionChanges(state.changes),
		chats: Object.freeze([...chats]),
		capabilities: Object.freeze({
			supportsCreateChat: state.capabilities.supportsCreateChat,
			maximumChatCount: state.capabilities.maximumChatCount,
			supportsFork: state.capabilities.supportsFork,
			supportsRename: state.capabilities.supportsRename,
			supportsArchive: state.capabilities.supportsArchive,
			supportsDelete: state.capabilities.supportsDelete,
			supportsChanges: state.capabilities.supportsChanges,
			supportsModels: state.capabilities.supportsModels,
		}),
	});
}

export function toExecutionSelection(
	root: IAgentHostRootState,
	descriptor: IAgentHostSessionTypeDescriptor,
	agentId: AgentId,
	model: AgentModelId | null,
): AgentHostExecutionSelection {
	if (descriptor.agentId !== agentId) {
		throw new Error(`Agent Host Session type '${descriptor.id}' does not belong to Agent '${agentId}'.`);
	}
	let selectedModel: AgentModelId;
	let preset: IAgentHostSessionTypeDescriptor['executionPresets'][number] | undefined;
	if (model !== null) {
		if (!descriptor.models.includes(model)) {
			throw new Error(`Agent Host Session type '${descriptor.id}' does not expose model '${model}'.`);
		}
		selectedModel = model;
	} else {
		if (descriptor.automaticExecutionPreset === null) {
			throw new Error(`Agent Host Session type '${descriptor.id}' has no automatic execution preset.`);
		}
		preset = descriptor.executionPresets.find(candidate => candidate.id === descriptor.automaticExecutionPreset);
		if (preset === undefined) {
			throw new Error(`Agent Host Session type '${descriptor.id}' has no exact automatic execution preset.`);
		}
		selectedModel = preset.model;
	}

	const agents = root.agents.filter(candidate => candidate.id === agentId && candidate.packageId === descriptor.packageId);
	if (agents.length !== 1) {
		throw new Error(`Agent Host does not expose one exact Agent '${agentId}'.`);
	}
	const modelDescriptor = agents[0].models.find(candidate => candidate.id === selectedModel);
	if (modelDescriptor === undefined || !modelDescriptor.enabled) {
		throw new Error(`Agent Host does not expose enabled model '${selectedModel}' for Agent '${agentId}'.`);
	}
	const schema = validateAndFreezeAgentConfigurationSchema(modelDescriptor.configurationSchema, {
		agent: agentId,
		scope: 'model',
	});
	const configuration = resolveAgentModelConfigurationCandidate(
		schema,
		Object.freeze({ schema: schema.revision, values: Object.freeze({}) }),
	);
	if (model !== null) {
		return Object.freeze({ kind: 'model', model, configuration });
	}
	if (preset === undefined) {
		throw new Error(`Agent Host Session type '${descriptor.id}' has no exact automatic execution preset.`);
	}
	return Object.freeze({ kind: 'preset', preset: preset.id, configuration });
}

export function toModels(
	root: IAgentHostRootState,
	sessionType: AgentSessionTypeId,
	agentId: AgentId,
): readonly ISessionModel[] {
	const type = root.sessionTypes.find(candidate => candidate.id === sessionType);
	if (!type) {
		throw new Error(`Agent Host does not expose Session type '${sessionType}'.`);
	}
	const agent = root.agents.find(candidate => candidate.id === agentId);
	if (!agent) {
		throw new Error(`Agent Host does not expose Agent '${agentId}'.`);
	}

	const exposedModels = new Set(type.models);
	return Object.freeze(agent.models.filter(model => exposedModels.has(model.id)).map(model => Object.freeze({
		id: model.id,
		label: model.displayName,
		detail: agent.description,
		enabled: model.enabled,
	})));
}
