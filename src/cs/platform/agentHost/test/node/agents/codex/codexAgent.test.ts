/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Emitter } from 'cs/base/common/event';
import { toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { IAgentAction, IAgentChatRequest } from 'cs/platform/agentHost/common/agent';
import {
	createAgentCancellationId,
	createAgentChatId,
	createAgentConfigurationStateRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentPackageContentDigest,
	createAgentPackageRevision,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolSetRevision,
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import {
	COMET_TOOL_SCHEMA_PROFILE,
	type IAgentToolCall,
	type IAgentToolExecutionPort,
	type IAgentToolRegistration,
} from 'cs/platform/agentHost/common/tools';
import { CodexAgent } from 'cs/platform/agentHost/node/agents/codex/codexAgent';
import type {
	ICodexAppServerClient,
	ICodexAppServerFactory,
} from 'cs/platform/agentHost/node/agents/codex/codexAppServer';
import {
	CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER,
	CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE,
	CODEX_AGENT_APPROVAL_POLICY_PROPERTY,
	CODEX_AGENT_CREDENTIAL_PROPERTY,
	CODEX_AGENT_PACKAGE_DEFINITION,
	CODEX_AGENT_PERSONALITY_PROPERTY,
	CODEX_AGENT_REASONING_EFFORT_PROPERTY,
	CODEX_AGENT_REASONING_SUMMARY_PROPERTY,
	CODEX_AGENT_SANDBOX_MODE_PROPERTY,
	CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA,
	CODEX_AGENT_WEB_SEARCH_MODE_PROPERTY,
	createCodexAgentRegistrationRevision,
} from 'cs/platform/agentHost/node/agents/codex/codexAgentDefinition';
import {
	CODEX_AGENT_SDK_EXECUTABLE_TARGET,
	createCodexAgentPackageProduct,
} from 'cs/platform/agentHost/node/agents/codex/codexAgentPackage';

const packageRevision = createAgentPackageRevision('codex.app-server.test');
const session = createAgentSessionId('codex-sdk-session');
const chat = createAgentChatId('codex-sdk-chat');

const sessionConfiguration = Object.freeze({
	schema: CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA,
	revision: createAgentConfigurationStateRevision('codex-session-configuration'),
	values: Object.freeze({
		[CODEX_AGENT_APPROVAL_POLICY_PROPERTY]: 'never',
		[CODEX_AGENT_SANDBOX_MODE_PROPERTY]: 'workspace-write',
		[CODEX_AGENT_WEB_SEARCH_MODE_PROPERTY]: 'disabled',
		[CODEX_AGENT_PERSONALITY_PROPERTY]: 'none',
	}),
});

const modelPage = Object.freeze({
	data: Object.freeze([Object.freeze({
		id: 'gpt-test-codex',
		model: 'gpt-test-codex',
		displayName: 'GPT Test Codex',
		description: 'Model from the Codex app-server test snapshot.',
		hidden: false,
		defaultReasoningEffort: 'medium',
		supportedReasoningEfforts: Object.freeze([
			Object.freeze({ reasoningEffort: 'low', description: 'Low' }),
			Object.freeze({ reasoningEffort: 'medium', description: 'Medium' }),
			Object.freeze({ reasoningEffort: 'high', description: 'High' }),
		]),
	})]),
	nextCursor: null,
});

const toolRegistration: IAgentToolRegistration = Object.freeze({
	id: createAgentToolRegistrationId('codex-test-tool-registration'),
	revision: createAgentToolRegistrationRevision('codex-test-tool-registration.v1'),
	descriptor: Object.freeze({
		id: createAgentToolId('codex.test.read'),
		revision: createAgentToolDescriptorRevision('codex.test.read.v1'),
		contributor: createAgentToolContributorId('codex-test'),
		functionName: 'read_codex_test_value',
		displayName: 'Read Codex test value',
		description: 'Reads one exact test value.',
		inputSchema: Object.freeze({
			profile: COMET_TOOL_SCHEMA_PROFILE,
			value: Object.freeze({
				type: 'object',
				properties: Object.freeze({
					text: Object.freeze({ type: 'string', minimumLength: 1 }),
				}),
				required: Object.freeze(['text']),
				additionalProperties: false,
			}),
		}),
		outputSchema: Object.freeze({
			profile: COMET_TOOL_SCHEMA_PROFILE,
			value: Object.freeze({
				type: 'object', properties: Object.freeze({}), required: Object.freeze([]), additionalProperties: false,
			}),
		}),
		safety: 'read',
		confirmation: 'never',
		allowsEditedInput: false,
		targetTypes: Object.freeze([]),
		limits: Object.freeze({
			maximumInputBytes: 1_024,
			maximumOutputBytes: 1_024,
			maximumContentBytes: 1_024,
			timeoutMilliseconds: 1_000,
			maximumConcurrency: 1,
		}),
	}),
	executor: Object.freeze({ kind: 'host', executor: createAgentToolExecutorId('codex-test-tool-executor') }),
});

class TestCodexClient implements ICodexAppServerClient {
	private readonly exitEmitter = new Emitter<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>();
	readonly onDidExit = this.exitEmitter.event;
	private readonly notifications = new Map<string, (params: unknown) => void>();
	private readonly serverRequests = new Map<string, (params: unknown) => Promise<unknown>>();
	readonly requests: Array<{ readonly method: string; readonly params: unknown }> = [];
	readonly toolResults: unknown[] = [];
	disposed = false;
	private releaseTurnStartResponse: (() => void) | undefined;
	private readonly turnStartedPromise: Promise<void>;
	private resolveTurnStarted!: () => void;

	constructor(
		private readonly models: unknown = modelPage,
		private readonly invokeTool = false,
		private readonly pauseTurnStart = false,
	) {
		this.turnStartedPromise = new Promise(resolve => this.resolveTurnStarted = resolve);
	}

	waitForTurnStart(): Promise<void> {
		return this.turnStartedPromise;
	}

	releaseTurnStart(): void {
		this.releaseTurnStartResponse?.();
	}

	async request(method: string, params: unknown): Promise<unknown> {
		this.requests.push({ method, params });
		switch (method) {
			case 'model/list': return this.models;
			case 'thread/start': return { thread: { id: 'codex-thread-1' } };
			case 'thread/resume': return { thread: { id: 'codex-thread-1' } };
			case 'turn/start':
				this.notifications.get('turn/started')?.({
					threadId: 'codex-thread-1', turn: { id: 'codex-turn-1', status: 'inProgress' },
				});
				this.resolveTurnStarted();
				if (this.pauseTurnStart) {
					await new Promise<void>(resolve => this.releaseTurnStartResponse = resolve);
				}
				queueMicrotask(async () => {
					if (this.invokeTool) {
						const handler = this.serverRequests.get('item/tool/call');
						if (handler === undefined) {
							throw new Error('Codex Tool request handler is missing.');
						}
						this.toolResults.push(await handler({
							threadId: 'codex-thread-1',
							turnId: 'codex-turn-1',
							callId: 'codex-call-1',
							namespace: null,
							tool: 'read_codex_test_value',
							arguments: { text: 'exact input' },
						}));
					}
					this.notifications.get('item/agentMessage/delta')?.({
						threadId: 'codex-thread-1', turnId: 'codex-turn-1', itemId: 'message-1', delta: 'Codex response',
					});
					this.notifications.get('turn/completed')?.({
						threadId: 'codex-thread-1', turn: { id: 'codex-turn-1', status: 'completed' },
					});
				});
				return { turn: { id: 'codex-turn-1' } };
			case 'turn/interrupt': return {};
			case 'thread/delete': return {};
			default: throw new Error(`Unexpected Codex request: ${method}`);
		}
	}

	notify(): void {}

	onNotification(method: string, handler: (params: unknown) => void): IDisposable {
		this.notifications.set(method, handler);
		return toDisposable(() => this.notifications.delete(method));
	}

	onRequest(method: string, handler: (params: unknown) => Promise<unknown>): IDisposable {
		if (this.serverRequests.has(method)) {
			throw new Error(`Duplicate Codex server request handler: ${method}`);
		}
		this.serverRequests.set(method, handler);
		return toDisposable(() => this.serverRequests.delete(method));
	}

	dispose(): void {
		this.disposed = true;
		this.notifications.clear();
		this.serverRequests.clear();
		this.exitEmitter.dispose();
	}
}

class TestCodexFactory implements ICodexAppServerFactory {
	readonly clients: TestCodexClient[] = [];
	readonly apiKeys: Array<string | undefined> = [];
	private readonly authenticatedClientPromise: Promise<TestCodexClient>;
	private resolveAuthenticatedClient!: (client: TestCodexClient) => void;

	constructor(
		private readonly models: unknown = modelPage,
		private readonly pauseTurnStart = false,
	) {
		this.authenticatedClientPromise = new Promise(resolve => this.resolveAuthenticatedClient = resolve);
	}

	waitForAuthenticatedClient(): Promise<TestCodexClient> {
		return this.authenticatedClientPromise;
	}

	start(apiKey?: string): Promise<ICodexAppServerClient> {
		this.apiKeys.push(apiKey);
		const client = new TestCodexClient(
			this.models,
			apiKey !== undefined && !this.pauseTurnStart,
			this.pauseTurnStart && apiKey !== undefined,
		);
		this.clients.push(client);
		if (apiKey !== undefined) {
			this.resolveAuthenticatedClient(client);
		}
		return Promise.resolve(client);
	}
}

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

async function createCodexTurnFixture(factory: TestCodexFactory, suffix: string) {
	const fixtureSession = createAgentSessionId(`codex-sdk-session-${suffix}`);
	const fixtureChat = createAgentChatId(`codex-sdk-chat-${suffix}`);
	const fixtureTurn = createAgentTurnId(`codex-sdk-turn-${suffix}`);
	const agent = await CodexAgent.create({
		packageRevision,
		stateDirectory: `/tmp/comet-codex-${suffix}`,
		appServerFactory: factory,
		toolExecution: unusedToolExecution,
		credentialResolver: { resolve: async () => 'test-openai-key' },
	});
	const descriptor = agent.descriptor.get();
	const modelConfiguration = Object.freeze({
		schema: descriptor.models[0].configurationSchema.revision,
		values: Object.freeze({
			[CODEX_AGENT_REASONING_EFFORT_PROPERTY]: 'medium',
			[CODEX_AGENT_REASONING_SUMMARY_PROPERTY]: 'auto',
			[CODEX_AGENT_CREDENTIAL_PROPERTY]: Object.freeze({
				provider: CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER,
				scope: 'llm',
				reference: CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE,
			}),
		}),
	});
	const profile = await agent.executionProfiles.resolve({
		submission: createAgentSubmissionId(`resolve-codex-profile-${suffix}`),
		selection: { kind: 'user', value: { model: descriptor.models[0].id }, configuration: modelConfiguration },
		selectionDigest: createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`),
		runtimeRegistration: agent.registration.revision,
		sessionConfiguration,
	});
	await agent.sessions.create({
		...operation(`create-codex-session-${suffix}`, '7'),
		session: fixtureSession,
		configuration: sessionConfiguration,
		workspace: {
			resource: `file:///tmp/comet-codex-${suffix}`,
			label: 'Codex cancellation test workspace',
			folders: [{
				resource: `file:///tmp/comet-codex-${suffix}`,
				workingDirectory: `/tmp/comet-codex-${suffix}`,
				name: `comet-codex-${suffix}`,
			}],
		},
	});
	await agent.chats.create({
		...operation(`create-codex-chat-${suffix}`, '8'),
		session: fixtureSession,
		chat: fixtureChat,
		origin: { kind: 'user' },
	});
	const request: IAgentChatRequest = {
		...operation(`send-codex-turn-${suffix}`, '9'),
		session: fixtureSession,
		chat: fixtureChat,
		turn: fixtureTurn,
		submission: createAgentSubmissionId(`codex-submission-${suffix}`),
		message: 'Run Codex until cancelled',
		attachments: [],
		interactionTargets: [],
		binding: {
			profile,
			modelConfiguration,
			credentials: [{
				provider: CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER,
				scope: 'llm',
				reference: CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE,
			}],
			runtimeRegistration: agent.registration.revision,
			toolSet: {
				revision: createAgentToolSetRevision(`codex-tools-${suffix}`),
				schemaProfile: COMET_TOOL_SCHEMA_PROFILE,
				runtimeRegistration: agent.registration.revision,
				agentDescriptor: descriptor.revision,
				modelDescriptor: descriptor.models[0].revision,
				registrations: [],
			},
			deadline: Date.now() + 60_000,
			cancellation: createAgentCancellationId(`codex-cancellation-${suffix}`),
			outputConstraints: null,
		},
	};
	return { agent, request, fixtureSession, fixtureChat, fixtureTurn };
}

test('Codex product declares Host execution and one exact native SDK dependency', () => {
	const executableDigest = createAgentPackageContentDigest(`sha256:${'a'.repeat(64)}`);
	const product = createCodexAgentPackageProduct(
		{ operatingSystem: 'darwin', architecture: 'arm64' },
		{
			contentDigest: createAgentPackageContentDigest(`sha256:${'b'.repeat(64)}`),
			executable: { source: 'file:///verified/codex', contentDigest: executableDigest },
		},
		'/tmp/comet-codex-product-state',
	);

	assert.equal(product.execution, 'host');
	assert.deepEqual(product.verifiedPackage.manifest.execution, { kind: 'host' });
	assert.deepEqual(product.verifiedPackage.dependencyClosure.map(dependency => ({
		target: dependency.target,
		digest: dependency.digest,
		executable: dependency.executable,
		immutable: dependency.immutable,
	})), [{
		target: CODEX_AGENT_SDK_EXECUTABLE_TARGET,
		digest: executableDigest,
		executable: true,
		immutable: true,
	}]);
	assert.deepEqual(product.credentialBindings, [{
		provider: CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER,
		scope: 'llm',
		reference: CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE,
		privilege: 'configured.model.api-key',
	}]);
});

test('Codex Agent rejects empty and duplicate SDK model snapshots without a maintained fallback', async () => {
	for (const [name, data] of [
		['empty', []],
		['duplicate', [modelPage.data[0], modelPage.data[0]]],
	] as const) {
		const factory = new TestCodexFactory({ data, nextCursor: null });
		await assert.rejects(CodexAgent.create({
			packageRevision,
			stateDirectory: `/tmp/comet-codex-${name}-models`,
			appServerFactory: factory,
			toolExecution: unusedToolExecution,
			credentialResolver: { resolve: async () => 'test-openai-key' },
		}), /empty or duplicated/);
		assert.deepEqual(factory.apiKeys, [undefined]);
	}
});

test('Codex Agent rejects a repeated SDK model pagination cursor', async () => {
	const factory = new TestCodexFactory({ data: modelPage.data, nextCursor: 'repeated-cursor' });
	await assert.rejects(CodexAgent.create({
		packageRevision,
		stateDirectory: '/tmp/comet-codex-repeated-model-cursor',
		appServerFactory: factory,
		toolExecution: unusedToolExecution,
		credentialResolver: { resolve: async () => 'test-openai-key' },
	}), /repeated a model page cursor/);
	assert.deepEqual(factory.clients[0].requests.map(request => request.params), [{
		cursor: null, limit: 100, includeHidden: false,
	}, {
		cursor: 'repeated-cursor', limit: 100, includeHidden: false,
	}]);
});

test('Codex Agent snapshots SDK models and executes one durable thread directly', async () => {
	const factory = new TestCodexFactory();
	const executedCalls: IAgentToolCall[] = [];
	const agent = await CodexAgent.create({
		packageRevision,
		stateDirectory: '/tmp/comet-codex-agent',
		appServerFactory: factory,
		toolExecution: {
			execute: async call => {
				executedCalls.push(call);
				return Object.freeze({ call: call.id, status: 'completed', output: Object.freeze({ value: 'exact output' }) });
			},
			cancel: async () => undefined,
			reconcile: async () => Object.freeze({ kind: 'unknown' }),
			release: () => undefined,
		},
		credentialResolver: { resolve: async () => 'test-openai-key' },
	});
	const actions: IAgentAction[] = [];
	const listener = agent.onDidEmitAction(action => actions.push(action));
	try {
		const descriptor = agent.descriptor.get();
		assert.equal(agent.registration.revision, createCodexAgentRegistrationRevision(descriptor.revision));
		assert.equal(CODEX_AGENT_PACKAGE_DEFINITION.resolveRegistrationRevision(descriptor), agent.registration.revision);
		assert.deepEqual(descriptor.models.map(model => ({ id: model.id, name: model.displayName })), [{
			id: 'codex:gpt-test-codex',
			name: 'GPT Test Codex',
		}]);
		assert.deepEqual(
			descriptor.models[0].configurationSchema.properties.find(
				property => property.id === CODEX_AGENT_REASONING_EFFORT_PROPERTY,
			)?.value,
			{ type: 'string', enum: ['medium', 'low', 'high'] },
		);

		const modelConfiguration = Object.freeze({
			schema: descriptor.models[0].configurationSchema.revision,
			values: Object.freeze({
				[CODEX_AGENT_REASONING_EFFORT_PROPERTY]: 'high',
				[CODEX_AGENT_REASONING_SUMMARY_PROPERTY]: 'auto',
				[CODEX_AGENT_CREDENTIAL_PROPERTY]: Object.freeze({
					provider: CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER,
					scope: 'llm',
					reference: CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE,
				}),
			}),
		});
		const profile = await agent.executionProfiles.resolve({
			submission: createAgentSubmissionId('resolve-codex-profile'),
			selection: { kind: 'user', value: { model: descriptor.models[0].id }, configuration: modelConfiguration },
			selectionDigest: createAgentHostPayloadDigest(`sha256:${'c'.repeat(64)}`),
			runtimeRegistration: agent.registration.revision,
			sessionConfiguration,
		});
		await agent.sessions.create({
			...operation('create-codex-session', '1'),
			session,
			configuration: sessionConfiguration,
			workspace: {
				resource: 'file:///tmp/comet-codex-workspace',
				label: 'Codex test workspace',
				folders: [{
					resource: 'file:///tmp/comet-codex-workspace',
					workingDirectory: '/tmp/comet-codex-workspace',
					name: 'comet-codex-workspace',
				}],
			},
		});
		await agent.chats.create({ ...operation('create-codex-chat', '2'), session, chat, origin: { kind: 'user' } });
		const request: IAgentChatRequest = {
			...operation('send-codex-turn', '3'),
			session,
			chat,
			turn: createAgentTurnId('codex-turn'),
			submission: createAgentSubmissionId('codex-submission'),
			message: 'Run Codex',
			attachments: [],
			interactionTargets: [],
			binding: {
				profile,
				modelConfiguration,
				credentials: [{
					provider: CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER,
					scope: 'llm',
					reference: CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE,
				}],
				runtimeRegistration: agent.registration.revision,
				toolSet: {
					revision: createAgentToolSetRevision('codex-tools'),
					schemaProfile: COMET_TOOL_SCHEMA_PROFILE,
					runtimeRegistration: agent.registration.revision,
					agentDescriptor: descriptor.revision,
					modelDescriptor: descriptor.models[0].revision,
					registrations: [toolRegistration],
				},
				deadline: Date.now() + 60_000,
				cancellation: createAgentCancellationId('codex-cancellation'),
				outputConstraints: null,
			},
		};
		await agent.chats.send(request);
		await agent.chats.send({
			...request,
			...operation('send-second-codex-turn', '4'),
			turn: createAgentTurnId('codex-turn-2'),
			submission: createAgentSubmissionId('codex-submission-2'),
			message: 'Continue Codex',
			binding: {
				...request.binding,
				toolSet: {
					...request.binding.toolSet,
					revision: createAgentToolSetRevision('codex-tools-second-submission'),
				},
			},
		});

		assert.deepEqual(factory.apiKeys, [undefined, 'test-openai-key']);
		const authenticatedClient = factory.clients[1];
		assert.deepEqual(authenticatedClient.requests.map(call => call.method), [
			'thread/start', 'turn/start', 'thread/resume', 'turn/start',
		]);
		const threadStart = authenticatedClient.requests[0].params as {
			readonly dynamicTools: readonly { readonly inputSchema: unknown }[];
		};
		assert.deepEqual(threadStart.dynamicTools, [{
			type: 'function',
			name: 'read_codex_test_value',
			description: 'Reads one exact test value.',
			inputSchema: {
				type: 'object',
				properties: { text: { type: 'string', minLength: 1 } },
				required: ['text'],
				additionalProperties: false,
			},
		}]);
		assert.equal(executedCalls.length, 2);
		assert.deepEqual(executedCalls.map(call => call.input), [
			{ text: 'exact input' },
			{ text: 'exact input' },
		]);
		assert.deepEqual(authenticatedClient.toolResults, [
			{ contentItems: [{ type: 'inputText', text: '{"value":"exact output"}' }], success: true },
			{ contentItems: [{ type: 'inputText', text: '{"value":"exact output"}' }], success: true },
		]);
		assert.deepEqual(actions.map(action => action.kind), [
			'turnProgress',
			'chatResumeStateChanged',
			'turnProgress',
			'turnProgress',
			'turnProgress',
			'turnTerminal',
			'turnProgress',
			'turnProgress',
			'turnProgress',
			'turnProgress',
			'turnTerminal',
		]);
		const terminal = actions.at(-1);
		assert.equal(terminal?.kind === 'turnTerminal' ? terminal.state : undefined, 'completed');
	} finally {
		listener.dispose();
		agent.dispose();
	}
});

test('Codex Agent interrupts the exact app-server Turn when cancellation races turn/start', async () => {
	const factory = new TestCodexFactory(modelPage, true);
	const { agent, request, fixtureSession, fixtureChat, fixtureTurn } = await createCodexTurnFixture(factory, 'cancel');
	const actions: IAgentAction[] = [];
	const listener = agent.onDidEmitAction(action => actions.push(action));
	try {
		const send = agent.chats.send(request);
		const client = await factory.waitForAuthenticatedClient();
		await client.waitForTurnStart();
		await agent.chats.cancel({
			...operation('cancel-codex-turn', '6'),
			session: fixtureSession,
			chat: fixtureChat,
			turn: fixtureTurn,
		});
		client.releaseTurnStart();
		await send;

		assert.deepEqual(client.requests.map(call => call.method), [
			'thread/start', 'turn/start', 'turn/interrupt',
		]);
		assert.deepEqual(client.requests.at(-1)?.params, {
			threadId: 'codex-thread-1',
			turnId: 'codex-turn-1',
		});
		const terminals = actions.filter(action => action.kind === 'turnTerminal');
		assert.equal(terminals.length, 1);
		assert.equal(terminals[0].kind === 'turnTerminal' ? terminals[0].state : undefined, 'cancelled');
	} finally {
		listener.dispose();
		agent.dispose();
	}
});
