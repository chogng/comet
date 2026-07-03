/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Literature Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DataUri,
	basename,
	dirname,
	distinctParents,
	isEqualOrParent,
	joinPath,
	relativePath,
	toLocalResource,
} from 'ls/base/common/resources';
import { URI } from 'ls/base/common/uri';

test('resources computes URI path segments', () => {
	const resource = URI.file('/tmp/workspace/src/file.ts');
	const parent = dirname(resource);
	const sibling = joinPath(parent, '../test/file.test.ts');

	assert.equal(basename(resource), 'file.ts');
	assert.equal(parent.toString(), 'file:///tmp/workspace/src');
	assert.equal(sibling.toString(), 'file:///tmp/workspace/test/file.test.ts');
	assert.equal(relativePath(URI.file('/tmp/workspace'), sibling), 'test/file.test.ts');
});

test('resources compares URI parents', () => {
	const workspace = URI.file('/tmp/workspace');
	const child = URI.file('/tmp/workspace/src/file.ts');
	const other = URI.file('/tmp/other/file.ts');

	assert.equal(isEqualOrParent(child, workspace), true);
	assert.deepEqual(
		distinctParents([workspace, child, other], item => item).map(item => item.toString()),
		['file:///tmp/workspace', 'file:///tmp/other/file.ts'],
	);
});

test('resources parses data URI metadata', () => {
	const metadata = DataUri.parseMetaData(URI.parse('data:image/png;size:2313;label:Preview;description:Cover;base64,abc'));

	assert.equal(metadata.get(DataUri.META_DATA_MIME), 'image/png');
	assert.equal(metadata.get(DataUri.META_DATA_SIZE), '2313');
	assert.equal(metadata.get(DataUri.META_DATA_LABEL), 'Preview');
	assert.equal(metadata.get(DataUri.META_DATA_DESCRIPTION), 'Cover');
});

test('resources converts remote resources to local scheme', () => {
	const remote = URI.parse('vscode-remote://ssh-remote+host/workspace/file.ts');
	const local = toLocalResource(remote, 'local-authority', 'vscode-local');

	assert.equal(local.scheme, 'vscode-local');
	assert.equal(local.authority, 'local-authority');
	assert.equal(local.path, '/workspace/file.ts');
});
