import assert from 'node:assert/strict';
import test from 'node:test';

import {
  prepareBatchSourcesForFetch,
  resolveBatchFetchSources,
} from 'cs/workbench/services/fetch/browser/articleFetch';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';

test('current URL source metadata can be overridden from settings JSON', () => {
  const sourceTable: BatchSource[] = [
    {
      id: 'builtin',
      url: 'https://example.com/latest',
      journalTitle: 'Built-in title',
		fetchTarget: 'background',
    },
    {
      id: 'override-1',
      url: 'https://example.com/latest',
      journalTitle: 'Override title',
		fetchTarget: 'webContentsView',
    },
  ];

  const selectedSources = resolveBatchFetchSources(
    'https://example.com/latest',
    sourceTable,
  );
  const { sources } = prepareBatchSourcesForFetch(selectedSources, sourceTable);

  assert.equal(sources.length, 1);
  assert.equal(sources[0].journalTitle, 'Override title');
	assert.equal(sources[0].fetchTarget, 'webContentsView');
});
