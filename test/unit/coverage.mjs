/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import { spawnExitCode } from './test-discovery.mjs';
import { nodeUnitTestRunner } from './node/runtime.mjs';

const coverageManifestName = 'coverage-manifest.json';
const defaultBaseRef = 'origin/main';
const repositoryRoot = path.resolve(process.cwd());
const defaultCoverageRoot = path.resolve(repositoryRoot, '.tmp/test-coverage');

export const coverageExclusions = Object.freeze([]);
export const coverageRuntimes = Object.freeze([
	Object.freeze({
		id: 'node',
		requiredPlatforms: Object.freeze(['any']),
		productionSourceRoots: Object.freeze(['src/cs']),
	}),
]);

function toPosixPath(filePath) {
	return filePath.replaceAll('\\', '/');
}

function normalizeRepositoryPath(filePath) {
	return toPosixPath(filePath).replace(/^\.\//, '').replace(/\/$/, '');
}

function isPathAtOrBelow(filePath, rootPath) {
	return filePath === rootPath || filePath.startsWith(`${rootPath}/`);
}

function runGit(args) {
	const result = spawnSync('git', args, {
		cwd: repositoryRoot,
		encoding: 'utf8',
	});
	const exitCode = spawnExitCode(result);
	if (exitCode !== 0) {
		throw new Error(`git ${args.join(' ')} failed with exit code ${exitCode}: ${result.stderr.trim()}`);
	}

	return result.stdout.trim();
}

export function parseLcov(contents) {
	const records = new Map();
	let current;

	for (const rawLine of contents.split(/\r?\n/u)) {
		if (rawLine.startsWith('SF:')) {
			const file = normalizeRepositoryPath(rawLine.slice(3));
			current = { file, branches: [] };
			records.set(file, current);
		} else if (rawLine.startsWith('BRDA:') && current) {
			const [lineText, block, branch, countText] = rawLine.slice(5).split(',');
			if (lineText !== 'undefined') {
				const line = Number.parseInt(lineText, 10);
				const count = countText === '-' ? 0 : Number.parseInt(countText, 10);
				if (Number.isInteger(line) && Number.isInteger(count)) {
					current.branches.push({ line, block, branch, count });
				}
			}
		} else if (rawLine === 'end_of_record') {
			current = undefined;
		}
	}

	return records;
}

export async function readCoverageFragment(fragmentFile) {
	let fragmentStat;
	try {
		fragmentStat = await stat(fragmentFile);
	} catch (error) {
		if (error.code === 'ENOENT') {
			throw new Error(`Missing coverage file: ${fragmentFile}`);
		}
		throw error;
	}
	if (!fragmentStat.isFile() || fragmentStat.size === 0) {
		throw new Error(`Missing coverage file: ${fragmentFile}`);
	}

	const records = parseLcov(await readFile(fragmentFile, 'utf8'));
	for (const sourceFile of records.keys()) {
		if (isPathAtOrBelow(sourceFile, '.tmp')) {
			throw new Error(`Coverage fragment is missing source-map resolution: ${sourceFile}`);
		}
	}
	return records;
}

export function parseChangedLines(diffText) {
	const changedLines = new Map();
	let currentFile;

	for (const line of diffText.split(/\r?\n/u)) {
		if (line.startsWith('+++ b/')) {
			currentFile = normalizeRepositoryPath(line.slice(6));
			if (!changedLines.has(currentFile)) {
				changedLines.set(currentFile, new Set());
			}
			continue;
		}

		if (!currentFile || !line.startsWith('@@')) {
			continue;
		}

		const match = /\+(\d+)(?:,(\d+))?/u.exec(line);
		if (!match) {
			throw new Error(`Unable to parse changed-line hunk: ${line}`);
		}

		const start = Number.parseInt(match[1], 10);
		const count = match[2] === undefined ? 1 : Number.parseInt(match[2], 10);
		for (let changedLine = start; changedLine < start + count; changedLine++) {
			changedLines.get(currentFile).add(changedLine);
		}
	}

	return changedLines;
}

export function findProductionSourceRuntime(filePath, runtimes = coverageRuntimes) {
	const normalizedFile = normalizeRepositoryPath(filePath);
	const matches = [];

	for (const runtime of runtimes) {
		for (const sourceRoot of runtime.productionSourceRoots) {
			const normalizedRoot = normalizeRepositoryPath(sourceRoot);
			if (isPathAtOrBelow(normalizedFile, normalizedRoot)) {
				matches.push({ runtime, root: normalizedRoot });
			}
		}
	}

	if (matches.length === 0) {
		throw new Error(`Changed production source has no coverage runtime: ${normalizedFile}`);
	}

	const longestRoot = Math.max(...matches.map(match => match.root.length));
	const owners = matches.filter(match => match.root.length === longestRoot);
	const ownerIds = new Set(owners.map(match => match.runtime.id));
	if (ownerIds.size !== 1) {
		throw new Error(
			`Changed production source has multiple equally specific coverage runtimes: ${normalizedFile} (${[...ownerIds].join(', ')})`,
		);
	}

	return owners[0].runtime;
}

function nodeSpan(sourceFile, node) {
	const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
	const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
	return { startLine: start, endLine: end, kind: ts.SyntaxKind[node.kind] };
}

function isLogicalBinaryExpression(node) {
	return ts.isBinaryExpression(node) && [
		ts.SyntaxKind.AmpersandAmpersandToken,
		ts.SyntaxKind.BarBarToken,
		ts.SyntaxKind.QuestionQuestionToken,
	].includes(node.operatorToken.kind);
}

function branchSpanNode(node) {
	if (ts.isIfStatement(node)) {
		return node.expression;
	}
	if (ts.isConditionalExpression(node) || isLogicalBinaryExpression(node)) {
		return node;
	}
	if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
		return node;
	}
	if (ts.isWhileStatement(node) || ts.isDoStatement(node)) {
		return node.expression;
	}
	if (ts.isForStatement(node)) {
		return node.condition;
	}
	if (ts.isForInStatement(node) || ts.isForOfStatement(node)) {
		return node.expression;
	}
	if ((ts.isPropertyAccessExpression(node)
		|| ts.isElementAccessExpression(node)
		|| ts.isCallExpression(node)) && node.questionDotToken) {
		return node;
	}
	return undefined;
}

export function findChangedBranchSpans(filePath, sourceText, changedLines) {
	const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true);
	const spans = new Map();
	const visit = node => {
		const spanNode = branchSpanNode(node);
		if (spanNode) {
			const span = nodeSpan(sourceFile, spanNode);
			const changed = [...changedLines].some(line => line >= span.startLine && line <= span.endLine);
			if (changed) {
				spans.set(`${span.kind}:${span.startLine}:${span.endLine}`, span);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return [...spans.values()].sort((left, right) =>
		left.startLine - right.startLine || left.endLine - right.endLine || left.kind.localeCompare(right.kind),
	);
}

function exclusionMatches(filePath, span, exclusion) {
	return normalizeRepositoryPath(exclusion.file) === normalizeRepositoryPath(filePath)
		&& span.startLine >= exclusion.startLine
		&& span.endLine <= exclusion.endLine;
}

export function validateCoverageFragmentDescriptors(
	descriptors,
	expectedCommit,
	runtimes = coverageRuntimes,
) {
	const descriptorMap = new Map();
	for (const descriptor of descriptors) {
		if (descriptor.commit !== expectedCommit) {
			throw new Error(
				`Coverage fragment commit mismatch for ${descriptor.runtimeId}/${descriptor.platform}: expected ${expectedCommit}, got ${descriptor.commit}`,
			);
		}
		const key = `${descriptor.runtimeId}:${descriptor.platform}`;
		if (descriptorMap.has(key)) {
			throw new Error(`Duplicate coverage fragment: ${descriptor.runtimeId}/${descriptor.platform}`);
		}
		descriptorMap.set(key, descriptor);
	}

	for (const runtime of runtimes) {
		for (const platform of runtime.requiredPlatforms) {
			const key = `${runtime.id}:${platform}`;
			if (!descriptorMap.has(key)) {
				throw new Error(`Missing required coverage fragment: ${runtime.id}/${platform}`);
			}
		}
	}

	return descriptorMap;
}

export function evaluateChangedBranchRecords({
	changedBranches,
	fragmentRecords,
	runtimes = coverageRuntimes,
	exclusions = coverageExclusions,
}) {
	for (const exclusion of exclusions) {
		if (!exclusion.reason?.trim()) {
			throw new Error(`Coverage exclusion requires a reason: ${exclusion.file}`);
		}
	}

	const failures = [];
	let evaluatedBranches = 0;
	for (const changedFile of changedBranches) {
		const runtime = findProductionSourceRuntime(changedFile.file, runtimes);
		for (const span of changedFile.spans) {
			if (exclusions.some(exclusion => exclusionMatches(changedFile.file, span, exclusion))) {
				continue;
			}
			evaluatedBranches++;
			for (const platform of runtime.requiredPlatforms) {
				const records = fragmentRecords.get(`${runtime.id}:${platform}`);
				const record = records?.get(normalizeRepositoryPath(changedFile.file));
				const branches = record?.branches.filter(branch =>
					branch.line >= span.startLine && branch.line <= span.endLine,
				) ?? [];
				if (branches.length === 0) {
					failures.push(
						`${changedFile.file}:${span.startLine}-${span.endLine} (${runtime.id}/${platform}) has no source-mapped branch coverage`,
					);
				} else if (branches.some(branch => branch.count === 0)) {
					failures.push(
						`${changedFile.file}:${span.startLine}-${span.endLine} (${runtime.id}/${platform}) has an uncovered changed branch`,
					);
				}
			}
		}
	}

	if (failures.length > 0) {
		throw new Error(['Changed branch coverage failed:', ...failures.map(failure => `- ${failure}`)].join('\n'));
	}

	return evaluatedBranches;
}

async function collectManifestFiles(directory, result) {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			await collectManifestFiles(entryPath, result);
		} else if (entry.isFile() && entry.name === coverageManifestName) {
			result.push(entryPath);
		}
	}
}

async function readCoverageDescriptors(inputDir, expectedCommit) {
	const manifestFiles = [];
	await collectManifestFiles(inputDir, manifestFiles);
	if (manifestFiles.length === 0) {
		throw new Error(`No coverage manifests found under ${inputDir}`);
	}

	const descriptors = [];
	for (const manifestFile of manifestFiles.sort()) {
		const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
		if (manifest.schemaVersion !== 1 || typeof manifest.platform !== 'string'
			|| typeof manifest.commit !== 'string' || !Array.isArray(manifest.runtimes)) {
			throw new Error(`Invalid coverage manifest: ${manifestFile}`);
		}
		for (const runtime of manifest.runtimes) {
			const fragmentFile = path.resolve(path.dirname(manifestFile), runtime.file);
			const fragmentStat = await stat(fragmentFile);
			if (!fragmentStat.isFile() || fragmentStat.size === 0) {
				throw new Error(`Missing coverage file: ${fragmentFile}`);
			}
			descriptors.push({
				runtimeId: runtime.id,
				platform: manifest.platform,
				commit: manifest.commit,
				file: fragmentFile,
			});
		}
	}

	return validateCoverageFragmentDescriptors(descriptors, expectedCommit);
}

async function collectCoverage(outputDir, platform) {
	await mkdir(outputDir, { recursive: true });
	const commit = runGit(['rev-parse', 'HEAD']);
	const runtimes = coverageRuntimes.filter(runtime => runtime.requiredPlatforms.includes(platform));
	if (runtimes.length === 0) {
		throw new Error(`No coverage collectors declared for platform: ${platform}`);
	}

	const manifestRuntimes = [];
	for (const runtime of runtimes) {
		const fragmentFile = path.resolve(outputDir, `${runtime.id}.info`);
		try {
			await unlink(fragmentFile);
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}

		const result = spawnSync(process.execPath, [
			path.resolve(repositoryRoot, nodeUnitTestRunner),
		], {
			cwd: repositoryRoot,
			stdio: 'inherit',
			env: {
				...process.env,
				COMET_TEST_COVERAGE_FILE: fragmentFile,
			},
		});
		const exitCode = spawnExitCode(result);
		if (exitCode !== 0) {
			throw new Error(`Coverage collector failed for ${runtime.id} with exit code ${exitCode}`);
		}

		const fragmentStat = await stat(fragmentFile);
		if (!fragmentStat.isFile() || fragmentStat.size === 0) {
			throw new Error(`Coverage collector did not produce ${fragmentFile}`);
		}
		manifestRuntimes.push({ id: runtime.id, file: path.basename(fragmentFile) });
	}

	await writeFile(
		path.resolve(outputDir, coverageManifestName),
		`${JSON.stringify({ schemaVersion: 1, platform, commit, runtimes: manifestRuntimes }, null, 2)}\n`,
		'utf8',
	);
}

async function evaluateCoverage(inputDir, baseRef) {
	const commit = runGit(['rev-parse', 'HEAD']);
	const mergeBase = runGit(['merge-base', 'HEAD', baseRef]);
	if (!mergeBase) {
		throw new Error(`No merge base found between HEAD and ${baseRef}`);
	}

	const descriptors = await readCoverageDescriptors(inputDir, commit);
	const fragmentRecords = new Map();
	for (const [key, descriptor] of descriptors) {
		fragmentRecords.set(key, await readCoverageFragment(descriptor.file));
	}

	const diffText = runGit([
		'diff',
		'--unified=0',
		'--diff-filter=ACMR',
		`${mergeBase}...HEAD`,
		'--',
		'*.ts',
	]);
	const changedLines = parseChangedLines(diffText);
	const changedBranches = [];
	for (const [file, lines] of changedLines) {
		if (!isPathAtOrBelow(file, 'src/cs')
			|| file.endsWith('.d.ts')
			|| file.endsWith('.test.ts')
			|| file.endsWith('.integrationTest.ts')) {
			continue;
		}

		findProductionSourceRuntime(file);
		const sourceText = await readFile(path.resolve(repositoryRoot, file), 'utf8');
		const spans = findChangedBranchSpans(file, sourceText, lines);
		if (spans.length > 0) {
			changedBranches.push({ file, spans });
		}
	}

	const evaluatedBranches = evaluateChangedBranchRecords({
		changedBranches,
		fragmentRecords,
	});
	console.log(
		`Changed branch coverage passed: ${evaluatedBranches} branch${evaluatedBranches === 1 ? '' : 'es'} across ${changedBranches.length} file${changedBranches.length === 1 ? '' : 's'}.`,
	);
}

function readOption(args, name) {
	const optionIndex = args.indexOf(name);
	if (optionIndex < 0 || optionIndex + 1 >= args.length) {
		throw new Error(`Missing required option: ${name}`);
	}
	return args[optionIndex + 1];
}

async function main(args) {
	if (args.length === 0) {
		const outputDir = path.resolve(defaultCoverageRoot, 'any');
		await collectCoverage(outputDir, 'any');
		await evaluateCoverage(defaultCoverageRoot, defaultBaseRef);
		return;
	}

	if (args[0] === '--collect-only') {
		if (args.length !== 5) {
			throw new Error('Usage: coverage.mjs --collect-only --platform <platform> --output <directory>');
		}
		await collectCoverage(
			path.resolve(repositoryRoot, readOption(args, '--output')),
			readOption(args, '--platform'),
		);
		return;
	}

	if (args[0] === '--evaluate-only') {
		if (args.length !== 3 && args.length !== 5) {
			throw new Error('Usage: coverage.mjs --evaluate-only --input <directory> [--base <ref>]');
		}
		await evaluateCoverage(
			path.resolve(repositoryRoot, readOption(args, '--input')),
			args.includes('--base') ? readOption(args, '--base') : defaultBaseRef,
		);
		return;
	}

	throw new Error(`Unknown coverage mode: ${args[0]}`);
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedFile === path.resolve(repositoryRoot, 'test/unit/coverage.mjs')) {
	await main(process.argv.slice(2));
}
