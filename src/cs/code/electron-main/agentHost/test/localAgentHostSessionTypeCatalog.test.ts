/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	getMockAgentPackageDefinition,
	mockAgentPackageIds,
} from 'cs/code/common/agentHost/test/mockAgentPackages';
import { LocalAgentHostSessionTypeCatalog } from 'cs/code/electron-main/agentHost/localAgentHostSessionTypeCatalog';
import { createAgentRuntimeRegistrationRevision } from 'cs/platform/agentHost/common/identities';

test('LocalAgentHostSessionTypeCatalog rejects a runtime registration outside the product contract', () => {
	const definition = getMockAgentPackageDefinition(mockAgentPackageIds[0]);
	const catalog = new LocalAgentHostSessionTypeCatalog([{
		packageId: definition.packageId,
		agentId: definition.agentId,
		resolveRuntimeRegistrationRevision: () => definition.registration.revision,
		resolve: () => definition.sessionType,
	}]);

	assert.throws(() => catalog.resolve([{
		registration: {
			...definition.registration,
			revision: createAgentRuntimeRegistrationRevision('unexpected.runtime.v1'),
		},
		descriptor: definition.descriptor,
	}]), /outside its product contract/);
});
