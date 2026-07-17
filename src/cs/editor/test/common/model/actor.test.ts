/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { createTrustedActorRef } from 'cs/editor/common/model/actor';

suite('ActorRef', () => {
	test('creates detached frozen clones of the three exact variants', () => {
		for (const actor of [
			{ type: 'human', id: 'human-1' },
			{ type: 'agent', id: 'agent-1' },
			{
				type: 'system',
				id: 'system-1',
				role: 'validator',
			},
		] as const) {
			const trusted = createTrustedActorRef(actor);
			assert.deepStrictEqual(trusted, actor);
			assert.notEqual(trusted, actor);
			assert.equal(Object.isFrozen(trusted), true);
		}
	});

	test('rejects extra and symbol properties', () => {
		assert.equal(createTrustedActorRef({
			type: 'human',
			id: 'human-1',
			extra: true,
		}), undefined);
		const symbolActor = {
			type: 'human',
			id: 'human-1',
			[Symbol('extra')]: true,
		};
		assert.equal(createTrustedActorRef(symbolActor), undefined);
	});

	test('rejects accessors without invoking getters and handles Proxy failures', () => {
		let getterCalls = 0;
		const accessor = {
			type: 'human',
		};
		Object.defineProperty(accessor, 'id', {
			enumerable: true,
			get() {
				getterCalls += 1;
				return 'human-1';
			},
		});
		assert.equal(createTrustedActorRef(accessor), undefined);
		assert.equal(getterCalls, 0);

		const proxy = new Proxy({
			type: 'human',
			id: 'human-1',
		}, {
			getOwnPropertyDescriptor() {
				throw new Error('inspection failure');
			},
		});
		assert.equal(createTrustedActorRef(proxy), undefined);
	});

	test('rejects invalid Unicode, empty IDs, oversized IDs, and invalid system roles', () => {
		assert.equal(createTrustedActorRef({ type: 'human', id: '' }), undefined);
		assert.equal(createTrustedActorRef({ type: 'human', id: '\ud800' }), undefined);
		assert.equal(createTrustedActorRef({
			type: 'human',
			id: 'x'.repeat(513),
		}), undefined);
		assert.equal(createTrustedActorRef({
			type: 'system',
			id: 'system-1',
			role: 'admin',
		}), undefined);
	});
});
