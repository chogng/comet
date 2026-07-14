/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';

import {
	discoverProjectTestFiles,
	selectTestFiles,
} from '../test-discovery.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = path.resolve(repositoryRoot, '.tmp/unit/browser');
const sharedDirectory = path.resolve(repositoryRoot, 'test/unit/shared');

function usage() {
	return [
		'Usage: node test/unit/browser/index.mjs [options]',
		'',
		'Options:',
		'  --run <file>    Run one discovered browser test source; may be repeated',
		'  --glob <glob>   Run discovered browser test sources matching a glob; may be repeated',
		'  --help          Show this help',
	].join('\n');
}

function parseArguments(args) {
	const selection = { runFiles: [], globs: [] };
	let help = false;
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === '--help') {
			help = true;
			continue;
		}
		if (argument !== '--run' && argument !== '--glob') {
			throw new Error(`Unknown browser unit option: ${argument}\n\n${usage()}`);
		}
		const value = args[++index];
		if (!value || value.startsWith('--')) {
			throw new Error(`Missing value for ${argument}\n\n${usage()}`);
		}
		selection[argument === '--run' ? 'runFiles' : 'globs'].push(value);
	}
	return { help, selection };
}

async function buildTests(testFiles) {
	await rm(outputDirectory, { recursive: true, force: true });
	await mkdir(outputDirectory, { recursive: true });
	const runs = [];
	for (const [index, file] of testFiles.entries()) {
		const scriptName = `tests-${index}.js`;
		await build({
			entryPoints: [path.resolve(repositoryRoot, file)],
			outfile: path.join(outputDirectory, scriptName),
			bundle: true,
			format: 'iife',
			platform: 'browser',
			target: 'es2022',
			sourcemap: 'inline',
			alias: {
				'node:assert/strict': path.join(sharedDirectory, 'assert.mjs'),
				'node:test': path.join(sharedDirectory, 'test-api.mjs'),
				'node:timers/promises': path.join(sharedDirectory, 'timers.mjs'),
				'cs/editor/browser/text/tests/domTestUtils': path.join(sharedDirectory, 'browser-dom.mjs'),
			},
			loader: { '.css': 'empty', '.html': 'text', '.svg': 'text' },
		});
		const rendererFile = path.join(outputDirectory, `renderer-${index}.html`);
		const renderer = await readFile(path.join(repositoryRoot, 'test/unit/browser/renderer.html'), 'utf8');
		await writeFile(rendererFile, renderer.replace('./tests.js', `./${scriptName}`), 'utf8');
		runs.push(rendererFile);
	}
	return runs;
}

async function main(args) {
	const { help, selection } = parseArguments(args);
	if (help) {
		console.log(usage());
		return 0;
	}
	if (process.env['COMET_TEST_COVERAGE_FILE']) {
		throw new Error('Browser unit coverage is not part of the Node LCOV collector.');
	}
	const discoveredTests = await discoverProjectTestFiles(repositoryRoot, 'browser');
	const selectedTests = selectTestFiles(discoveredTests, selection, repositoryRoot);
	console.log(`[unit/browser] ${selectedTests.length} test source${selectedTests.length === 1 ? '' : 's'}`);
	const rendererFiles = await buildTests(selectedTests);

	const browser = await chromium.launch({ headless: true });
	try {
		for (const rendererFile of rendererFiles) {
			const page = await browser.newPage();
			await page.goto(pathToFileURL(rendererFile).href);
			await page.waitForFunction(() => globalThis.__cometUnitResult !== undefined);
			const result = await page.evaluate(() => globalThis.__cometUnitResult);
			await page.close();
			if (result.failed > 0) {
				throw new Error(JSON.stringify(result, null, 2));
			}
		}
		return 0;
	} finally {
		await browser.close();
	}
}

const exitCode = await main(process.argv.slice(2));
if (exitCode !== 0) {
	process.exit(exitCode);
}
