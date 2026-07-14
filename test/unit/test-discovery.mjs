/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export const supportedTestSuffixes = Object.freeze([
	'.integrationTest.ts',
	'.test.ts',
]);

export const unitTestSourceRoots = Object.freeze([
	'scripts',
	'src',
	'test/unit',
]);

export const unitRuntimeSourceRoots = Object.freeze({
	node: Object.freeze(unitTestSourceRoots),
	browser: Object.freeze([
		'test/unit/browser',
		'src/cs/base/test/browser',
	]),
	electron: Object.freeze(['test/unit/electron']),
});

export const unitTypeScriptProjects = Object.freeze([
	Object.freeze({
		id: 'repository',
		config: 'tsconfig.tests.json',
	}),
]);

function toPosixPath(filePath) {
	return filePath.replaceAll('\\', '/');
}

function normalizeRepositoryPath(filePath) {
	return toPosixPath(filePath).replace(/^\.\//, '').replace(/\/$/, '');
}

function isPathOutsideRoot(relativePath) {
	return relativePath === '..'
		|| relativePath.startsWith(`..${path.sep}`)
		|| path.isAbsolute(relativePath);
}

function isTestLikeSource(filePath) {
	return /(?:^|\.)(?:integrationTest|test|spec)\.(?:cts|mts|ts|tsx)$/.test(filePath);
}

async function collectFiles(currentPath, repositoryPath, result) {
	const entries = await readdir(currentPath, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

	for (const entry of entries) {
		const absolutePath = path.join(currentPath, entry.name);
		const relativePath = normalizeRepositoryPath(path.posix.join(repositoryPath, entry.name));

		if (entry.isDirectory()) {
			await collectFiles(absolutePath, relativePath, result);
		} else if (entry.isFile()) {
			result.push(relativePath);
		}
	}
}

export function validateSupportedTestFiles(files) {
	const sortedFiles = [...files].map(normalizeRepositoryPath).sort((left, right) =>
		left.localeCompare(right, 'en'),
	);
	const unsupportedFiles = sortedFiles.filter(file =>
		!supportedTestSuffixes.some(suffix => file.endsWith(suffix)),
	);
	if (unsupportedFiles.length > 0) {
		throw new Error(unsupportedFiles.map(file => `Unsupported test suffix: ${file}`).join('\n'));
	}

	return sortedFiles;
}

function normalizeRunFile(filePath, rootDir) {
	if (!path.isAbsolute(filePath)) {
		return normalizeRepositoryPath(filePath);
	}

	const relativePath = path.relative(rootDir, path.resolve(filePath));
	if (isPathOutsideRoot(relativePath)) {
		throw new Error(`Unit test source is outside the repository: ${filePath}`);
	}
	return normalizeRepositoryPath(relativePath);
}

export function selectTestFiles(files, selection = {}, rootDir = process.cwd()) {
	const availableFiles = validateSupportedTestFiles(files);
	const runFiles = selection.runFiles ?? [];
	const globs = selection.globs ?? [];
	if (runFiles.length === 0 && globs.length === 0) {
		return availableFiles;
	}

	const selectedFiles = new Set();
	for (const runFile of runFiles) {
		const normalizedFile = normalizeRunFile(runFile, rootDir);
		if (!availableFiles.includes(normalizedFile)) {
			throw new Error(`Unit test source was not discovered: ${normalizedFile}`);
		}
		selectedFiles.add(normalizedFile);
	}

	for (const glob of globs) {
		const normalizedGlob = normalizeRepositoryPath(glob);
		const matches = availableFiles.filter(file => path.posix.matchesGlob(file, normalizedGlob));
		if (matches.length === 0) {
			throw new Error(`Unit test glob matched no sources: ${normalizedGlob}`);
		}
		for (const match of matches) {
			selectedFiles.add(match);
		}
	}

	return [...selectedFiles].sort((left, right) => left.localeCompare(right, 'en'));
}

export async function discoverProjectTestFiles(rootDir = process.cwd(), runtime = 'node') {
	const sourceRoots = unitRuntimeSourceRoots[runtime];
	if (!sourceRoots) {
		throw new Error(`Unknown unit runtime: ${runtime}`);
	}

	const files = [];

	for (const sourceRoot of sourceRoots) {
		const absoluteRoot = path.resolve(rootDir, sourceRoot);
		const rootStat = await stat(absoluteRoot);
		if (!rootStat.isDirectory()) {
			throw new Error(`Test source root is not a directory: ${sourceRoot}`);
		}

		await collectFiles(absoluteRoot, sourceRoot, files);
	}

	const discoveredFiles = files.filter(isTestLikeSource);
	if (runtime === 'node') {
		return validateSupportedTestFiles(discoveredFiles.filter(file =>
			!Object.values(unitRuntimeSourceRoots)
				.filter(runtimeRoots => runtimeRoots !== unitRuntimeSourceRoots.node)
				.flat()
				.some(runtimeRoot => file === runtimeRoot || file.startsWith(`${runtimeRoot}/`)),
		));
	}

	return validateSupportedTestFiles(discoveredFiles);
}

export function compiledTestPath(sourceFile, outputDirectory, rootDir = process.cwd()) {
	const absoluteSource = path.resolve(rootDir, sourceFile);
	const relativePath = path.relative(rootDir, absoluteSource);
	if (isPathOutsideRoot(relativePath)) {
		throw new Error(`Test source is outside the repository: ${sourceFile}`);
	}

	return path.resolve(outputDirectory, relativePath.replace(/\.ts$/, '.js'));
}

export function spawnExitCode(result) {
	if (result.error) {
		throw result.error;
	}

	if (typeof result.status === 'number') {
		return result.status;
	}

	if (result.signal) {
		throw new Error(`Test process terminated by ${result.signal}`);
	}

	throw new Error('Test process ended without a status or signal');
}

async function loadTypeScriptProjectFiles(project, rootDir) {
	const configPath = path.resolve(rootDir, project.config);
	const configText = await readFile(configPath, 'utf8');
	const config = ts.parseConfigFileTextToJson(configPath, configText);
	if (config.error) {
		throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
	}

	const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath));
	if (parsed.errors.length > 0) {
		throw new Error(
			parsed.errors
				.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
				.join('\n'),
		);
	}

	return new Set(parsed.fileNames.map(fileName => path.normalize(path.resolve(fileName))));
}

export async function validateTestProjectOwnership(testFiles, rootDir = process.cwd()) {
	const projectFiles = new Map();
	for (const project of unitTypeScriptProjects) {
		projectFiles.set(project.id, await loadTypeScriptProjectFiles(project, rootDir));
	}

	const errors = [];
	for (const testFile of testFiles) {
		const absoluteFile = path.normalize(path.resolve(rootDir, testFile));
		const owners = unitTypeScriptProjects.filter(project => projectFiles.get(project.id).has(absoluteFile));
		if (owners.length !== 1) {
			errors.push(
				`Test source must belong to exactly one TypeScript project: ${testFile} (${owners.map(owner => owner.id).join(', ') || 'none'})`,
			);
		}
	}

	if (errors.length > 0) {
		throw new Error(errors.join('\n'));
	}
}
