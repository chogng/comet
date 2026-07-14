/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const runtimes = Object.freeze([
	Object.freeze({ id: 'node', runner: 'test/unit/node/index.mjs' }),
	Object.freeze({ id: 'browser', runner: 'test/unit/browser/index.mjs' }),
	Object.freeze({ id: 'electron', runner: 'test/unit/electron/index.mjs' }),
]);

function usage() {
	return [
		'Usage: node test/unit/index.mjs [options]',
		'',
		'Options:',
		'  --runtime <id>  Run only node, browser, or electron',
		'  --run <file>   Forward an exact source selection to the chosen runtime',
		'  --glob <glob>  Forward a glob selection to the chosen runtime',
		'  --help         Show this help',
	].join('\n');
}

function parseArguments(args) {
	let runtime;
	let help = false;
	const forwarded = [];
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		if (argument === '--help') {
			help = true;
			continue;
		}
		if (argument === '--runtime') {
			runtime = args[++index];
			if (!runtime) {
				throw new Error(`Missing value for --runtime\n\n${usage()}`);
			}
			continue;
		}
		if (argument !== '--run' && argument !== '--glob') {
			throw new Error(`Unknown unit option: ${argument}\n\n${usage()}`);
		}
		const value = args[++index];
		if (!value || value.startsWith('--')) {
			throw new Error(`Missing value for ${argument}\n\n${usage()}`);
		}
		forwarded.push(argument, value);
	}
	return { runtime, forwarded, help };
}

function runRuntime(runtime, forwarded) {
	const result = spawnSync(process.execPath, [
		path.resolve(repositoryRoot, runtime.runner),
		...forwarded,
	], { cwd: repositoryRoot, stdio: 'inherit' });
	if (result.error) {
		throw result.error;
	}
	if (typeof result.status === 'number') {
		return result.status;
	}
	throw new Error(`Unit runtime ${runtime.id} terminated by ${result.signal ?? 'unknown signal'}`);
}

const { runtime, forwarded, help } = parseArguments(process.argv.slice(2));
if (help) {
	console.log(usage());
	process.exit(0);
}

const selectedRuntimes = runtime ? runtimes.filter(candidate => candidate.id === runtime) : runtimes;
if (selectedRuntimes.length !== 1 && runtime) {
	throw new Error(`Unknown unit runtime: ${runtime}`);
}
if (!runtime && forwarded.length > 0) {
	throw new Error('--run and --glob require --runtime so the source is not sent to the wrong host.');
}

for (const candidate of selectedRuntimes) {
	const exitCode = runRuntime(candidate, forwarded);
	if (exitCode !== 0) {
		process.exit(exitCode);
	}
}
