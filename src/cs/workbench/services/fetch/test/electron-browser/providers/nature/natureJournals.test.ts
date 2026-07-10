/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { natureJournals } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureJournals';

test('Nature journals register the supported discovery entry points', () => {
	const natureSourceUrls = [
		'https://www.nature.com/latest-news',
		'https://www.nature.com/nature/research-articles',
		'https://www.nature.com/ncomms/research-articles',
		'https://www.nature.com/opinion',
	].sort();
	const discoveryUrls = natureJournals
		.map(journal => journal.discoveryUrl.toString(true))
		.filter(url => natureSourceUrls.includes(url))
		.sort();

	assert.deepEqual(discoveryUrls, natureSourceUrls);
});
