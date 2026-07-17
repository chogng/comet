/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
	createSdkMcpServer,
	tool,
	type ModelInfo,
	type Query,
	type SDKMessage,
	type SessionKey,
	type SessionStoreEntry,
} from '@anthropic-ai/claude-agent-sdk';

import type { IAgentAction, IAgentChatRequest, IAgentExecutionProfile } from 'cs/platform/agentHost/common/agent';
import type { IAgentConfigurationCandidate } from 'cs/platform/agentHost/common/configuration';
import {
	createAgentCancellationId,
	createAgentChatId,
	createAgentConfigurationStateRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentPackageRevision,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentToolExecutionPort } from 'cs/platform/agentHost/common/tools';
import { COMET_TOOL_SCHEMA_PROFILE } from 'cs/platform/agentHost/common/tools';
import {
	CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
	CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
	CLAUDE_AGENT_CREDENTIAL_PROPERTY,
	CLAUDE_AGENT_PACKAGE_DEFINITION,
	CLAUDE_AGENT_PERMISSION_MODE_PROPERTY,
	CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA,
	CLAUDE_AGENT_THINKING_LEVEL_PROPERTY,
	createClaudeAgentRegistrationRevision,
} from 'cs/platform/agentHost/node/agents/claude/claudeAgentDefinition';
import {
	ClaudeAgent,
	productClaudeAgentRetentionLimits,
	type IClaudeAgentOptions,
	type IClaudeAgentSdk,
} from 'cs/platform/agentHost/node/agents/claude/claudeAgent';
import { ClaudeAgentSessionStore } from 'cs/platform/agentHost/node/agents/claude/claudeAgentSessionStore';

const packageRevision = createAgentPackageRevision('claude.agent-sdk.test');
const session = createAgentSessionId('claude-sdk-session');
const chat = createAgentChatId('claude-sdk-chat');
const workingDirectory = '/tmp/comet-claude-sdk-workspace';
const executable = '/tmp/comet-claude-sdk-package/vendor/claude-agent-sdk/claude';

const sessionConfiguration = Object.freeze({
	schema: CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA,
	revision: createAgentConfigurationStateRevision('claude-sdk-session-configuration'),
	values: Object.freeze({
		[CLAUDE_AGENT_PERMISSION_MODE_PROPERTY]: 'plan',
	}),
});

const sdkModels = Object.freeze([Object.freeze({
	value: 'claude-test-model',
	resolvedModel: 'claude-test-model-20260714',
	displayName: 'Claude Test Model',
	description: 'Model published by the SDK test catalog.',
	supportsEffort: true,
	supportedEffortLevels: ['low', 'medium', 'high'],
	supportsAdaptiveThinking: true,
	supportsFastMode: false,
} satisfies ModelInfo)]);

const unusedToolExecution: IAgentToolExecutionPort = {
	execute: async () => { throw new Error('The test did not register Host Tools.'); },
	cancel: async () => { throw new Error('The test did not register Host Tools.'); },
	reconcile: async () => { throw new Error('The test did not register Host Tools.'); },
	release: () => { throw new Error('The test did not register Host Tools.'); },
};

function operation(name: string, digit: string) {
	return Object.freeze({
		operation: createAgentHostOperationId(name),
		payloadDigest: createAgentHostPayloadDigest(`sha256:${digit.repeat(64)}`),
	});
}

function createSdkStream(
	messages: readonly SDKMessage[],
	models: readonly ModelInfo[] = sdkModels,
): Query {
	const stream = (async function* () {
		for (const message of messages) {
			yield message;
		}
	})();
	Object.assign(stream, {
		close: () => undefined,
		supportedModels: async () => [...models],
	});
	return stream as unknown as Query;
}

function createAgentOptions(root: string, query: IClaudeAgentSdk['query']): IClaudeAgentOptions {
	return {
		packageRevision,
		claudeCodeExecutable: executable,
		stateDirectory: path.join(root, 'state'),
		cacheDirectory: path.join(root, 'cache'),
		toolExecution: unusedToolExecution,
		credentialResolver: {
			resolve: async () => 'test-anthropic-api-key',
		},
		sdk: {
			createSdkMcpServer,
			deleteSession: async () => undefined,
			query,
			tool,
		},
		...productClaudeAgentRetentionLimits,
	};
}

test('Claude SessionStore persists, deduplicates, cold-loads, and idempotently deletes SDK entries', async t => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'comet-claude-session-store-'));
	t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const key: SessionKey = {
		projectKey: 'comet-project',
		sessionId: '12345678-1234-4123-8123-123456789abc',
	};
	const first: SessionStoreEntry = { type: 'user', uuid: 'entry-1', message: 'first' };
	const marker: SessionStoreEntry = { type: 'mode', mode: 'plan' };
	const second: SessionStoreEntry = { type: 'assistant', uuid: 'entry-2', message: 'second' };
	const store = new ClaudeAgentSessionStore(path.join(temporaryRoot, 'store'));
	await store.append(key, [first, marker]);
	await store.append(key, [{ ...first, message: 'duplicate' }, second]);
	assert.deepEqual(await store.load(key), [first, marker, second]);

	const restored = new ClaudeAgentSessionStore(path.join(temporaryRoot, 'store'));
	assert.deepEqual(await restored.load(key), [first, marker, second]);
	await restored.delete(key);
	assert.equal(await restored.load(key), null);
	await restored.delete(key);
});

test('Claude Agent rejects empty and duplicate SDK model snapshots without a fallback', async t => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'comet-claude-model-catalog-'));
	const canonicalTemporaryRoot = await realpath(temporaryRoot);
	t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	const cases = [{
		name: 'empty',
		models: Object.freeze([]),
		error: /empty model catalog/,
	}, {
		name: 'duplicate',
		models: Object.freeze([sdkModels[0], sdkModels[0]]),
		error: /duplicate model identities/,
	}] as const;

	for (const scenario of cases) {
		await assert.rejects(
			ClaudeAgent.create(createAgentOptions(
				path.join(canonicalTemporaryRoot, scenario.name),
				() => createSdkStream([], scenario.models),
			)),
			scenario.error,
		);
	}
});

test('Claude Agent exposes the SDK model snapshot and directly owns one durable Chat', async t => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'comet-claude-agent-'));
	const canonicalTemporaryRoot = await realpath(temporaryRoot);
	const stateDirectory = path.join(canonicalTemporaryRoot, 'state');
	const cacheDirectory = path.join(canonicalTemporaryRoot, 'cache');
	t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	type ClaudeQuery = IClaudeAgentSdk['query'];
	const queryCalls: Parameters<ClaudeQuery>[0][] = [];
	const discoveryCalls: Parameters<ClaudeQuery>[0][] = [];
	const deletedSdkSessions: Array<{ readonly sessionId: string; readonly directory: string | undefined }> = [];
	const sessionStore = {
		append: async () => undefined,
		load: async () => null,
		delete: async () => undefined,
	};
	const query: ClaudeQuery = parameters => {
		if (typeof parameters.prompt !== 'string') {
			discoveryCalls.push(parameters);
			return createSdkStream([]);
		}
		queryCalls.push(parameters);
		const requestedSession = parameters.options?.resume ?? parameters.options?.sessionId;
		if (typeof requestedSession !== 'string') {
			throw new Error('The test SDK query did not receive a Session identity.');
		}
		return createSdkStream([
			{ type: 'system', subtype: 'init', session_id: requestedSession } as SDKMessage,
			{
				type: 'assistant',
				parent_tool_use_id: null,
				message: { content: [
					{ type: 'thinking', thinking: 'Verified reasoning', signature: 'test' },
					{ type: 'text', text: 'Verified Claude SDK response' },
				] },
			} as SDKMessage,
			{ type: 'result', subtype: 'success', session_id: requestedSession } as SDKMessage,
		]);
	};
	const agent = await ClaudeAgent.create({
		...createAgentOptions(canonicalTemporaryRoot, query),
		stateDirectory,
		cacheDirectory,
		sdk: {
			...createAgentOptions(canonicalTemporaryRoot, query).sdk,
			deleteSession: async (sessionId, options) => {
				deletedSdkSessions.push({ sessionId, directory: options?.dir });
			},
		},
		sessionStore,
	});
	const actions: IAgentAction[] = [];
	const actionListener = agent.onDidEmitAction(action => actions.push(action));
	try {
		const descriptor = agent.descriptor.get();
		const registration = agent.registration;
		assert.equal(registration.revision, createClaudeAgentRegistrationRevision(descriptor.revision));
		assert.equal(registration.descriptorRevision, descriptor.revision);
		assert.equal(
			CLAUDE_AGENT_PACKAGE_DEFINITION.resolveRegistrationRevision(descriptor),
			registration.revision,
		);
		assert.deepEqual(descriptor.models.map(model => ({ id: model.id, displayName: model.displayName })), [{
			id: 'claude:claude-test-model',
			displayName: 'Claude Test Model',
		}]);
		assert.equal(discoveryCalls.length, 1);
		assert.equal(discoveryCalls[0].options?.env?.ANTHROPIC_API_KEY, undefined);
		assert.equal(discoveryCalls[0].options?.persistSession, false);

		const modelConfiguration = Object.freeze({
			schema: descriptor.models[0].configurationSchema.revision,
			values: Object.freeze({
				[CLAUDE_AGENT_THINKING_LEVEL_PROPERTY]: 'high',
				[CLAUDE_AGENT_CREDENTIAL_PROPERTY]: Object.freeze({
					provider: CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
					scope: 'llm',
					reference: CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
				}),
			}),
		});
		const profile: IAgentExecutionProfile = await agent.executionProfiles.resolve({
			submission: createAgentSubmissionId('resolve-profile'),
			selection: {
				kind: 'user',
				value: { model: descriptor.models[0].id },
				configuration: modelConfiguration,
			},
			selectionDigest: createAgentHostPayloadDigest(`sha256:${'d'.repeat(64)}`),
			runtimeRegistration: registration.revision,
			sessionConfiguration,
		});

		await agent.sessions.create({
			...operation('create-session', '1'),
			session,
			configuration: sessionConfiguration,
			workspace: {
				resource: 'file:///tmp/comet-claude-sdk-workspace',
				label: 'Claude SDK test workspace',
				folders: [{
					resource: 'file:///tmp/comet-claude-sdk-workspace',
					workingDirectory,
					name: 'comet-claude-sdk-workspace',
				}],
			},
		});
		const chatBacking = await agent.chats.create({
			...operation('create-chat', '2'),
			session,
			chat,
			origin: { kind: 'user' },
		});
		const createdResume = JSON.parse(chatBacking.resume?.data ?? 'null') as { readonly sdkSessionId?: unknown };
		assert.equal(typeof createdResume.sdkSessionId, 'string');

		const request: IAgentChatRequest = {
			...operation('send', '3'),
			session,
			chat,
			turn: createAgentTurnId('claude-sdk-turn'),
			submission: createAgentSubmissionId('claude-sdk-submission'),
			message: 'SDK request',
			attachments: [],
			interactionTargets: [],
			binding: {
				profile,
				modelConfiguration: modelConfiguration satisfies IAgentConfigurationCandidate,
				credentials: [{
					provider: CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
					scope: 'llm',
					reference: CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
				}],
				runtimeRegistration: registration.revision,
				toolSet: {
					revision: createAgentToolSetRevision('claude-sdk-tools'),
					schemaProfile: COMET_TOOL_SCHEMA_PROFILE,
					runtimeRegistration: registration.revision,
					agentDescriptor: descriptor.revision,
					modelDescriptor: descriptor.models[0].revision,
					registrations: [],
				},
				deadline: Date.now() + 60_000,
				cancellation: createAgentCancellationId('claude-sdk-cancellation'),
				outputConstraints: null,
			},
		};
		await agent.chats.send(request);

		assert.equal(queryCalls.length, 1);
		const options = queryCalls[0].options;
		assert.ok(options !== undefined);
		assert.equal(options.pathToClaudeCodeExecutable, executable);
		assert.equal(options.cwd, workingDirectory);
		assert.equal(options.model, 'claude-test-model');
		assert.equal(options.env?.ANTHROPIC_API_KEY, 'test-anthropic-api-key');
		assert.equal(options.env?.CLAUDE_CONFIG_DIR, path.join(cacheDirectory, createdResume.sdkSessionId as string));
		assert.deepEqual(options.thinking, { type: 'adaptive' });
		assert.equal(options.effort, 'high');
		assert.deepEqual(actions.map(action => action.kind), [
			'turnProgress',
			'chatResumeStateChanged',
			'turnProgress',
			'turnProgress',
			'turnTerminal',
		]);
		const terminalAction = actions.at(-1);
		assert.equal(terminalAction?.kind, 'turnTerminal');
		assert.equal(terminalAction?.kind === 'turnTerminal' ? terminalAction.state : undefined, 'completed');

		await agent.chats.delete({
			...operation('delete-chat', '4'),
			session,
			chat,
		});
		assert.deepEqual(deletedSdkSessions, [{
			sessionId: createdResume.sdkSessionId,
			directory: workingDirectory,
		}]);
	} finally {
		actionListener.dispose();
		agent.dispose();
	}
});
