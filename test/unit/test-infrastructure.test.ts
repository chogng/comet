/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suite, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

import {
	compiledTestPath,
	discoverProjectTestFiles,
	selectTestFiles,
	spawnExitCode,
	validateSupportedTestFiles,
	validateTestProjectOwnership,
} from './test-discovery.mjs';
import {
	coverageRuntimes,
	evaluateChangedBranchRecords,
	findChangedBranchSpans,
	findProductionSourceRuntime,
	parseChangedLines,
	parseLcov,
	readCoverageFragment,
	validateCoverageFragmentDescriptors,
	type CoverageRuntime,
} from './coverage.mjs';
import {
	createNodeTestArguments,
	nodeUnitTestBuild,
	nodeUnitTestOutput,
	nodeUnitTestRunner,
} from './node/runtime.mjs';

const repositoryRoot = process.cwd();

function syntheticCoverageRuntime(
	id: string,
	productionSourceRoots: readonly string[],
	requiredPlatforms: readonly string[] = ['any'],
): CoverageRuntime {
	return { id, productionSourceRoots, requiredPlatforms };
}

suite('test discovery', { concurrency: false }, () => {
	test('discovers, normalizes, and sorts unit and integration sources without a private list', () => {
		const files = validateSupportedTestFiles([
			'src\\example tests\\z.test.ts',
			'src/example tests/new.integrationTest.ts',
			'src/example tests/a.test.ts',
		]);

		assert.deepStrictEqual(files, [
			'src/example tests/a.test.ts',
			'src/example tests/new.integrationTest.ts',
			'src/example tests/z.test.ts',
		]);
	});

	test('selects exact files and repository-relative globs', () => {
		const files = [
			'src/cs/base/common/test/actions.test.ts',
			'src/cs/base/common/test/async.test.ts',
			'src/cs/code/electron-main/tests/moark.integrationTest.ts',
		];

		assert.deepStrictEqual(selectTestFiles(files, {
			runFiles: ['src/cs/base/common/test/actions.test.ts'],
			globs: ['src/cs/code/**/*.integrationTest.ts'],
		}), [
			'src/cs/base/common/test/actions.test.ts',
			'src/cs/code/electron-main/tests/moark.integrationTest.ts',
		]);
		assert.deepStrictEqual(selectTestFiles(files, {
			globs: ['src/cs/base/common/test/**/*.test.ts'],
		}), files.slice(0, 2));
	});

	test('rejects unsupported suffixes and selectors that match no discovered source', () => {
		assert.throws(
			() => validateSupportedTestFiles(['src/example/unsupported.spec.ts']),
			/Unsupported test suffix: src\/example\/unsupported\.spec\.ts/,
		);
		assert.throws(
			() => selectTestFiles(
				['src/example/known.test.ts'],
				{ runFiles: ['src/example/missing.test.ts'] },
			),
			/Unit test source was not discovered: src\/example\/missing\.test\.ts/,
		);
		assert.throws(
			() => selectTestFiles(
				['src/example/known.test.ts'],
				{ globs: ['src/other/**/*.test.ts'] },
			),
			/Unit test glob matched no sources: src\/other\/\*\*\/\*\.test\.ts/,
		);
		assert.throws(
			() => selectTestFiles(
				['src/example/known.test.ts'],
				{ runFiles: [path.resolve(repositoryRoot, '..', 'outside.test.ts')] },
				repositoryRoot,
			),
			/Unit test source is outside the repository/,
		);
	});

	test('every current Node unit source belongs to the test TypeScript project', async () => {
		const testFiles = await discoverProjectTestFiles(repositoryRoot);
		assert.ok(testFiles.length > 0);
		assert.ok(testFiles.includes('test/unit/test-infrastructure.test.ts'));
		await validateTestProjectOwnership(testFiles, repositoryRoot);
	});
});

suite('Node unit runtime', { concurrency: false }, () => {
	test('one public command and one runtime entry point replace domain runners and aggregation tests', () => {
		const packageJson = JSON.parse(
			readFileSync(path.resolve(repositoryRoot, 'package.json'), 'utf8'),
		) as { readonly scripts: Readonly<Record<string, string>> };
		assert.equal(packageJson.scripts['test:unit'], `node ${nodeUnitTestRunner}`);
		for (const retiredCommand of [
			'test:valid-layers-check',
			'test:base-common',
			'test:workbench-browser',
			'test:editor',
			'test:pdf-selection',
			'test:library-store',
			'test:electron-main',
			'test:agent',
		]) {
			assert.equal(packageJson.scripts[retiredCommand], undefined, retiredCommand);
		}

		const runnerSource = readFileSync(path.resolve(repositoryRoot, nodeUnitTestRunner), 'utf8');
		assert.match(runnerSource, /discoverProjectTestFiles/);
		assert.match(runnerSource, /selectTestFiles/);
		assert.doesNotMatch(runnerSource, /\btestPaths\b|\bEntryPoint\b|entryPoints\s*=\s*\[/);

		for (const retiredRunner of [
			'scripts/run-valid-layers-check-tests.mjs',
			'scripts/run-base-common-tests.mjs',
			'scripts/run-workbench-browser-tests.mjs',
			'scripts/run-editor-tests.mjs',
			'scripts/run-pdf-selection-tests.mjs',
			'scripts/run-library-store-tests.mjs',
			'scripts/run-electron-main-tests.mjs',
			'scripts/run-agent-tests.mjs',
			'test/unit/node/pdf-fixtures.mjs',
		]) {
			assert.equal(existsSync(path.resolve(repositoryRoot, retiredRunner)), false, retiredRunner);
		}

		for (const aggregationFile of [
			'src/cs/base/common/test/index.test.ts',
			'src/cs/agent/tests/index.test.ts',
			'src/cs/platform/storage/test/index.test.ts',
			'src/cs/code/electron-main/tests/index.test.ts',
			'src/cs/editor/browser/pdf/tests/pdfSelection.index.test.ts',
		]) {
			assert.equal(existsSync(path.resolve(repositoryRoot, aggregationFile)), false, aggregationFile);
		}
	});

	test('runtime directories represent processes that really exist', () => {
		assert.equal(existsSync(path.resolve(repositoryRoot, nodeUnitTestRunner)), true);
		assert.equal(existsSync(path.resolve(repositoryRoot, 'test/unit/browser/index.mjs')), false);
		assert.equal(existsSync(path.resolve(repositoryRoot, 'test/unit/electron/index.mjs')), false);
	});

	test('the entry point exposes file and glob selection and rejects unknown grouping options', () => {
		const childEnvironment = { ...process.env };
		delete childEnvironment['NODE_TEST_CONTEXT'];
		const helpResult = spawnSync(process.execPath, [
			path.resolve(repositoryRoot, nodeUnitTestRunner),
			'--help',
		], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			env: childEnvironment,
		});
		assert.equal(spawnExitCode(helpResult), 0);
		assert.match(helpResult.stdout, /--run <file>/);
		assert.match(helpResult.stdout, /--glob <glob>/);

		const removedOptionResult = spawnSync(process.execPath, [
			path.resolve(repositoryRoot, nodeUnitTestRunner),
			'--group',
			'base-common',
		], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			env: childEnvironment,
		});
		assert.notEqual(spawnExitCode(removedOptionResult), 0);
		assert.match(
			`${removedOptionResult.stdout}\n${removedOptionResult.stderr}`,
			/Unknown unit test option/,
		);
	});

	test('one Node policy owns build format, DOM bootstrap, concurrency, and reporting', () => {
		assert.equal(nodeUnitTestBuild.format, 'esm');
		assert.equal(nodeUnitTestBuild.target, 'node24');
		assert.deepStrictEqual(nodeUnitTestBuild.loader, {
			'.css': 'empty',
			'.html': 'text',
			'.svg': 'text',
		});

		const outputDirectory = path.resolve(repositoryRoot, nodeUnitTestOutput);
		const args = createNodeTestArguments(outputDirectory, undefined, repositoryRoot);
		assert.deepStrictEqual(args.slice(0, 2), [
			'--import',
			pathToFileURL(path.resolve(repositoryRoot, 'test/unit/node/jsdom-bootstrap.mjs')).href,
		]);
		assert.ok(args.includes('--test-concurrency=1'));
		assert.ok(args.includes('--test-reporter=spec'));
		assert.ok(args.at(-2)?.endsWith('/**/*.test.js'));
		assert.ok(args.at(-1)?.endsWith('/**/*.integrationTest.js'));

		const coverageArgs = createNodeTestArguments(
			outputDirectory,
			'C:\\coverage output\\node.info',
			repositoryRoot,
		);
		assert.ok(coverageArgs.includes('--experimental-test-coverage'));
		assert.ok(coverageArgs.includes('--test-reporter=lcov'));
		assert.ok(coverageArgs.includes('--test-reporter-destination=C:\\coverage output\\node.info'));
	});

	test('compiled output remains inside the Node runtime directory', () => {
		const outputDirectory = path.resolve(repositoryRoot, nodeUnitTestOutput);
		assert.match(
			compiledTestPath(
				'src/cs/base/common/test/actions.test.ts',
				outputDirectory,
				repositoryRoot,
			),
			/[\\/]\.tmp[\\/]unit[\\/]node[\\/]src[\\/]cs[\\/]base[\\/]common[\\/]test[\\/]actions\.test\.js$/,
		);
		assert.throws(
			() => compiledTestPath(
				path.resolve(repositoryRoot, '..', 'lost.test.ts'),
				outputDirectory,
				repositoryRoot,
			),
			/Test source is outside the repository/,
		);
	});

	test('child failures and signal termination propagate', () => {
		assert.equal(spawnExitCode({ status: 23, signal: null }), 23);
		assert.throws(
			() => spawnExitCode({ status: null, signal: 'SIGTERM' }),
			/Test process terminated by SIGTERM/,
		);
		const failure = new Error('spawn failed');
		assert.throws(
			() => spawnExitCode({ error: failure, status: null, signal: null }),
			/spawn failed/,
		);
	});

	test('TypeScript and esbuild failures remain terminal', async t => {
		await assert.rejects(
			build({
				stdin: { contents: 'const invalid: = true;', loader: 'ts' },
				write: false,
				logLevel: 'silent',
			}),
			/Unexpected "="/,
		);

		const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'comet-typescript-failure-'));
		t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
		const sourceFile = path.join(fixtureRoot, 'invalid.ts');
		writeFileSync(sourceFile, 'const value: string = 1;\n');
		const result = spawnSync(process.execPath, [
			path.resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'),
			'--noEmit',
			'--skipLibCheck',
			'--target',
			'ES2022',
			'--module',
			'NodeNext',
			'--moduleResolution',
			'NodeNext',
			sourceFile,
		], { stdio: 'pipe' });
		assert.notEqual(spawnExitCode(result), 0);
	});
});

suite('changed branch coverage', { concurrency: false }, () => {
	test('parses changed hunks and evaluates covered and uncovered TypeScript branches', () => {
		const changedLines = parseChangedLines([
			'diff --git a/src/cs/example/source.ts b/src/cs/example/source.ts',
			'+++ b/src/cs/example/source.ts',
			'@@ -1,0 +1,3 @@',
		].join('\n'));
		assert.deepStrictEqual([...changedLines.get('src/cs/example/source.ts') ?? []], [1, 2, 3]);

		const sourceText = [
			'export function choose(value: boolean): number {',
			'\treturn value ? 1 : 0;',
			'}',
		].join('\n');
		const spans = findChangedBranchSpans(
			'src/cs/example/source.ts',
			sourceText,
			new Set([2]),
		);
		assert.equal(spans.length, 1);

		const coveredRecords = parseLcov([
			'SF:src/cs/example/source.ts',
			'BRDA:2,0,0,1',
			'end_of_record',
		].join('\n'));
		assert.equal(evaluateChangedBranchRecords({
			changedBranches: [{ file: 'src/cs/example/source.ts', spans }],
			fragmentRecords: new Map([['node:any', coveredRecords]]),
		}), 1);

		const uncoveredRecords = parseLcov([
			'SF:src/cs/example/source.ts',
			'BRDA:2,0,0,0',
			'end_of_record',
		].join('\n'));
		assert.throws(
			() => evaluateChangedBranchRecords({
				changedBranches: [{ file: 'src/cs/example/source.ts', spans }],
				fragmentRecords: new Map([['node:any', uncoveredRecords]]),
			}),
			/src\/cs\/example\/source\.ts:2-2 \(node\/any\) has an uncovered changed branch/,
		);
	});

	test('coverage ownership follows real runtimes and rejects missing platform fragments', () => {
		assert.equal(findProductionSourceRuntime('src/cs/example/source.ts').id, 'node');
		assert.equal(coverageRuntimes.length, 1);

		const runtime = syntheticCoverageRuntime('browser', ['src/browser'], ['win32']);
		assert.throws(
			() => validateCoverageFragmentDescriptors([], 'commit', [runtime]),
			/Missing required coverage fragment: browser\/win32/,
		);
		assert.throws(
			() => findProductionSourceRuntime('src/unowned/source.ts', [runtime]),
			/Changed production source has no coverage runtime: src\/unowned\/source\.ts/,
		);
	});

	test('rejects missing coverage files and unresolved generated source maps', async () => {
		const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'comet-missing-coverage-'));
		try {
			await assert.rejects(
				readCoverageFragment(path.join(fixtureRoot, 'missing.info')),
				/Missing coverage file/,
			);
			const generatedCoverage = path.join(fixtureRoot, 'generated.info');
			writeFileSync(generatedCoverage, 'SF:.tmp/generated.test.js\nend_of_record\n');
			await assert.rejects(
				readCoverageFragment(generatedCoverage),
				/Coverage fragment is missing source-map resolution: \.tmp\/generated\.test\.js/,
			);
		} finally {
			rmSync(fixtureRoot, { recursive: true, force: true });
		}
	});

	test('rejects a missing merge-base revision before reading coverage fragments', t => {
		const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'comet-coverage-base-'));
		t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
		const childEnvironment = { ...process.env };
		delete childEnvironment['NODE_TEST_CONTEXT'];
		const result = spawnSync(process.execPath, [
			path.resolve(repositoryRoot, 'test/unit/coverage.mjs'),
			'--evaluate-only',
			'--input',
			fixtureRoot,
			'--base',
			'refs/heads/comet-missing-coverage-base',
		], {
			cwd: repositoryRoot,
			encoding: 'utf8',
			env: childEnvironment,
		});
		assert.notEqual(spawnExitCode(result), 0);
		assert.match(
			`${result.stdout}\n${result.stderr}`,
			/git merge-base HEAD refs\/heads\/comet-missing-coverage-base failed/,
		);
	});

	test('Node LCOV resolves bundled covered and uncovered branches to original TypeScript', async t => {
		if (process.env['COMET_TEST_COVERAGE_FILE']) {
			t.skip('Nested Node coverage is verified by the normal unit runtime');
			return;
		}

		const fixtureParent = path.resolve(repositoryRoot, '.tmp');
		mkdirSync(fixtureParent, { recursive: true });
		const fixtureRoot = mkdtempSync(path.join(fixtureParent, 'coverage-fixture-'));
		t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

		const sourceFile = path.join(fixtureRoot, 'source.ts');
		const testFile = path.join(fixtureRoot, 'source.test.ts');
		const outputFile = path.join(fixtureRoot, 'source.test.mjs');
		const coverageFile = path.join(fixtureRoot, 'coverage.info');
		writeFileSync(sourceFile, [
			'export function choose(value: boolean): string {',
			'\tif (value) {',
			"\t\treturn 'yes';",
			'\t}',
			"\treturn 'no';",
			'}',
		].join('\n'));
		writeFileSync(testFile, [
			"import assert from 'node:assert/strict';",
			"import test from 'node:test';",
			"import { choose } from './source.js';",
			"test('covered arm', () => assert.equal(choose(true), 'yes'));",
		].join('\n'));

		await build({
			entryPoints: [testFile],
			outfile: outputFile,
			bundle: true,
			platform: 'node',
			format: 'esm',
			target: 'node24',
			sourcemap: 'inline',
			external: ['node:assert/strict', 'node:test'],
		});
		const childEnvironment = { ...process.env };
		delete childEnvironment['NODE_TEST_CONTEXT'];
		const result = spawnSync(process.execPath, [
			'--enable-source-maps',
			'--test',
			'--experimental-test-coverage',
			'--test-reporter=lcov',
			`--test-reporter-destination=${coverageFile}`,
			outputFile,
		], { stdio: 'pipe', env: childEnvironment });
		assert.equal(spawnExitCode(result), 0, result.stderr.toString());

		const records = parseLcov(readFileSync(coverageFile, 'utf8'));
		const sourceRecord = [...records].find(([file]) => file.endsWith('/source.ts'))?.[1];
		assert.ok(sourceRecord, 'original TypeScript source is present in LCOV');
		assert.ok(sourceRecord.branches.some(branch => branch.count > 0), 'covered branch is mapped');
		assert.ok(sourceRecord.branches.some(branch => branch.count === 0), 'uncovered branch is mapped');
	});
});
