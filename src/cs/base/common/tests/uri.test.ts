/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { URI } from 'cs/base/common/uri';
import { createURITransformer } from 'cs/base/common/uriTransformer';
import { transformAndReviveIncomingURIs } from 'cs/base/common/uriIpc';
import { UriTemplate } from 'cs/base/common/uriTemplate';

test('URI parses, formats, and revives file resources', () => {
	const resource = URI.file('/tmp/c#code/file name.txt');

	assert.equal(resource.scheme, 'file');
	assert.equal(resource.path, '/tmp/c#code/file name.txt');
	assert.equal(resource.toString(), 'file:///tmp/c%23code/file%20name.txt');
	assert.equal(URI.revive(resource.toJSON()).toString(), resource.toString());
});

test('URI.from validates trusted and strict components', () => {
	assert.equal(URI.from({ scheme: '', path: '/tmp/file.txt' }).scheme, 'file');
	assert.throws(() => URI.from({ scheme: '', path: '/tmp/file.txt' }, true), /Scheme is missing/);
});

test('URI.joinPath normalizes path fragments', () => {
	const resource = URI.joinPath(URI.file('/tmp/workspace/src'), '../test/file.ts');

	assert.equal(resource.path, '/tmp/workspace/test/file.ts');
	assert.equal(resource.toString(), 'file:///tmp/workspace/test/file.ts');
});

test('URI transformer maps remote and local file schemes', () => {
	const transformer = createURITransformer('ssh-remote+host');

	assert.deepEqual(transformer.transformOutgoing(URI.file('/workspace/file.ts').toJSON()), {
		$mid: 1,
		scheme: 'vscode-remote',
		authority: 'ssh-remote+host',
		path: '/workspace/file.ts'
	});

	const revived = transformAndReviveIncomingURIs<{ resource: unknown }>({
		resource: {
			$mid: 1,
			scheme: 'vscode-remote',
			authority: 'ssh-remote+host',
			path: '/workspace/file.ts'
		}
	}, transformer);

	assert.ok(URI.isUri(revived.resource));
	assert.equal(revived.resource.scheme, 'file');
	assert.equal(revived.resource.path, '/workspace/file.ts');
});

test('UriTemplate expands path and query variables', () => {
	const template = UriTemplate.parse('/repos/{owner}/{repo}/contents{/segments*}{?ref}');

	assert.equal(
		template.resolve({
			owner: 'microsoft',
			repo: 'vscode',
			segments: ['src', 'vs base'],
			ref: 'main'
		}),
		'/repos/microsoft/vscode/contents/src/vs%20base?ref=main'
	);
});
