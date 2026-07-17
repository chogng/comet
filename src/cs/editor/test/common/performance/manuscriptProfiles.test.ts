/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import {
	manuscriptPerformanceProfileId,
	manuscriptPerformanceProfiles,
} from 'cs/editor/test/common/performance/manuscriptProfiles';

suite('Manuscript performance profiles', () => {
	test('keeps one immutable, strictly increasing S/M/L scale', () => {
		assert.match(manuscriptPerformanceProfileId, /^comet-manuscript-performance-\d+$/u);
		assert.equal(Object.isFrozen(manuscriptPerformanceProfiles), true);

		const profiles = Object.values(manuscriptPerformanceProfiles);
		assert.deepEqual(profiles.map(profile => profile.name), ['S', 'M', 'L']);

		for (const profile of profiles) {
			assert.equal(Object.isFrozen(profile), true);
			assert.equal(Number.isSafeInteger(profile.wordCount), true);
			assert.equal(Number.isSafeInteger(profile.nodeCount), true);
			assert.equal(Number.isSafeInteger(profile.citationCount), true);
			assert.ok(profile.wordCount > 0);
			assert.ok(profile.nodeCount > 0);
			assert.ok(profile.citationCount > 0);
		}

		for (let index = 1; index < profiles.length; index += 1) {
			const previous = profiles[index - 1];
			const current = profiles[index];
			assert.ok(previous !== undefined);
			assert.ok(current !== undefined);
			assert.ok(current.wordCount > previous.wordCount);
			assert.ok(current.nodeCount > previous.nodeCount);
			assert.ok(current.citationCount > previous.citationCount);
		}
	});
});
