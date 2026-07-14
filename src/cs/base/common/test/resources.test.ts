/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
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
} from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';

test('resources computes URI path segments', () => {
	const resource = URI.parse('test://authority/workspace/src/file.ts');
	const parent = dirname(resource);
	const sibling = joinPath(parent, '../test/file.test.ts');

	assert.equal(basename(resource), 'file.ts');
	assert.equal(parent.toString(), 'test://authority/workspace/src');
	assert.equal(sibling.toString(), 'test://authority/workspace/test/file.test.ts');
	assert.equal(relativePath(URI.parse('test://authority/workspace'), sibling), 'test/file.test.ts');
});

test('resources compares URI parents', () => {
	const workspace = URI.parse('test://authority/workspace');
	const child = URI.parse('test://authority/workspace/src/file.ts');
	const other = URI.parse('test://authority/other/file.ts');

	assert.equal(isEqualOrParent(child, workspace), true);
	assert.deepEqual(
		distinctParents([workspace, child, other], item => item).map(item => item.toString()),
		['test://authority/workspace', 'test://authority/other/file.ts'],
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
