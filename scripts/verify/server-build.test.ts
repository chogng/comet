/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { builtinModules } from 'node:module';
import path from 'node:path';
import test from 'node:test';

import * as esbuild from 'esbuild';

import { createServerBuildOptions } from '../../build/lib/serverBuild.ts';
import { resolveProjectPath } from '../../build/lib/util.ts';

test('Server composition build bundles the exact Agent Host modules for Node ESM', async () => {
	const expectedEntryPoints = [
		resolveProjectPath('src', 'cs', 'server', 'node', 'agentHost', 'remoteAgentHostMain.ts'),
		resolveProjectPath('src', 'cs', 'server', 'node', 'agentHost', 'remoteTunnelAgentHostMain.ts'),
	];
	const options = await createServerBuildOptions();

	assert.deepStrictEqual(options.entryPoints, expectedEntryPoints);
	assert.deepStrictEqual(options.alias, {
		app: resolveProjectPath('src'),
		base: resolveProjectPath('src', 'cs', 'base'),
		code: resolveProjectPath('src', 'cs', 'code'),
		editor: resolveProjectPath('src', 'cs', 'editor'),
		language: resolveProjectPath('build', 'lib'),
		cs: resolveProjectPath('src', 'cs'),
		platform: resolveProjectPath('src', 'cs', 'platform'),
		workbench: resolveProjectPath('src', 'cs', 'workbench'),
	});
	assert.equal(options.platform, 'node');
	assert.equal(options.format, 'esm');
	assert.equal(options.target, 'node20');
	assert.equal(options.packages, 'external');
	assert.equal(options.outbase, resolveProjectPath('src', 'cs', 'server', 'node', 'agentHost'));
	assert.equal(options.outdir, resolveProjectPath('dist-server'));
	for (const moduleName of builtinModules) {
		assert.ok(options.external?.includes(moduleName));
		assert.ok(options.external?.includes(`node:${moduleName}`));
	}

	const result = await esbuild.build({
		...options,
		logLevel: 'silent',
		metafile: true,
		write: false,
	});
	const bundledEntryPoints = Object.values(result.metafile.outputs)
		.flatMap(output => output.entryPoint === undefined ? [] : [
			path.resolve(resolveProjectPath(), output.entryPoint),
		])
		.sort();
	assert.deepStrictEqual(bundledEntryPoints, expectedEntryPoints.slice().sort());

	assert.ok(result.outputFiles);
	const outputPaths = result.outputFiles
		.map(output => path.relative(resolveProjectPath(), output.path))
		.sort();
	assert.deepStrictEqual(outputPaths, [
		'dist-server/remoteAgentHostMain.js',
		'dist-server/remoteAgentHostMain.js.map',
		'dist-server/remoteTunnelAgentHostMain.js',
		'dist-server/remoteTunnelAgentHostMain.js.map',
	]);
});
