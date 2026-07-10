/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDefaultBatchSources } from 'cs/platform/configuration/common/defaultBatchSources';
import { natureJournals } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureJournals';

test('Nature journals register every default Nature batch source as a discovery entry point', () => {
	const natureSourceUrls = getDefaultBatchSources()
		.map(source => source.url)
		.filter(url => new URL(url).hostname === 'www.nature.com')
		.sort();
	const discoveryUrls = natureJournals
		.map(journal => journal.discoveryUrl.toString(true))
		.sort();

	assert.deepEqual(discoveryUrls, natureSourceUrls);
});
