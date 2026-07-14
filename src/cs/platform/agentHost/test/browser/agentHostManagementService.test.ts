/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Emitter } from 'cs/base/common/event';
import {
	AgentHostManagementService,
	type IAgentHostManagementTarget,
} from 'cs/platform/agentHost/browser/agentHostManagementService';
import {
	createAgentConfigurationPropertyId,
	createAgentHostAuthorityId,
	createAgentId,
	createAgentPackageId,
} from 'cs/platform/agentHost/common/identities';

test('AgentHostManagementService publishes targets and delegates exact management operations', async () => {
	const service = new AgentHostManagementService();
	const authority = createAgentHostAuthorityId('management.test');
	const agentId = createAgentId('management-agent');
	const packageId = createAgentPackageId('management-package');
	const propertyId = createAgentConfigurationPropertyId('management.value');
	const operations: string[] = [];
	const emitter = new Emitter<void>();
	const target: IAgentHostManagementTarget = {
		authority,
		onDidChangeManagementState: emitter.event,
		getManagementSnapshot: () => Object.freeze({
			authority,
			label: 'Management test',
			packages: Object.freeze({
				revision: 0,
				installablePackages: Object.freeze([]),
				installedPackages: Object.freeze([]),
				activations: Object.freeze([]),
				retainedBackingRecords: Object.freeze([]),
				materializedBackings: Object.freeze([]),
			}),
			supportsPackageOperations: true,
			agents: Object.freeze([]),
			agentDefaults: Object.freeze([]),
			pendingPackages: Object.freeze([]),
			pendingConfigurations: Object.freeze([]),
		}),
		installPackage: async id => { operations.push(`install:${id}`); },
		uninstallPackage: async id => { operations.push(`uninstall:${id}`); },
		updateAgentDefault: async (agent, property, value) => {
			operations.push(`update:${agent}:${property}:${String(value)}`);
		},
		removeAgentDefault: async (agent, property) => {
			operations.push(`remove:${agent}:${property}`);
		},
		resetAgentDefaults: async agent => { operations.push(`reset:${agent}`); },
	};

	let changeCount = 0;
	const changeListener = service.onDidChange(() => { changeCount += 1; });
	const registration = service.registerTarget(target);
	assert.deepEqual(service.getSnapshot().targets.map(candidate => candidate.authority), [authority]);
	await service.installPackage(authority, packageId);
	await service.uninstallPackage(authority, packageId);
	await service.updateAgentDefault(authority, agentId, propertyId, true);
	await service.removeAgentDefault(authority, agentId, propertyId);
	await service.resetAgentDefaults(authority, agentId);
	assert.deepEqual(operations, [
		`install:${packageId}`,
		`uninstall:${packageId}`,
		`update:${agentId}:${propertyId}:true`,
		`remove:${agentId}:${propertyId}`,
		`reset:${agentId}`,
	]);
	emitter.fire();
	assert.equal(changeCount, 2);
	registration.dispose();
	assert.deepEqual(service.getSnapshot().targets, []);
	assert.equal(changeCount, 3);
	assert.throws(() => service.installPackage(authority, packageId), /unavailable/);

	changeListener.dispose();
	emitter.dispose();
	service.dispose();
});

test('AgentHostManagementService rejects duplicate authorities', () => {
	const service = new AgentHostManagementService();
	const authority = createAgentHostAuthorityId('management.duplicate');
	const emitter = new Emitter<void>();
	const target = {
		authority,
		onDidChangeManagementState: emitter.event,
		getManagementSnapshot: () => ({
			authority,
			label: 'Duplicate',
			packages: {
				revision: 0,
				installablePackages: [],
				installedPackages: [],
				activations: [],
				retainedBackingRecords: [],
				materializedBackings: [],
			},
			supportsPackageOperations: true,
			agents: [],
			agentDefaults: [],
			pendingPackages: [],
			pendingConfigurations: [],
		}),
		installPackage: async () => {},
		uninstallPackage: async () => {},
		updateAgentDefault: async () => {},
		removeAgentDefault: async () => {},
		resetAgentDefaults: async () => {},
	} satisfies IAgentHostManagementTarget;
	const registration = service.registerTarget(target);
	assert.throws(() => service.registerTarget(target), /already registered/);
	registration.dispose();
	emitter.dispose();
	service.dispose();
});
