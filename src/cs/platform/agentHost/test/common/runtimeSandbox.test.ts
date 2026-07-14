/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	createAgentId,
	createAgentPackageContentDigest,
	createAgentPackageId,
	createAgentPackageRevision,
} from 'cs/platform/agentHost/common/identities';
import type { IInstalledAgentPackage } from 'cs/platform/agentHost/common/packages';
import {
	createAgentRuntimeSandboxAuthority,
	isEqualAgentRuntimeSandboxAuthority,
} from 'cs/platform/agentHost/common/runtimeSandbox';

const processAuthority = 'electron.utilityProcess';

function installedPackage(): IInstalledAgentPackage {
	const packageId = createAgentPackageId('test.connected');
	const revision = createAgentPackageRevision('test.connected.v1');
	const digest = createAgentPackageContentDigest(`sha256:${'a'.repeat(64)}`);
	const source = 'file:///product/test-connected-runtime.js';
	const privilege = Object.freeze({ kind: 'process' as const, value: processAuthority });
	const dependency = Object.freeze({
		id: 'test.connected.runtime',
		source,
		target: 'runtime/main.js',
		digest,
		license: 'MIT',
	});
	return Object.freeze({
		packageId,
		revision,
		contentDigest: digest,
		source,
		distribution: 'user',
		manifest: Object.freeze({
			schema: 1,
			packageId,
			revision,
			contentDigest: digest,
			publisher: 'Test',
			target: Object.freeze({ operatingSystem: 'test', architecture: 'x64' }),
			runtimeForm: 'connected',
			runtimeEntryPoint: dependency.target,
			agentIds: Object.freeze([createAgentId('test.connected')]),
			dependencies: Object.freeze([dependency]),
			privileges: Object.freeze([privilege]),
		}),
		dependencyClosure: Object.freeze([Object.freeze({
			...dependency,
			verifiedDigest: digest,
			immutable: true,
		})]),
		grantedPrivileges: Object.freeze([privilege]),
	});
}

suite('AgentRuntimeSandboxAuthority', () => {
	test('derives an exact deny-by-default authority from the verified installed record', () => {
		const installed = installedPackage();
		const authority = createAgentRuntimeSandboxAuthority(
			installed,
			processAuthority,
		);
		assert.deepStrictEqual(authority, {
			packageId: installed.packageId,
			packageRevision: installed.revision,
			packageContentDigest: installed.contentDigest,
			packageSource: installed.source,
			target: { operatingSystem: 'test', architecture: 'x64' },
			runtimeEntryPoint: installed.manifest.runtimeEntryPoint,
			artifacts: installed.dependencyClosure,
			process: processAuthority,
			filesystem: [],
			network: [],
			secret: [],
			toolExecutor: [],
		});
	});

	test('rejects package, digest, artifact, and privilege authority drift', () => {
		const installed = installedPackage();
		assert.throws(() => createAgentRuntimeSandboxAuthority(Object.freeze({
			...installed,
			revision: `${installed.revision}.changed` as typeof installed.revision,
		}), processAuthority), /package identity is invalid/);
		assert.throws(() => createAgentRuntimeSandboxAuthority(Object.freeze({
			...installed,
			contentDigest: createAgentPackageContentDigest(`sha256:${'b'.repeat(64)}`),
		}), processAuthority), /package identity is invalid/);
		assert.throws(() => createAgentRuntimeSandboxAuthority(Object.freeze({
			...installed,
			dependencyClosure: Object.freeze([Object.freeze({
				...installed.dependencyClosure[0],
				verifiedDigest: createAgentPackageContentDigest(`sha256:${'b'.repeat(64)}`),
			})]),
		}), processAuthority), /artifact authority/);
		assert.throws(() => createAgentRuntimeSandboxAuthority(Object.freeze({
			...installed,
			grantedPrivileges: Object.freeze([]),
		}), processAuthority), /grants do not match/);
		assert.throws(() => createAgentRuntimeSandboxAuthority(Object.freeze({
			...installed,
			manifest: Object.freeze({
				...installed.manifest,
				privileges: Object.freeze([
					...installed.manifest.privileges,
					Object.freeze({ kind: 'network' as const, value: 'provider.example.test' }),
				]),
			}),
			grantedPrivileges: Object.freeze([
				...installed.grantedPrivileges,
				Object.freeze({ kind: 'network' as const, value: 'another.example.test' }),
			]),
		}), processAuthority), /grants do not match/);
	});

	test('makes every granted authority axis explicit and detects launch-policy drift', () => {
		const installed = installedPackage();
		const privileges = Object.freeze([
			...installed.grantedPrivileges,
			Object.freeze({ kind: 'filesystem' as const, value: 'workspace:read' }),
			Object.freeze({ kind: 'network' as const, value: 'provider.example.test' }),
			Object.freeze({ kind: 'secret' as const, value: 'provider.api-key' }),
			Object.freeze({ kind: 'toolExecutor' as const, value: 'agentHost.canonical' }),
		]);
		const authorized = Object.freeze({
			...installed,
			manifest: Object.freeze({ ...installed.manifest, privileges }),
			grantedPrivileges: privileges,
		});
		const authority = createAgentRuntimeSandboxAuthority(
			authorized,
			processAuthority,
		);
		assert.deepStrictEqual({
			filesystem: authority.filesystem,
			network: authority.network,
			secret: authority.secret,
			toolExecutor: authority.toolExecutor,
		}, {
			filesystem: ['workspace:read'],
			network: ['provider.example.test'],
			secret: ['provider.api-key'],
			toolExecutor: ['agentHost.canonical'],
		});
		assert.equal(isEqualAgentRuntimeSandboxAuthority(authority, authority), true);
		assert.equal(isEqualAgentRuntimeSandboxAuthority(authority, Object.freeze({
			...authority,
			network: Object.freeze(['other.example.test']),
		})), false);
	});
});
