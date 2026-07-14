/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { Query, SDKMessage, SessionKey, SessionStoreEntry } from '@anthropic-ai/claude-agent-sdk';

import {
	CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
	CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
	CLAUDE_AGENT_CREDENTIAL_PROPERTY,
	CLAUDE_AGENT_DESCRIPTOR,
	CLAUDE_AGENT_ID,
	CLAUDE_AGENT_MODEL_CONFIGURATION_SCHEMA,
	CLAUDE_AGENT_PACKAGE_ID,
	CLAUDE_AGENT_PERMISSION_MODE_PROPERTY,
	CLAUDE_AGENT_RUNTIME_ENTRY_POINT,
	CLAUDE_AGENT_RUNTIME_REGISTRATION,
	CLAUDE_AGENT_SDK_EXECUTABLE_TARGET,
	CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA,
	CLAUDE_AGENT_THINKING_LEVEL_PROPERTY,
	createClaudeAgentPackageProduct,
	validateInstalledClaudeAgentPackage,
} from 'cs/code/common/agentHost/claudeAgentPackage';
import {
	ClaudeAgentRuntime,
	productClaudeAgentRuntimeRetentionLimits,
	type IClaudeAgentRuntimeOptions,
} from 'cs/code/electron-utility/agentRuntime/claudeAgentRuntime';
import { ClaudeAgentSessionStore } from 'cs/code/electron-utility/agentRuntime/claudeAgentSessionStore';
import type { IAgentChatRequest, IAgentExecutionProfile } from 'cs/platform/agentHost/common/agent';
import type {
	IAgentRuntimeAction,
	IAgentRuntimeCall,
	IAgentRuntimeHostOperationRequest,
} from 'cs/platform/agentHost/common/connections';
import {
	createAgentCancellationId,
	createAgentChatId,
	createAgentConfigurationStateRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentPackageContentDigest,
	createAgentPackageRevision,
	createAgentRuntimeCallId,
	createAgentRuntimeConnectionGeneration,
	createAgentRuntimeConnectionId,
	createAgentRuntimeProtocolVersion,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import { COMET_TOOL_SCHEMA_PROFILE } from 'cs/platform/agentHost/common/tools';

const connection = createAgentRuntimeConnectionId('claude-sdk-test');
const generation = createAgentRuntimeConnectionGeneration(1);
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

const modelConfiguration = Object.freeze({
	schema: CLAUDE_AGENT_MODEL_CONFIGURATION_SCHEMA.revision,
	values: Object.freeze({
		[CLAUDE_AGENT_THINKING_LEVEL_PROPERTY]: 'high',
		[CLAUDE_AGENT_CREDENTIAL_PROPERTY]: Object.freeze({
			provider: CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
			scope: 'llm',
			reference: CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
		}),
	}),
});

function runtimeCall<TRequest>(call: string, request: TRequest): IAgentRuntimeCall<TRequest> {
	return Object.freeze({
		connection,
		generation,
		call: createAgentRuntimeCallId(call),
		registration: CLAUDE_AGENT_RUNTIME_REGISTRATION.revision,
		agent: CLAUDE_AGENT_ID,
		request,
	});
}

function operation(name: string, digit: string) {
	return Object.freeze({
		operation: createAgentHostOperationId(name),
		payloadDigest: createAgentHostPayloadDigest(`sha256:${digit.repeat(64)}`),
	});
}

function createSdkStream(messages: readonly SDKMessage[]): Query {
	const stream = (async function* () {
		for (const message of messages) {
			yield message;
		}
	})();
	Object.assign(stream, { close: () => undefined });
	return stream as unknown as Query;
}

test('Claude product owns the exact SDK runtime and native executable closure', () => {
	const runtimeDigest = createAgentPackageContentDigest(`sha256:${'a'.repeat(64)}`);
	const executableDigest = createAgentPackageContentDigest(`sha256:${'b'.repeat(64)}`);
	const product = createClaudeAgentPackageProduct(
		{ operatingSystem: 'darwin', architecture: 'arm64' },
		{
			contentDigest: createAgentPackageContentDigest(`sha256:${'c'.repeat(64)}`),
			runtime: { source: 'file:///verified/claudeAgentRuntimeMain.js', contentDigest: runtimeDigest },
			executable: { source: 'file:///verified/claude', contentDigest: executableDigest },
		},
	);

	assert.equal(product.offering.packageId, CLAUDE_AGENT_PACKAGE_ID);
	assert.equal(product.verifiedPackage.manifest.runtimeEntryPoint, CLAUDE_AGENT_RUNTIME_ENTRY_POINT);
	assert.deepEqual(product.verifiedPackage.dependencyClosure.map(dependency => ({
		target: dependency.target,
		digest: dependency.digest,
		immutable: dependency.immutable,
	})), [{
		target: CLAUDE_AGENT_RUNTIME_ENTRY_POINT,
		digest: runtimeDigest,
		immutable: true,
	}, {
		target: CLAUDE_AGENT_SDK_EXECUTABLE_TARGET,
		digest: executableDigest,
		immutable: true,
	}]);
	assert.deepEqual(product.verifiedPackage.grantedPrivileges.map(privilege => privilege.kind), [
		'process', 'filesystem', 'network', 'secret', 'toolExecutor',
	]);
	assert.deepEqual(product.definition.sessionConfigurationSchema.properties.map(property => property.id), [
		CLAUDE_AGENT_PERMISSION_MODE_PROPERTY,
	]);
	assert.deepEqual(product.definition.modelConfigurationSchema.properties.map(property => property.id), [
		CLAUDE_AGENT_THINKING_LEVEL_PROPERTY,
		CLAUDE_AGENT_CREDENTIAL_PROPERTY,
	]);

	validateInstalledClaudeAgentPackage(Object.freeze({
		...product.offering,
		manifest: product.verifiedPackage.manifest,
		dependencyClosure: product.verifiedPackage.dependencyClosure,
		grantedPrivileges: product.verifiedPackage.grantedPrivileges,
	}), product);
	assert.throws(() => validateInstalledClaudeAgentPackage(Object.freeze({
		...product.offering,
		manifest: product.verifiedPackage.manifest,
		dependencyClosure: product.verifiedPackage.dependencyClosure.slice(0, 1),
		grantedPrivileges: product.verifiedPackage.grantedPrivileges,
	}), product), /does not match its exact SDK product artifact/);
});

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

test('Claude runtime maps one durable SDK Chat and deletes its SDK-native backing', async t => {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'comet-claude-agent-runtime-'));
	const canonicalTemporaryRoot = await realpath(temporaryRoot);
	const stateDirectory = path.join(canonicalTemporaryRoot, 'state');
	const cacheDirectory = path.join(canonicalTemporaryRoot, 'cache');
	t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
	type ClaudeQuery = NonNullable<IClaudeAgentRuntimeOptions['query']>;
	const queryCalls: Parameters<ClaudeQuery>[0][] = [];
	const deletedSdkSessions: Array<{ readonly sessionId: string; readonly directory: string | undefined }> = [];
	const sessionStore = {
		append: async () => undefined,
		load: async () => null,
		delete: async () => undefined,
	};
	const query: ClaudeQuery = parameters => {
		queryCalls.push(parameters);
		const options = parameters.options;
		if (options === undefined) {
			throw new Error('The test SDK query did not receive options.');
		}
		const requestedSession = options.resume ?? options.sessionId;
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
	const runtime = new ClaudeAgentRuntime({
		packageRevision,
		connection,
		generation,
		claudeCodeExecutable: executable,
		stateDirectory,
		cacheDirectory,
		query,
		deleteSession: async (sessionId, options) => {
			deletedSdkSessions.push({ sessionId, directory: options?.dir });
		},
		sessionStore,
		...productClaudeAgentRuntimeRetentionLimits,
	});
	const actions: IAgentRuntimeAction[] = [];
	const hostOperations: IAgentRuntimeHostOperationRequest[] = [];
	const actionListener = runtime.onDidEmitAction(action => actions.push(action));
	const hostOperationListener = runtime.onDidRequestHostOperation(request => {
		hostOperations.push(request);
		assert.equal(request.request.kind, 'credential.resolve');
		void runtime.completeHostOperation({
			connection: request.connection,
			generation: request.generation,
			operation: request.operation,
			parentCall: request.parentCall,
			registration: request.registration,
			agent: request.agent,
			outcome: { kind: 'completed', value: 'test-anthropic-api-key' },
		});
	});
	try {
		const initialized = await runtime.initialize({
			connection,
			generation,
			call: createAgentRuntimeCallId('initialize'),
			protocolVersions: [createAgentRuntimeProtocolVersion('2')],
			transportLimits: {
				maximumRequestBytes: 1024 * 1024,
				maximumResponseBytes: 1024 * 1024,
				maximumActionBytes: 1024 * 1024,
				maximumConcurrentCalls: 8,
			},
			packageId: CLAUDE_AGENT_PACKAGE_ID,
			packageRevision,
			authorizedAgents: [CLAUDE_AGENT_ID],
			implementation: { name: 'Claude SDK runtime test', build: 'test' },
		});
		assert.deepEqual(initialized.registrations, [{
			registration: CLAUDE_AGENT_RUNTIME_REGISTRATION,
			descriptor: CLAUDE_AGENT_DESCRIPTOR,
		}]);

		const profile: IAgentExecutionProfile = (await runtime.resolveExecutionProfile(runtimeCall('resolve-profile', {
			submission: createAgentSubmissionId('resolve-profile'),
			selection: {
				kind: 'user',
				value: { model: CLAUDE_AGENT_DESCRIPTOR.models[0].id },
				configuration: modelConfiguration,
			},
			selectionDigest: createAgentHostPayloadDigest(`sha256:${'d'.repeat(64)}`),
			runtimeRegistration: CLAUDE_AGENT_RUNTIME_REGISTRATION.revision,
			sessionConfiguration,
		}))).value;

		await runtime.createSession(runtimeCall('create-session', {
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
		}));
		const chatBacking = (await runtime.createChat(runtimeCall('create-chat', {
			...operation('create-chat', '2'),
			session,
			chat,
			origin: { kind: 'user' },
		}))).value;
		const createdResume = JSON.parse(chatBacking.resume?.data ?? 'null') as { readonly sdkSessionId?: unknown };
		assert.equal(typeof createdResume.sdkSessionId, 'string');

		const sendTurn = async (sequence: number): Promise<void> => {
			const turn = createAgentTurnId(`claude-sdk-turn-${sequence}`);
			const request: IAgentChatRequest = {
				...operation(`send-${sequence}`, String(sequence + 2)),
				session,
				chat,
				turn,
				submission: createAgentSubmissionId(`claude-sdk-submission-${sequence}`),
				message: `SDK request ${sequence}`,
				attachments: [],
				interactionTargets: [],
				binding: {
					profile,
					modelConfiguration,
					credentials: [{
						provider: CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
						scope: 'llm',
						reference: CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
					}],
					runtimeRegistration: CLAUDE_AGENT_RUNTIME_REGISTRATION.revision,
					toolSet: {
						revision: createAgentToolSetRevision(`claude-sdk-tools-${sequence}`),
						schemaProfile: COMET_TOOL_SCHEMA_PROFILE,
						runtimeRegistration: CLAUDE_AGENT_RUNTIME_REGISTRATION.revision,
						agentDescriptor: CLAUDE_AGENT_DESCRIPTOR.revision,
						modelDescriptor: CLAUDE_AGENT_DESCRIPTOR.models[0].revision,
						registrations: [],
					},
					deadline: Date.now() + 60_000,
					cancellation: createAgentCancellationId(`claude-sdk-cancellation-${sequence}`),
					outputConstraints: null,
				},
			};
			await runtime.send(runtimeCall(`send-call-${sequence}`, request));
		};

		await sendTurn(1);
		await sendTurn(2);

		assert.equal(queryCalls.length, 2);
		assert.equal(hostOperations.length, 2);
		const firstQuery = queryCalls[0];
		const secondQuery = queryCalls[1];
		assert.ok(firstQuery?.options !== undefined);
		assert.ok(secondQuery?.options !== undefined);
		assert.equal(firstQuery.prompt, 'SDK request 1');
		assert.equal(firstQuery.options.sessionId, createdResume.sdkSessionId);
		assert.equal(firstQuery.options.resume, undefined);
		assert.equal(secondQuery.options.sessionId, undefined);
		assert.equal(secondQuery.options.resume, createdResume.sdkSessionId);
		for (const call of queryCalls) {
			const options = call.options;
			assert.ok(options !== undefined);
			assert.equal(options.pathToClaudeCodeExecutable, executable);
			assert.equal(options.cwd, workingDirectory);
			assert.deepEqual(options.additionalDirectories, []);
			assert.equal(options.permissionMode, 'plan');
			assert.equal(options.strictMcpConfig, true);
			assert.deepEqual(options.tools, []);
			assert.deepEqual(options.skills, []);
			assert.deepEqual(options.settingSources, []);
			assert.deepEqual(options.thinking, { type: 'adaptive' });
			assert.equal(options.effort, 'high');
			assert.equal(options.env?.ANTHROPIC_API_KEY, 'test-anthropic-api-key');
			assert.equal(options.env?.CLAUDE_CONFIG_DIR, path.join(cacheDirectory, createdResume.sdkSessionId as string));
			assert.equal(options.sessionStore, sessionStore);
			assert.equal(options.sessionStoreFlush, 'eager');
			assert.deepEqual(options.sandbox, {
				enabled: true,
				failIfUnavailable: true,
				allowUnsandboxedCommands: false,
				network: {
					allowedDomains: ['api.anthropic.com'],
					allowManagedDomainsOnly: true,
					allowLocalBinding: false,
					allowAllUnixSockets: false,
				},
			});
		}
		assert.equal(
			actions.filter(action => action.action.kind === 'chatResumeStateChanged').length,
			1,
		);
		assert.deepEqual(actions.map(action => action.action.kind), [
			'turnProgress',
			'chatResumeStateChanged',
			'turnProgress',
			'turnProgress',
			'turnTerminal',
			'turnProgress',
			'turnProgress',
			'turnProgress',
			'turnTerminal',
		]);
		const terminalActions = actions.filter(action => action.action.kind === 'turnTerminal');
		assert.ok(terminalActions.every(action => action.action.kind === 'turnTerminal' && action.action.state === 'completed'));

		await runtime.deleteChat(runtimeCall('delete-chat', {
			...operation('delete-chat', '5'),
			session,
			chat,
		}));
		assert.deepEqual(deletedSdkSessions, [{
			sessionId: createdResume.sdkSessionId,
			directory: workingDirectory,
		}]);
	} finally {
		actionListener.dispose();
		hostOperationListener.dispose();
		runtime.dispose();
	}
});
