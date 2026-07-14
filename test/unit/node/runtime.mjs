/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const nodeUnitTestRunner = 'test/unit/node/index.mjs';
export const nodeUnitTestOutput = '.tmp/unit/node';

export const nodeUnitTestBuild = Object.freeze({
	format: 'esm',
	target: 'node24',
	sourcemap: 'inline',
	external: Object.freeze([
		'cheerio',
		'esbuild',
		'jsdom',
		'node:assert/strict',
		'node:sqlite',
		'node:test',
		'playwright-core',
		'typescript',
	]),
	loader: Object.freeze({
		'.css': 'empty',
		'.html': 'text',
		'.svg': 'text',
	}),
});

function toPosixPath(filePath) {
	return filePath.replaceAll('\\', '/');
}

export function createNodeTestArguments(outputDirectory, coverageFile, rootDir = process.cwd()) {
	const args = [
		'--import',
		pathToFileURL(path.resolve(rootDir, 'test/unit/node/jsdom-bootstrap.mjs')).href,
		'--test',
		'--test-concurrency=1',
	];

	if (coverageFile) {
		args.push(
			'--enable-source-maps',
			'--experimental-test-coverage',
			'--test-reporter=spec',
			'--test-reporter-destination=stdout',
			'--test-reporter=lcov',
			`--test-reporter-destination=${coverageFile}`,
		);
	} else {
		args.push('--test-reporter=spec');
	}

	args.push(
		toPosixPath(path.join(outputDirectory, '**', '*.test.js')),
		toPosixPath(path.join(outputDirectory, '**', '*.integrationTest.js')),
	);
	return args;
}
