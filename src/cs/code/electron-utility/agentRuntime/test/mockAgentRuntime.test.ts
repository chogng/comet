/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { Event } from 'cs/base/common/event';
import {
	createMockAgentPackageProducts,
	getMockAgentPackageDefinition,
	validateInstalledMockAgentPackage,
} from 'cs/code/common/agentHost/test/mockAgentPackages';
import {
	MockAgentRuntime,
	productMockAgentRuntimeRetentionLimits,
} from 'cs/code/electron-utility/agentRuntime/test/mockAgentRuntime';
import type {
	IAgentCancelTurnRequest,
	IAgentCreateChatOptions,
	IAgentCreateSessionOptions,
	IAgentDeleteChatRequest,
	IAgentDeleteSessionRequest,
	IAgentFinalizeSessionConfigurationUpdateRequest,
	IAgentPrepareSessionConfigurationUpdateRequest,
} from 'cs/platform/agentHost/common/agent';
import type {
	IAgentRuntimeCall,
	IAgentRuntimeOperationOutcomeRequest,
} from 'cs/platform/agentHost/common/connections';
import { ManagedAgentRuntimeConnection } from 'cs/platform/agentHost/common/managedAgentRuntimeConnection';
import {
	createAgentChatId,
	createAgentConfigurationStateRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentPackageContentDigest,
	createAgentPackageId,
	createAgentRuntimeCallId,
	createAgentRuntimeConnectionGeneration,
	createAgentRuntimeConnectionId,
	createAgentRuntimeHostOperationId,
	createAgentRuntimeProtocolVersion,
	createAgentSessionId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';

const testRuntimeArtifact = Object.freeze({
	source: 'file:///mock-agent-runtime.js',
	contentDigest: createAgentPackageContentDigest(`sha256:${'a'.repeat(64)}`),
});

const codexSessionConfigurationValues = Object.freeze({
	'codex.approvalPolicy': 'on-request',
	'codex.sandboxMode': 'workspace-write',
	'codex.webSearchMode': 'disabled',
	'codex.personality': 'none',
});

const codexPlanSessionConfigurationValues = Object.freeze({
	...codexSessionConfigurationValues,
	'codex.approvalPolicy': 'never',
});

async function createInitializedMockRuntime(
	maximumRetainedOperations: number,
	maximumRetainedTerminalTurns: number,
): Promise<{
	readonly runtime: MockAgentRuntime;
	readonly definition: ReturnType<typeof getMockAgentPackageDefinition>;
	readonly connection: ReturnType<typeof createAgentRuntimeConnectionId>;
	readonly generation: ReturnType<typeof createAgentRuntimeConnectionGeneration>;
}> {
	const product = createMockAgentPackageProducts(
		{ operatingSystem: 'test', architecture: 'x64' },
		testRuntimeArtifact,
	)[1];
	const definition = getMockAgentPackageDefinition(createAgentPackageId('codex'));
	const connection = createAgentRuntimeConnectionId('mock-retention-test');
	const generation = createAgentRuntimeConnectionGeneration(1);
	const runtime = new MockAgentRuntime({
		packageId: definition.packageId,
		packageRevision: product.offering.revision,
		connection,
		generation,
		maximumRetainedOperations,
		maximumRetainedTerminalTurns,
	});
	await runtime.initialize({
		connection,
		generation,
		call: createAgentRuntimeCallId('initialize-retention'),
		protocolVersions: [createAgentRuntimeProtocolVersion('2')],
		transportLimits: {
			maximumRequestBytes: 1024 * 1024,
			maximumResponseBytes: 1024 * 1024,
			maximumActionBytes: 1024 * 1024,
			maximumConcurrentCalls: 8,
		},
		packageId: definition.packageId,
		packageRevision: product.offering.revision,
		authorizedAgents: [definition.agentId],
		implementation: { name: 'test-host', build: 'test' },
	});
	return { runtime, definition, connection, generation };
}

function mockRuntimeCall<TRequest>(
	context: Awaited<ReturnType<typeof createInitializedMockRuntime>>,
	call: string,
	request: TRequest,
): IAgentRuntimeCall<TRequest> {
	return {
		connection: context.connection,
		generation: context.generation,
		call: createAgentRuntimeCallId(call),
		registration: context.definition.registration.revision,
		agent: context.definition.agentId,
		request,
	};
}

suite('MockAgentRuntime', { concurrency: false }, () => {
	test('publishes explicit connected products with complete canonical configuration axes', () => {
		const products = createMockAgentPackageProducts(
			{ operatingSystem: 'test', architecture: 'x64' },
			testRuntimeArtifact,
		);
		assert.deepStrictEqual(products.map(product => ({
			packageId: product.offering.packageId,
			distribution: product.offering.distribution,
			execution: product.verifiedPackage.manifest.execution.kind,
			properties: [
				...product.definition.sessionConfigurationSchema.properties,
				...product.definition.modelConfigurationSchema.properties,
			].map(property => property.id),
		})), [
			{
				packageId: 'copilot',
				distribution: 'user',
				execution: 'connected',
				properties: ['copilot.mode', 'copilot.autoApprove', 'copilot.isolation'],
			},
			{
				packageId: 'codex',
				distribution: 'user',
				execution: 'connected',
				properties: [
					'codex.approvalPolicy',
					'codex.sandboxMode',
					'codex.webSearchMode',
					'codex.personality',
					'codex.modelReasoningEffort',
					'codex.reasoningSummary',
				],
			},
		]);
		for (const product of products) {
			assert.equal(product.verifiedPackage.dependencyClosure.length, 1);
			assert.equal(product.verifiedPackage.dependencyClosure[0].immutable, true);
			assert.equal(
				product.verifiedPackage.dependencyClosure[0].verifiedDigest,
				product.verifiedPackage.dependencyClosure[0].digest,
			);
			assert.ok(product.definition.sessionConfigurationSchema.properties.every(property => !property.dynamicCompletion));
			assert.ok(product.definition.modelConfigurationSchema.properties.every(property => !property.dynamicCompletion));
		}
		const copilot = products[0];
		const installed = Object.freeze({
			...copilot.offering,
			manifest: copilot.verifiedPackage.manifest,
			dependencyClosure: copilot.verifiedPackage.dependencyClosure,
			grantedPrivileges: copilot.verifiedPackage.grantedPrivileges,
		});
		assert.equal(validateInstalledMockAgentPackage(installed, products), copilot.definition);
		assert.throws(() => validateInstalledMockAgentPackage(Object.freeze({
			...installed,
			manifest: Object.freeze({
				...installed.manifest,
				execution: Object.freeze({ kind: 'connected' as const, entryPoint: 'another-runtime.js' }),
			}),
		}), products), /does not match its exact product artifact/);
		assert.throws(() => validateInstalledMockAgentPackage(Object.freeze({
			...installed,
			grantedPrivileges: Object.freeze([]),
		}), products), /does not match its exact product artifact/);
		assert.throws(() => validateInstalledMockAgentPackage(Object.freeze({
			...installed,
			source: 'file:///tampered-runtime.js',
			contentDigest: createAgentPackageContentDigest(`sha256:${'b'.repeat(64)}`),
			manifest: Object.freeze({
				...installed.manifest,
				contentDigest: createAgentPackageContentDigest(`sha256:${'b'.repeat(64)}`),
				dependencies: Object.freeze([Object.freeze({
					...installed.manifest.dependencies[0],
					source: 'file:///tampered-runtime.js',
					digest: createAgentPackageContentDigest(`sha256:${'b'.repeat(64)}`),
				})]),
			}),
			dependencyClosure: Object.freeze([Object.freeze({
				...installed.dependencyClosure[0],
				source: 'file:///tampered-runtime.js',
				digest: createAgentPackageContentDigest(`sha256:${'b'.repeat(64)}`),
				verifiedDigest: createAgentPackageContentDigest(`sha256:${'b'.repeat(64)}`),
			})]),
		}), products), /does not match its exact product artifact/);
	});

	test('deletes unknown retained backing idempotently in a fresh runtime', async () => {
		const product = createMockAgentPackageProducts(
			{ operatingSystem: 'test', architecture: 'x64' },
			testRuntimeArtifact,
		)[1];
		const definition = getMockAgentPackageDefinition(createAgentPackageId('codex'));
		const connection = createAgentRuntimeConnectionId('mock-delete-test');
		const generation = createAgentRuntimeConnectionGeneration(1);
		const runtime = new MockAgentRuntime({
			packageId: definition.packageId,
			packageRevision: product.offering.revision,
			connection,
			generation,
			...productMockAgentRuntimeRetentionLimits,
		});
		try {
			await runtime.initialize({
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
				packageId: definition.packageId,
				packageRevision: product.offering.revision,
				authorizedAgents: [definition.agentId],
				implementation: { name: 'test-host', build: 'test' },
			});

			const sessionRequest: IAgentRuntimeCall<IAgentDeleteSessionRequest> = {
				connection,
				generation,
				call: createAgentRuntimeCallId('delete-session'),
				registration: definition.registration.revision,
				agent: definition.agentId,
				request: {
					operation: createAgentHostOperationId('delete-session'),
					payloadDigest: createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`),
					session: createAgentSessionId('retained-session'),
				},
			};
			assert.equal((await runtime.deleteSession(sessionRequest)).value, null);
			assert.equal((await runtime.deleteSession(sessionRequest)).value, null);

			const chatRequest: IAgentRuntimeCall<IAgentDeleteChatRequest> = {
				connection,
				generation,
				call: createAgentRuntimeCallId('delete-chat'),
				registration: definition.registration.revision,
				agent: definition.agentId,
				request: {
					operation: createAgentHostOperationId('delete-chat'),
					payloadDigest: createAgentHostPayloadDigest(`sha256:${'b'.repeat(64)}`),
					session: createAgentSessionId('retained-session'),
					chat: createAgentChatId('retained-chat'),
				},
			};
			assert.equal((await runtime.deleteChat(chatRequest)).value, null);
			assert.equal((await runtime.deleteChat(chatRequest)).value, null);
		} finally {
			runtime.dispose();
		}
	});

	test('bounds completed operation outcomes without evicting a pending configuration transaction', async () => {
		const context = await createInitializedMockRuntime(2, 2);
		const session = createAgentSessionId('retention-session');
		const configuration = Object.freeze({
			schema: context.definition.sessionConfigurationSchema,
			revision: createAgentConfigurationStateRevision('retention-configuration-1'),
			values: codexSessionConfigurationValues,
		});
		const createRequest: IAgentCreateSessionOptions = {
			operation: createAgentHostOperationId('retention-create-session'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'1'.repeat(64)}`),
			session,
			configuration,
		};
		await context.runtime.createSession(mockRuntimeCall(context, 'retention-create-call', createRequest));

		const pendingOperation = createAgentHostOperationId('retention-pending-configuration');
		const pendingDigest = createAgentHostPayloadDigest(`sha256:${'2'.repeat(64)}`);
		const prepareRequest: IAgentPrepareSessionConfigurationUpdateRequest = {
			operation: pendingOperation,
			payloadDigest: pendingDigest,
			runtimeRegistration: context.definition.registration.revision,
			session,
			current: configuration,
			candidate: Object.freeze({
				...configuration,
				revision: createAgentConfigurationStateRevision('retention-configuration-2'),
				values: codexPlanSessionConfigurationValues,
			}),
		};
		await context.runtime.prepareSessionConfigurationUpdate(
			mockRuntimeCall(context, 'retention-prepare-call', prepareRequest),
		);

		const completed = [
			{ operation: 'retention-delete-1', digit: '3' },
			{ operation: 'retention-delete-2', digit: '4' },
			{ operation: 'retention-delete-3', digit: '5' },
		] as const;
		for (const item of completed) {
			const request: IAgentDeleteChatRequest = {
				operation: createAgentHostOperationId(item.operation),
				payloadDigest: createAgentHostPayloadDigest(`sha256:${item.digit.repeat(64)}`),
				session,
				chat: createAgentChatId('retention-unknown-chat'),
			};
			await context.runtime.deleteChat(mockRuntimeCall(context, `${item.operation}-call`, request));
		}

		const outcome = async (
			operation: ReturnType<typeof createAgentHostOperationId>,
			digest: ReturnType<typeof createAgentHostPayloadDigest>,
			call: string,
		) => context.runtime.getOperationOutcome(mockRuntimeCall<IAgentRuntimeOperationOutcomeRequest>(
			context,
			call,
			{ operation, digest },
		));
		assert.deepEqual((await outcome(pendingOperation, pendingDigest, 'retention-pending-outcome')).value, {
			kind: 'pending',
		});
		assert.deepEqual((await outcome(
			createAgentHostOperationId(completed[0].operation),
			createAgentHostPayloadDigest(`sha256:${completed[0].digit.repeat(64)}`),
			'retention-evicted-outcome',
		)).value, { kind: 'unknown' });
		assert.deepEqual((await outcome(
			createAgentHostOperationId(completed[2].operation),
			createAgentHostPayloadDigest(`sha256:${completed[2].digit.repeat(64)}`),
			'retention-completed-outcome',
		)).value, { kind: 'completed', value: null });

		context.runtime.dispose();
	});

	test('identifies rollback by the prepared candidate configuration revision', async () => {
		const context = await createInitializedMockRuntime(8, 2);
		const session = createAgentSessionId('rollback-candidate-session');
		const current = Object.freeze({
			schema: context.definition.sessionConfigurationSchema,
			revision: createAgentConfigurationStateRevision('rollback-current-configuration'),
			values: codexSessionConfigurationValues,
		});
		const candidate = Object.freeze({
			...current,
			revision: createAgentConfigurationStateRevision('rollback-candidate-configuration'),
			values: codexPlanSessionConfigurationValues,
		});
		const createRequest: IAgentCreateSessionOptions = {
			operation: createAgentHostOperationId('rollback-create-session'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'6'.repeat(64)}`),
			session,
			configuration: current,
		};
		await context.runtime.createSession(mockRuntimeCall(context, 'rollback-create-call', createRequest));
		const operation = createAgentHostOperationId('rollback-configuration');
		const payloadDigest = createAgentHostPayloadDigest(`sha256:${'7'.repeat(64)}`);
		await context.runtime.prepareSessionConfigurationUpdate(mockRuntimeCall(context, 'rollback-prepare-call', {
			operation,
			payloadDigest,
			runtimeRegistration: context.definition.registration.revision,
			session,
			current,
			candidate,
		}));
		const finalize = (configuration: typeof current.revision): IAgentFinalizeSessionConfigurationUpdateRequest => ({
			operation,
			payloadDigest,
			runtimeRegistration: context.definition.registration.revision,
			session,
			configuration,
		});
		await assert.rejects(
			context.runtime.rollbackSessionConfigurationUpdate(mockRuntimeCall(
				context,
				'rollback-current-call',
				finalize(current.revision),
			)),
			/rollback decision is stale/,
		);
		assert.equal((await context.runtime.rollbackSessionConfigurationUpdate(mockRuntimeCall(
			context,
			'rollback-candidate-call',
			finalize(candidate.revision),
		))).value, null);

		context.runtime.dispose();
	});

	test('bounds terminal Turns and deletes exact Chat and Session terminal ownership', async () => {
		const context = await createInitializedMockRuntime(32, 1);
		const session = createAgentSessionId('terminal-retention-session');
		const chat = createAgentChatId('terminal-retention-chat');
		const configuration = Object.freeze({
			schema: context.definition.sessionConfigurationSchema,
			revision: createAgentConfigurationStateRevision('terminal-retention-configuration'),
			values: codexSessionConfigurationValues,
		});
		let operationSequence = 0;
		const operationContext = (name: string) => {
			operationSequence += 1;
			const digestDigit = (operationSequence % 16).toString(16);
			return {
				operation: createAgentHostOperationId(`${name}-${operationSequence}`),
				payloadDigest: createAgentHostPayloadDigest(`sha256:${digestDigit.repeat(64)}`),
			};
		};
		const createSession = async (): Promise<void> => {
			const request: IAgentCreateSessionOptions = {
				...operationContext('terminal-create-session'),
				session,
				configuration,
			};
			await context.runtime.createSession(mockRuntimeCall(context, `terminal-create-session-call-${operationSequence}`, request));
		};
		const createChat = async (): Promise<void> => {
			const request: IAgentCreateChatOptions = {
				...operationContext('terminal-create-chat'),
				session,
				chat,
				origin: { kind: 'user' },
			};
			await context.runtime.createChat(mockRuntimeCall(context, `terminal-create-chat-call-${operationSequence}`, request));
		};
		const cancel = async (turn: string): Promise<void> => {
			const request: IAgentCancelTurnRequest = {
				...operationContext('terminal-cancel'),
				session,
				chat,
				turn: createAgentTurnId(turn),
			};
			await context.runtime.cancel(mockRuntimeCall(context, `terminal-cancel-call-${operationSequence}`, request));
		};
		const terminalActions: string[] = [];
		const listener = context.runtime.onDidEmitAction(action => {
			if (action.action.kind === 'turnTerminal') {
				terminalActions.push(action.action.turn);
			}
		});

		await createSession();
		await createChat();
		await cancel('terminal-turn-1');
		await cancel('terminal-turn-2');
		await cancel('terminal-turn-1');
		assert.deepEqual(terminalActions, ['terminal-turn-1', 'terminal-turn-2', 'terminal-turn-1']);

		const deleteChatRequest: IAgentDeleteChatRequest = {
			...operationContext('terminal-delete-chat'),
			session,
			chat,
		};
		await context.runtime.deleteChat(mockRuntimeCall(
			context,
			`terminal-delete-chat-call-${operationSequence}`,
			deleteChatRequest,
		));
		await createChat();
		await cancel('terminal-turn-1');
		assert.equal(terminalActions.length, 4);

		const deleteSessionRequest: IAgentDeleteSessionRequest = {
			...operationContext('terminal-delete-session'),
			session,
		};
		await context.runtime.deleteSession(mockRuntimeCall(
			context,
			`terminal-delete-session-call-${operationSequence}`,
			deleteSessionRequest,
		));
		await createSession();
		await createChat();
		await cancel('terminal-turn-1');
		assert.equal(terminalActions.length, 5);

		listener.dispose();
		context.runtime.dispose();
	});

	test('rebinds one logical runtime connection to the next generation after process loss', async () => {
		const product = createMockAgentPackageProducts(
			{ operatingSystem: 'test', architecture: 'x64' },
			testRuntimeArtifact,
		)[0];
		const logicalConnection = createAgentRuntimeConnectionId('managed-mock-runtime');
		const generations: MockAgentRuntime[] = [];
		const managed = await ManagedAgentRuntimeConnection.create({
			connection: logicalConnection,
			createGeneration: (connection, runtimeGeneration) => {
				const runtime = new MockAgentRuntime({
					packageId: product.definition.packageId,
					packageRevision: product.offering.revision,
					connection,
					generation: runtimeGeneration,
					...productMockAgentRuntimeRetentionLimits,
				});
				generations.push(runtime);
				return Promise.resolve(runtime);
			},
		});
		try {
			await managed.initialize({
				connection: logicalConnection,
				generation: createAgentRuntimeConnectionGeneration(1),
				call: createAgentRuntimeCallId('managed-initialize'),
				protocolVersions: Object.freeze([createAgentRuntimeProtocolVersion('2')]),
				transportLimits: Object.freeze({
					maximumRequestBytes: 1024 * 1024,
					maximumResponseBytes: 1024 * 1024,
					maximumActionBytes: 1024 * 1024,
					maximumConcurrentCalls: 8,
				}),
				packageId: product.definition.packageId,
				packageRevision: product.offering.revision,
				authorizedAgents: Object.freeze([product.definition.agentId]),
				implementation: Object.freeze({ name: 'managed-runtime-test', build: '1' }),
			});

			const reconnected = new Promise(resolve => Event.once(managed.onDidReconnect)(resolve));
			generations[0].disconnect('processExited');
			const state = await reconnected;
			assert.deepEqual(state, {
				connection: logicalConnection,
				previousGeneration: createAgentRuntimeConnectionGeneration(1),
				generation: createAgentRuntimeConnectionGeneration(2),
			});
			assert.equal(generations.length, 2);
			assert.deepEqual(generations.map(runtime => runtime.connection), [logicalConnection, logicalConnection]);
			assert.deepEqual(generations.map(runtime => runtime.generation), [1, 2]);
			assert.equal(generations[1].state.kind, 'connected');

			const reconnectedAgain = new Promise(resolve => Event.once(managed.onDidReconnect)(resolve));
			generations[1].disconnect('processExited');
			assert.deepEqual(await reconnectedAgain, {
				connection: logicalConnection,
				previousGeneration: createAgentRuntimeConnectionGeneration(2),
				generation: createAgentRuntimeConnectionGeneration(3),
			});
			assert.deepEqual(generations.map(runtime => runtime.generation), [1, 2, 3]);

			const response = await managed.getOperationOutcome({
				connection: logicalConnection,
				generation: createAgentRuntimeConnectionGeneration(3),
				call: createAgentRuntimeCallId('managed-generation-two-call'),
				registration: product.definition.registration.revision,
				agent: product.definition.agentId,
				request: Object.freeze({
					operation: createAgentHostOperationId('managed-generation-two-operation'),
					digest: createAgentHostPayloadDigest(`sha256:${'d'.repeat(64)}`),
				}),
			});
			assert.equal(response.generation, 3);
			assert.deepEqual(response.value, { kind: 'unknown' });

			const lateResponse = {
				connection: logicalConnection,
				generation: createAgentRuntimeConnectionGeneration(1),
				operation: createAgentRuntimeHostOperationId('managed-late-host-operation'),
				parentCall: createAgentRuntimeCallId('managed-late-parent-call'),
				registration: product.definition.registration.revision,
				agent: product.definition.agentId,
				outcome: Object.freeze({ kind: 'cancelled' as const }),
			};
			await managed.completeHostOperation(lateResponse);
			await assert.rejects(managed.completeHostOperation({
				...lateResponse,
				connection: createAgentRuntimeConnectionId('foreign-managed-runtime'),
			}));
		} finally {
			managed.dispose();
		}
	});

	test('disconnects the logical runtime when the next exact generation cannot launch', async () => {
		const product = createMockAgentPackageProducts(
			{ operatingSystem: 'test', architecture: 'x64' },
			testRuntimeArtifact,
		)[0];
		const logicalConnection = createAgentRuntimeConnectionId('managed-mock-runtime-failed-restart');
		let first: MockAgentRuntime | undefined;
		const managed = await ManagedAgentRuntimeConnection.create({
			connection: logicalConnection,
			createGeneration: (connection, runtimeGeneration) => {
				if (runtimeGeneration !== 1) {
					return Promise.reject(new Error('Next runtime generation failed to launch.'));
				}
				first = new MockAgentRuntime({
					packageId: product.definition.packageId,
					packageRevision: product.offering.revision,
					connection,
					generation: runtimeGeneration,
					...productMockAgentRuntimeRetentionLimits,
				});
				return Promise.resolve(first);
			},
		});
		try {
			await managed.initialize({
				connection: logicalConnection,
				generation: createAgentRuntimeConnectionGeneration(1),
				call: createAgentRuntimeCallId('failed-restart-initialize'),
				protocolVersions: Object.freeze([createAgentRuntimeProtocolVersion('2')]),
				transportLimits: Object.freeze({
					maximumRequestBytes: 1024 * 1024,
					maximumResponseBytes: 1024 * 1024,
					maximumActionBytes: 1024 * 1024,
					maximumConcurrentCalls: 8,
				}),
				packageId: product.definition.packageId,
				packageRevision: product.offering.revision,
				authorizedAgents: Object.freeze([product.definition.agentId]),
				implementation: Object.freeze({ name: 'managed-runtime-test', build: '1' }),
			});
			const disconnected = new Promise(resolve => Event.once(managed.onDidDisconnect)(resolve));
			first!.disconnect('processExited');
			assert.deepEqual(await disconnected, {
				kind: 'disconnected',
				connection: logicalConnection,
				generation: createAgentRuntimeConnectionGeneration(1),
				reason: 'processExited',
			});
			assert.equal(managed.state.kind, 'disconnected');
		} finally {
			managed.dispose();
		}
	});

	test('does not revive a disposed logical connection after a pending generation initializes', async () => {
		const product = createMockAgentPackageProducts(
			{ operatingSystem: 'test', architecture: 'x64' },
			testRuntimeArtifact,
		)[0];
		const logicalConnection = createAgentRuntimeConnectionId('managed-mock-runtime-disposed-restart');
		const candidateInitializationStarted = new DeferredPromise<void>();
		const allowCandidateInitialization = new DeferredPromise<void>();
		let first: MockAgentRuntime | undefined;
		let candidate: MockAgentRuntime | undefined;
		const managed = await ManagedAgentRuntimeConnection.create({
			connection: logicalConnection,
			createGeneration: (connection, runtimeGeneration) => {
				const runtime = new MockAgentRuntime({
					packageId: product.definition.packageId,
					packageRevision: product.offering.revision,
					connection,
					generation: runtimeGeneration,
					...productMockAgentRuntimeRetentionLimits,
				});
				if (runtimeGeneration === 1) {
					first = runtime;
				} else {
					candidate = runtime;
					const initialize = runtime.initialize.bind(runtime);
					runtime.initialize = async request => {
						candidateInitializationStarted.complete(undefined);
						await allowCandidateInitialization.p;
						return initialize(request);
					};
				}
				return Promise.resolve(runtime);
			},
		});
		await managed.initialize({
			connection: logicalConnection,
			generation: createAgentRuntimeConnectionGeneration(1),
			call: createAgentRuntimeCallId('disposed-restart-initialize'),
			protocolVersions: Object.freeze([createAgentRuntimeProtocolVersion('2')]),
			transportLimits: Object.freeze({
				maximumRequestBytes: 1024 * 1024,
				maximumResponseBytes: 1024 * 1024,
				maximumActionBytes: 1024 * 1024,
				maximumConcurrentCalls: 8,
			}),
			packageId: product.definition.packageId,
			packageRevision: product.offering.revision,
			authorizedAgents: Object.freeze([product.definition.agentId]),
			implementation: Object.freeze({ name: 'managed-runtime-test', build: '1' }),
		});
		let reconnectCount = 0;
		const reconnectListener = managed.onDidReconnect(() => reconnectCount += 1);
		try {
			first!.disconnect('processExited');
			await candidateInitializationStarted.p;
			const candidateDisposed = new Promise(resolve => Event.once(candidate!.onDidDisconnect)(resolve));
			managed.dispose();
			assert.deepEqual(managed.state, {
				kind: 'disconnected',
				connection: logicalConnection,
				generation: createAgentRuntimeConnectionGeneration(1),
				reason: 'disposed',
			});
			allowCandidateInitialization.complete(undefined);
			assert.deepEqual(await candidateDisposed, {
				kind: 'disconnected',
				connection: logicalConnection,
				generation: createAgentRuntimeConnectionGeneration(2),
				reason: 'disposed',
			});
			assert.equal(reconnectCount, 0);
			assert.equal(managed.generation, 1);
			assert.equal(managed.state.kind, 'disconnected');
		} finally {
			reconnectListener.dispose();
			managed.dispose();
			candidate?.dispose();
		}
	});
});
