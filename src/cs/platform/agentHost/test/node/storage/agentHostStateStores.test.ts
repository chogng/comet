/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { InMemoryStorageDatabase, Storage } from 'cs/base/parts/storage/common/storage';
import {
	AgentConfigurationSchemaProfile,
	type IAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentConfigurationPropertyId,
	createAgentConfigurationSchemaRevision,
	createAgentConfigurationStateRevision,
	createAgentCapabilityRevision,
	createAgentDescriptorRevision,
	createAgentHostClientConnectionId,
	createAgentHostChannelRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentHostSequence,
	createAgentId,
	createAgentPackageId,
	createAgentResumeSchemaId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentToolSchemaProfileId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentPackagePersistedState } from 'cs/platform/agentHost/common/packages';
import { getAgentHostSessionsChannelId } from 'cs/platform/agentHost/common/protocol';
import {
	createEmptyAgentHostCatalog,
	maximumRetainedAgentHostSessionConfigurationFinalizations,
} from 'cs/platform/agentHost/node/host/agentHostCatalog.js';
import {
	ApplicationStorageAgentHostCatalogStore,
	ApplicationStorageAgentPackageStateStore,
	ApplicationStorageLegacyAgentHostCatalogSource,
} from 'cs/platform/agentHost/node/storage/agentHostStateStores';

const agentHostCatalogStorageKeyV1 = 'agentHost.catalog.v1';
const agentHostCatalogStorageKeyV2 = 'agentHost.catalog.v2';
const agentHostCatalogStorageKey = 'agentHost.catalog.v3';
const agentPackageStateStorageKeyV1 = 'agentHost.packages.v1';
const agentPackageStateStorageKeyV2 = 'agentHost.packages.v2';
const agentPackageStateStorageKey = 'agentHost.packages.v3';
const configuredAgentId = createAgentId('test.configured-agent');
const configuredProperty = createAgentConfigurationPropertyId('test.configured-agent.mode');

const agentDefaults: IAgentConfigurationState = Object.freeze({
	schema: Object.freeze({
		profile: AgentConfigurationSchemaProfile,
		agent: configuredAgentId,
		scope: 'hostDefault',
		revision: createAgentConfigurationSchemaRevision('test.configured-agent.host-defaults.v1'),
		properties: Object.freeze([Object.freeze({
			id: configuredProperty,
			owner: Object.freeze({ kind: 'agent', agent: configuredAgentId }),
			scopes: Object.freeze(['hostDefault'] as const),
			value: Object.freeze({ type: 'string', enum: Object.freeze(['balanced', 'precise']) }),
			required: false,
			default: 'balanced',
			sessionMutable: false,
			dynamicCompletion: false,
			display: Object.freeze({ label: 'Mode' }),
			persistence: 'persisted',
			redaction: 'public',
		})]),
	}),
	revision: createAgentConfigurationStateRevision('test.configured-agent.host-defaults.state.v1'),
	values: Object.freeze({ [configuredProperty]: 'precise' }),
});

const sessionConfiguration: IAgentConfigurationState = Object.freeze({
	schema: Object.freeze({
		profile: AgentConfigurationSchemaProfile,
		agent: configuredAgentId,
		scope: 'session',
		revision: createAgentConfigurationSchemaRevision('test.configured-agent.session.v1'),
		properties: Object.freeze([]),
	}),
	revision: createAgentConfigurationStateRevision('test.configured-agent.session.state.v1'),
	values: Object.freeze({}),
});

const catalogMigration = Object.freeze({
	agentDefaults: Object.freeze([agentDefaults]),
	sessionConfigurations: Object.freeze([sessionConfiguration]),
});

const registrationV2 = Object.freeze({
	packageId: createAgentPackageId('test.configured-package'),
	agentId: configuredAgentId,
	revision: createAgentRuntimeRegistrationRevision('test.configured-runtime.v1'),
	descriptorRevision: createAgentDescriptorRevision('test.configured-agent.v1'),
	capabilityRevision: createAgentCapabilityRevision('test.configured-capabilities.v1'),
	supportedToolSchemaProfiles: Object.freeze([createAgentToolSchemaProfileId('test.configured-tools.v1')]),
	supportedResumeSchemas: Object.freeze([createAgentResumeSchemaId('test.configured-resume.v1')]),
	resumeMigrationEdges: Object.freeze([]),
});

const registrationV3 = Object.freeze({
	...registrationV2,
	revision: createAgentRuntimeRegistrationRevision('test.configured-runtime.v2'),
	descriptorRevision: createAgentDescriptorRevision('test.configured-agent.v2'),
	hostDefaultsSchema: agentDefaults.schema,
	initialSessionConfigurationSchema: sessionConfiguration.schema.revision,
	supportedSessionConfigurationSchemas: Object.freeze([sessionConfiguration.schema.revision]),
});

const packageMigration = Object.freeze({
	registrations: Object.freeze([Object.freeze({ source: registrationV2, target: registrationV3 })]),
});

async function createStorage(): Promise<Storage> {
	const storage = new Storage(new InMemoryStorageDatabase());
	await storage.init();
	return storage;
}

function createPackageState(revision: number): IAgentPackagePersistedState {
	return {
		revision,
		catalogRevision: revision,
		operations: [],
		installedPackages: [],
		activeRegistrations: [],
		retainedBackingRecords: [],
		materializedBackings: [],
	};
}

function createLegacyPackageState(revision: number) {
	return {
		revision,
		installedPackages: [],
		activeRegistrations: [],
		retainedBackingRecords: [],
		materializedBackings: [],
	};
}

function createLegacyAgentHostCatalog(revision: number) {
	const current = createEmptyAgentHostCatalog([]);
	return {
		schemaVersion: 1,
		revision,
		hostSequence: current.hostSequence,
		channelRevisions: current.channelRevisions,
		sessions: current.sessions,
		completedMigrations: current.completedMigrations,
	};
}

function createAgentHostCatalogV2(revision: number) {
	const current = createEmptyAgentHostCatalog([]);
	return {
		schemaVersion: 1,
		revision,
		packageCatalogRevision: 3,
		hostSequence: current.hostSequence,
		channelRevisions: current.channelRevisions,
		sessions: [{
			state: {
				id: 'configured-session',
				packageId: 'test.configured-package',
				agentId: configuredAgentId,
				type: 'test.configured-session',
				createdAt: 1,
				title: 'Configured Session',
				archived: false,
				lifecycle: 'released',
				status: 'completed',
				isRead: true,
				modifiedAt: 1,
				capabilities: {
					supportsCreateChat: false,
					maximumChatCount: 0,
					supportsFork: false,
					supportsRename: false,
					supportsArchive: false,
					supportsDelete: false,
					supportsChanges: false,
					supportsModels: false,
				},
				changes: [],
				chats: [],
			},
			chats: [],
		}],
		backingRemovalOperations: [],
		completedMigrations: [],
	};
}

suite('Agent Host application storage', () => {
	test('catalog commits require exact monotonic revisions', async () => {
		const storage = await createStorage();
		try {
			const store = new ApplicationStorageAgentHostCatalogStore(storage);
			const initial = createEmptyAgentHostCatalog([]);
			await store.commit(undefined, initial);
			assert.deepEqual(await store.read(), initial);

			const next = { ...initial, revision: 1 };
			await store.commit(0, next);
			assert.deepEqual(await store.read(), next);

			await assert.rejects(
				store.commit(0, { ...next, revision: 1 }),
				/storage revision conflict/,
			);
			await assert.rejects(
				store.commit(1, { ...next, revision: 3 }),
				/requires revision 2/,
			);
		} finally {
			storage.dispose();
		}
	});

	test('round trips exact Agent-default configuration and rejects unknown values and fields atomically', async () => {
		const storage = await createStorage();
		try {
			const store = new ApplicationStorageAgentHostCatalogStore(storage);
			const initial = createEmptyAgentHostCatalog([agentDefaults]);
			await store.commit(undefined, initial);
			assert.deepEqual(await store.read(), initial);

			const invalidConfiguration = {
				...agentDefaults,
				values: { ...agentDefaults.values, 'test.configured-agent.unknown': true },
			};
			await assert.rejects(
				store.commit(0, {
					...initial,
					revision: 1,
					agentDefaults: [invalidConfiguration],
				}),
				error => error instanceof AgentHostError && error.code === AgentHostErrorCode.InvalidConfigurationValue,
			);
			await assert.rejects(
				store.commit(0, {
					...initial,
					revision: 1,
					agentDefaults: [{ ...agentDefaults, unknownField: true } as unknown as typeof agentDefaults],
				}),
				error => error instanceof AgentHostError && error.code === AgentHostErrorCode.InvalidConfigurationValue,
			);
			assert.deepEqual(await store.read(), initial);
		} finally {
			storage.dispose();
		}
	});

	test('rejects a non-terminal or malformed Session configuration finalization outcome atomically', async () => {
		const storage = await createStorage();
		try {
			const store = new ApplicationStorageAgentHostCatalogStore(storage);
			const initial = createEmptyAgentHostCatalog([agentDefaults]);
			await store.commit(undefined, initial);
			const finalization = Object.freeze({
				operation: createAgentHostOperationId('test-configuration-finalization'),
				digest: createAgentHostPayloadDigest(`sha256:${'f'.repeat(64)}`),
				connection: createAgentHostClientConnectionId('test-configuration-owner'),
				status: 'acknowledged' as const,
				outcome: Object.freeze({
					kind: 'failed' as const,
					failure: Object.freeze({
						code: 'invalidState' as const,
						message: 'Configuration finalization remains uncertain',
						reconciliation: 'sameOperationRequired' as const,
					}),
				}),
			});
			await assert.rejects(
				store.commit(0, {
					...initial,
					revision: 1,
					sessionConfigurationFinalizations: [finalization],
				}),
				/Invalid failed Agent Host Session configuration finalization outcome/,
			);
			await assert.rejects(
				store.commit(0, {
					...initial,
					revision: 1,
					sessionConfigurationFinalizations: [{
						...finalization,
						outcome: Object.freeze({
							kind: 'failed' as const,
							failure: Object.freeze({
								...finalization.outcome.failure,
								reconciliation: 'terminal' as const,
							}),
						}),
						unknownField: true,
					} as unknown as typeof finalization],
				}),
				/Invalid Agent Host Session configuration finalization/,
			);
			await assert.rejects(
				store.commit(0, {
					...initial,
					revision: 1,
					sessionConfigurationFinalizations: [Object.freeze({
						operation: finalization.operation,
						digest: finalization.digest,
						connection: finalization.connection,
						status: 'acknowledged' as const,
						outcome: Object.freeze({
							kind: 'succeeded' as const,
							result: Object.freeze({
								kind: 'updateSessionConfiguration' as const,
								operation: finalization.operation,
								digest: finalization.digest,
								hostSequence: createAgentHostSequence(1),
								revisions: Object.freeze([]),
								session: createAgentSessionId('test-future-configuration-session'),
								configuration: sessionConfiguration.revision,
							}),
						}),
					})],
				}),
				/future Host sequence/,
			);
			const sessionsChannel = getAgentHostSessionsChannelId();
			await assert.rejects(
				store.commit(0, {
					...initial,
					revision: 1,
					sessionConfigurationFinalizations: [Object.freeze({
						operation: finalization.operation,
						digest: finalization.digest,
						connection: finalization.connection,
						status: 'acknowledged' as const,
						outcome: Object.freeze({
							kind: 'succeeded' as const,
							result: Object.freeze({
								kind: 'updateSessionConfiguration' as const,
								operation: finalization.operation,
								digest: finalization.digest,
								hostSequence: createAgentHostSequence(0),
								revisions: Object.freeze([Object.freeze({
									channel: sessionsChannel,
									revision: createAgentHostChannelRevision(initial.channelRevisions[sessionsChannel]),
								})]),
								session: createAgentSessionId('test-partial-configuration-session'),
								configuration: sessionConfiguration.revision,
							}),
						}),
					})],
				}),
				/incomplete channel revision vector/,
			);
			await assert.rejects(
				store.commit(0, {
					...initial,
					revision: 1,
					sessionConfigurationFinalizations: Array.from(
						{ length: maximumRetainedAgentHostSessionConfigurationFinalizations + 1 },
						() => finalization,
					),
				}),
				/Invalid Agent Host catalog header/,
			);
			assert.deepEqual(await store.read(), initial);
		} finally {
			storage.dispose();
		}
	});

	test('migrates the exact v1 catalog to v3 with composition-provided configuration', async () => {
		const storage = await createStorage();
		try {
			const legacyCatalog = createLegacyAgentHostCatalog(4);
			await storage.set(agentHostCatalogStorageKeyV1, JSON.stringify(legacyCatalog));
			const store = new ApplicationStorageAgentHostCatalogStore(storage, catalogMigration);
			const expected = {
				...legacyCatalog,
				schemaVersion: 2 as const,
				packageCatalogRevision: 0,
				agentDefaults: [agentDefaults],
				backingRemovalOperations: [],
				sessionConfigurationFinalizations: [],
			};

			assert.deepEqual(await store.read(), expected);
			assert.equal(storage.get(agentHostCatalogStorageKeyV1), undefined);
			assert.deepEqual(JSON.parse(storage.get(agentHostCatalogStorageKey)!), expected);

			await store.commit(4, { ...expected, revision: 5 });
			assert.equal((await store.read())?.revision, 5);
		} finally {
			storage.dispose();
		}
	});

	test('migrates v2 Session records to v3 without inventing configuration', async () => {
		const storage = await createStorage();
		try {
			const v2 = createAgentHostCatalogV2(6);
			await storage.set(agentHostCatalogStorageKeyV2, JSON.stringify(v2));
			const store = new ApplicationStorageAgentHostCatalogStore(storage, catalogMigration);
			const migrated = await store.read();
			assert.equal(migrated?.schemaVersion, 2);
			assert.deepEqual(migrated?.agentDefaults, [agentDefaults]);
			assert.deepEqual(migrated?.sessions[0].state.configuration, sessionConfiguration);
			assert.deepEqual(migrated?.sessionConfigurationFinalizations, []);
			assert.equal(storage.get(agentHostCatalogStorageKeyV2), undefined);
			assert.ok(storage.get(agentHostCatalogStorageKey));
		} finally {
			storage.dispose();
		}
	});

	test('migrates the exact package-ledger catalog shape from the v1 key', async () => {
		const storage = await createStorage();
		try {
			const source = createAgentHostCatalogV2(7);
			await storage.set(agentHostCatalogStorageKeyV1, JSON.stringify(source));
			const migrated = await new ApplicationStorageAgentHostCatalogStore(storage, catalogMigration).read();
			assert.equal(migrated?.revision, source.revision);
			assert.equal(migrated?.packageCatalogRevision, source.packageCatalogRevision);
			assert.deepEqual(migrated?.backingRemovalOperations, source.backingRemovalOperations);
			assert.deepEqual(migrated?.agentDefaults, [agentDefaults]);
			assert.deepEqual(migrated?.sessions[0].state.configuration, sessionConfiguration);
			assert.deepEqual(migrated?.sessionConfigurationFinalizations, []);
			assert.equal(storage.get(agentHostCatalogStorageKeyV1), undefined);
			assert.ok(storage.get(agentHostCatalogStorageKey));
		} finally {
			storage.dispose();
		}
	});

	test('keeps a current v3 catalog authoritative when stale v1 cleanup was interrupted', async () => {
		const storage = await createStorage();
		try {
			const stale = createLegacyAgentHostCatalog(3);
			const current = { ...createEmptyAgentHostCatalog([]), revision: 8, packageCatalogRevision: 6 };
			await storage.set(agentHostCatalogStorageKeyV1, JSON.stringify(stale));
			await storage.set(agentHostCatalogStorageKey, JSON.stringify(current));

			assert.deepEqual(await new ApplicationStorageAgentHostCatalogStore(storage).read(), current);
			assert.equal(storage.get(agentHostCatalogStorageKeyV1), undefined);
		} finally {
			storage.dispose();
		}
	});

	test('rejects a malformed v1 catalog without writing v3 or deleting the source', async () => {
		const storage = await createStorage();
		try {
			const invalid = { ...createLegacyAgentHostCatalog(2), unexpected: true };
			await storage.set(agentHostCatalogStorageKeyV1, JSON.stringify(invalid));

			await assert.rejects(
				new ApplicationStorageAgentHostCatalogStore(storage, catalogMigration).read(),
				/Invalid Agent Host catalog fields/,
			);
			assert.equal(storage.get(agentHostCatalogStorageKeyV1), JSON.stringify(invalid));
			assert.equal(storage.get(agentHostCatalogStorageKey), undefined);
		} finally {
			storage.dispose();
		}
	});

	test('concurrent package commits have one exact winner', async () => {
		const storage = await createStorage();
		try {
			const store = new ApplicationStorageAgentPackageStateStore(storage);
			await store.commit(undefined, createPackageState(0));
			const results = await Promise.allSettled([
				store.commit(0, createPackageState(1)),
				store.commit(0, createPackageState(1)),
			]);
			assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
			assert.equal((await store.read())?.revision, 1);
		} finally {
			storage.dispose();
		}
	});

	test('migrates the exact v1 package state to v3 before continuing its CAS revision', async () => {
		const storage = await createStorage();
		try {
			const legacyState = createLegacyPackageState(4);
			await storage.set(agentPackageStateStorageKeyV1, JSON.stringify(legacyState));
			const store = new ApplicationStorageAgentPackageStateStore(storage);
			const expected = {
				...legacyState,
				catalogRevision: 4,
				operations: [],
			};

			assert.deepEqual(await store.read(), expected);
			assert.equal(storage.get(agentPackageStateStorageKeyV1), undefined);
			assert.deepEqual(JSON.parse(storage.get(agentPackageStateStorageKey)!), expected);

			await store.commit(4, createPackageState(5));
			assert.equal((await store.read())?.revision, 5);
		} finally {
			storage.dispose();
		}
	});

	test('migrates an exact v2 package state without rewriting its revisions', async () => {
		const storage = await createStorage();
		try {
			const state = {
				...createPackageState(8),
				catalogRevision: 5,
			};
			await storage.set(agentPackageStateStorageKeyV2, JSON.stringify(state));

			assert.deepEqual(await new ApplicationStorageAgentPackageStateStore(storage).read(), state);
			assert.equal(storage.get(agentPackageStateStorageKeyV2), undefined);
			assert.deepEqual(JSON.parse(storage.get(agentPackageStateStorageKey)!), state);
		} finally {
			storage.dispose();
		}
	});

	test('migrates the exact package-ledger state shape from the v1 key', async () => {
		const storage = await createStorage();
		try {
			const state = {
				...createPackageState(8),
				catalogRevision: 5,
			};
			await storage.set(agentPackageStateStorageKeyV1, JSON.stringify(state));

			assert.deepEqual(await new ApplicationStorageAgentPackageStateStore(storage).read(), state);
			assert.equal(storage.get(agentPackageStateStorageKeyV1), undefined);
			assert.deepEqual(JSON.parse(storage.get(agentPackageStateStorageKey)!), state);
		} finally {
			storage.dispose();
		}
	});

	test('migrates every v2 registration in active state and operation transitions', async () => {
		const storage = await createStorage();
		try {
			const operation = {
				status: 'pending',
				phase: 'runtimePrepared',
				runtimeTransition: {
					previous: {
						installedPackage: { packageId: registrationV2.packageId },
						registrations: [registrationV2],
					},
					next: null,
				},
			};
			const v2 = {
				...createPackageState(7),
				operations: [operation],
				activeRegistrations: [registrationV2],
			};
			await storage.set(agentPackageStateStorageKeyV2, JSON.stringify(v2));
			const migrated = await new ApplicationStorageAgentPackageStateStore(storage, packageMigration).read();
			assert.deepEqual(migrated?.activeRegistrations, [registrationV3]);
			assert.deepEqual(
				(migrated?.operations[0] as unknown as typeof operation).runtimeTransition.previous?.registrations,
				[registrationV3],
			);
			assert.equal(storage.get(agentPackageStateStorageKeyV2), undefined);
		} finally {
			storage.dispose();
		}
	});

	test('rejects an undeclared v2 registration without changing either storage key', async () => {
		const storage = await createStorage();
		try {
			const v2 = { ...createPackageState(2), activeRegistrations: [registrationV2] };
			await storage.set(agentPackageStateStorageKeyV2, JSON.stringify(v2));
			await assert.rejects(
				new ApplicationStorageAgentPackageStateStore(storage).read(),
				/not declared/,
			);
			assert.equal(storage.get(agentPackageStateStorageKeyV2), JSON.stringify(v2));
			assert.equal(storage.get(agentPackageStateStorageKey), undefined);
		} finally {
			storage.dispose();
		}
	});

	test('keeps v3 authoritative and removes stale v2 and v1 sources after interrupted cleanup', async () => {
		const storage = await createStorage();
		try {
			const stale = createLegacyPackageState(3);
			const current = {
				...createPackageState(9),
				catalogRevision: 7,
			};
			await storage.set(agentPackageStateStorageKeyV1, JSON.stringify(stale));
			await storage.set(agentPackageStateStorageKeyV2, JSON.stringify(createPackageState(4)));
			await storage.set(agentPackageStateStorageKey, JSON.stringify(current));

			assert.deepEqual(await new ApplicationStorageAgentPackageStateStore(storage).read(), current);
			assert.equal(storage.get(agentPackageStateStorageKeyV1), undefined);
			assert.equal(storage.get(agentPackageStateStorageKeyV2), undefined);
			assert.deepEqual(JSON.parse(storage.get(agentPackageStateStorageKey)!), current);
		} finally {
			storage.dispose();
		}
	});

	test('rejects a malformed v1 source without writing v3 or deleting the source', async () => {
		const storage = await createStorage();
		try {
			const invalid = {
				...createLegacyPackageState(2),
				unexpected: true,
			};
			await storage.set(agentPackageStateStorageKeyV1, JSON.stringify(invalid));

			await assert.rejects(
				new ApplicationStorageAgentPackageStateStore(storage).read(),
				/Invalid Agent package persisted state fields/,
			);
			assert.equal(storage.get(agentPackageStateStorageKeyV1), JSON.stringify(invalid));
			assert.equal(storage.get(agentPackageStateStorageKey), undefined);
		} finally {
			storage.dispose();
		}
	});

	test('invalid persisted state fails closed', async () => {
		const storage = await createStorage();
		try {
			await storage.set(agentHostCatalogStorageKey, '{');
			await assert.rejects(
				new ApplicationStorageAgentHostCatalogStore(storage).read(),
				/Invalid JSON/,
			);

			const missingAgentDefaults = {
				...createLegacyAgentHostCatalog(0),
				packageCatalogRevision: 0,
				backingRemovalOperations: [],
			};
			await storage.set(agentHostCatalogStorageKey, JSON.stringify(missingAgentDefaults));
			await assert.rejects(
				new ApplicationStorageAgentHostCatalogStore(storage).read(),
				/Invalid Agent Host catalog fields/,
			);

			await storage.set(agentPackageStateStorageKey, JSON.stringify({
				...createPackageState(0),
				revision: -1,
			}));
			await assert.rejects(
				new ApplicationStorageAgentPackageStateStore(storage).read(),
				/Invalid revision/,
			);
		} finally {
			storage.dispose();
		}
	});

	test('legacy source owns only the exact one-shot migration key', async () => {
		const storage = await createStorage();
		try {
			const source = new ApplicationStorageLegacyAgentHostCatalogSource(storage);
			await storage.set('sessions.providers.default', '{"version":3}');
			assert.equal(await source.read('sessions.providers.default'), '{"version":3}');
			await source.delete('sessions.providers.default');
			assert.equal(await source.read('sessions.providers.default'), undefined);
		} finally {
			storage.dispose();
		}
	});
});
