/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRequire } from 'node:module';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import { discoverProjectTestFiles, selectTestFiles, spawnExitCode } from '../test-discovery.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const outputDirectory = path.resolve(repositoryRoot, '.tmp/unit/electron');
const sharedDirectory = path.resolve(repositoryRoot, 'test/unit/shared');
const requireFromRepository = createRequire(import.meta.url);

function usage() {
	return [
		'Usage: node test/unit/electron/index.mjs [options]',
		'',
		'Options:',
		'  --run <file>    Run one discovered Electron test source; may be repeated',
		'  --glob <glob>   Run discovered Electron test sources matching a glob; may be repeated',
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
			throw new Error(`Unknown Electron unit option: ${argument}\n\n${usage()}`);
		}
		const value = args[++index];
		if (!value || value.startsWith('--')) {
			throw new Error(`Missing value for ${argument}\n\n${usage()}`);
		}
		selection[argument === '--run' ? 'runFiles' : 'globs'].push(value);
	}
	return { help, selection };
}

function toPosixPath(filePath) {
	return filePath.replaceAll('\\', '/');
}

async function buildTests(testFiles) {
	await rm(outputDirectory, { recursive: true, force: true });
	await mkdir(outputDirectory, { recursive: true });
	const imports = testFiles
		.map(file => `require(${JSON.stringify(`./${toPosixPath(file)}`)});`)
		.join('\n');
	await build({
		stdin: { contents: imports, resolveDir: repositoryRoot, sourcefile: 'electron-entry.cjs' },
		outfile: path.join(outputDirectory, 'tests.cjs'),
		bundle: true,
		format: 'cjs',
		platform: 'node',
		target: 'node24',
		sourcemap: 'inline',
		alias: {
			'node:assert/strict': path.join(sharedDirectory, 'assert.mjs'),
			'node:test': path.join(sharedDirectory, 'test-api.mjs'),
			'node:timers/promises': path.join(sharedDirectory, 'timers.mjs'),
		},
		loader: { '.css': 'empty', '.html': 'text', '.svg': 'text' },
	});
	await writeFile(
		path.join(outputDirectory, 'renderer.html'),
		(await readFile(path.join(repositoryRoot, 'test/unit/electron/renderer.html'))).toString(),
		'utf8',
	);
}

async function main(args) {
	const { help, selection } = parseArguments(args);
	if (help) {
		console.log(usage());
		return 0;
	}
	if (process.env['COMET_TEST_COVERAGE_FILE']) {
		throw new Error('Electron unit coverage is not part of the Node LCOV collector.');
	}
	const discoveredTests = await discoverProjectTestFiles(repositoryRoot, 'electron');
	const selectedTests = selectTestFiles(discoveredTests, selection, repositoryRoot);
	console.log(`[unit/electron] ${selectedTests.length} test source${selectedTests.length === 1 ? '' : 's'}`);
	await buildTests(selectedTests);

	const electronPath = requireFromRepository('electron');
	const result = spawnSync(electronPath, [
		'--headless',
		'--disable-gpu',
		'--no-sandbox',
		path.resolve(repositoryRoot, 'test/unit/electron/main.mjs'),
		pathToFileURL(path.join(outputDirectory, 'renderer.html')).href,
	], {
		cwd: repositoryRoot,
		stdio: 'inherit',
		timeout: 60_000,
		env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
	});
	return spawnExitCode(result);
}

const exitCode = await main(process.argv.slice(2));
if (exitCode !== 0) {
	process.exit(exitCode);
}
