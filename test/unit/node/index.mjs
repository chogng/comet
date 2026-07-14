/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import {
	discoverProjectTestFiles,
	selectTestFiles,
	spawnExitCode,
	validateTestProjectOwnership,
} from '../test-discovery.mjs';
import {
	createNodeTestArguments,
	nodeUnitTestBuild,
	nodeUnitTestOutput,
} from './runtime.mjs';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));

function usage() {
	return [
		'Usage: node test/unit/node/index.mjs [options]',
		'',
		'Options:',
		'  --run <file>    Run one discovered test source; may be repeated',
		'  --glob <glob>   Run discovered test sources matching a repository-relative glob; may be repeated',
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
			throw new Error(`Unknown unit test option: ${argument}\n\n${usage()}`);
		}

		const value = args[index + 1];
		if (!value || value.startsWith('--')) {
			throw new Error(`Missing value for ${argument}\n\n${usage()}`);
		}
		index++;
		if (argument === '--run') {
			selection.runFiles.push(value);
		} else {
			selection.globs.push(value);
		}
	}

	return { help, selection };
}

async function buildTests(testFiles, outputDirectory) {
	await rm(outputDirectory, { recursive: true, force: true });
	await mkdir(outputDirectory, { recursive: true });
	await build({
		entryPoints: testFiles.map(testFile => path.resolve(repositoryRoot, testFile)),
		outdir: outputDirectory,
		outbase: repositoryRoot,
		bundle: true,
		platform: 'node',
		...nodeUnitTestBuild,
	});
}

async function main(args) {
	const { help, selection } = parseArguments(args);
	if (help) {
		console.log(usage());
		return 0;
	}

	const coverageFile = process.env['COMET_TEST_COVERAGE_FILE'];
	if (coverageFile && (selection.runFiles.length > 0 || selection.globs.length > 0)) {
		throw new Error('Coverage collection requires the complete Node unit runtime');
	}

	const discoveredTests = await discoverProjectTestFiles(repositoryRoot);
	await validateTestProjectOwnership(discoveredTests, repositoryRoot);
	const selectedTests = selectTestFiles(discoveredTests, selection, repositoryRoot);
	const outputDirectory = path.resolve(repositoryRoot, nodeUnitTestOutput);
	console.log(`[unit/node] ${selectedTests.length} test source${selectedTests.length === 1 ? '' : 's'}`);
	await buildTests(selectedTests, outputDirectory);

	if (coverageFile) {
		await mkdir(path.dirname(coverageFile), { recursive: true });
	}

	const result = spawnSync(
		process.execPath,
		createNodeTestArguments(outputDirectory, coverageFile, repositoryRoot),
		{ cwd: repositoryRoot, stdio: 'inherit' },
	);
	return spawnExitCode(result);
}

const exitCode = await main(process.argv.slice(2));
if (exitCode !== 0) {
	process.exit(exitCode);
}
