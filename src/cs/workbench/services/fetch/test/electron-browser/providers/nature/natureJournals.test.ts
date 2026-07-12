/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { natureJournals } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureJournals';

test('Nature journals discover runtime Article types from journal roots', () => {
	assert.equal(natureJournals[0]?.discoveryUrl.toString(true), 'https://www.nature.com/latest-news');
	assert.equal(natureJournals[1]?.discoveryUrl.toString(true), 'https://www.nature.com/opinion');
	for (const journal of natureJournals.slice(2)) {
		assert.equal(journal.discoveryUrl.path.endsWith('/articles'), true);
		assert.doesNotMatch(journal.discoveryUrl.path, /research-articles|reviews-and-analysis/);
	}
});
