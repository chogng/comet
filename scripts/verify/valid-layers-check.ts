/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
interface ISourceImport {
	readonly specifier: string;
	readonly line: number;
}

export interface ILayerCheckOptions {
	readonly sourceRoot: string;
	readonly compilerOptions: ts.CompilerOptions;
}

function toPosixPath(value: string): string {
	return value.split(path.sep).join('/');
}

function collectSourceFiles(directory: string): readonly string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (entry.name !== 'test' && entry.name !== 'tests') {
				files.push(...collectSourceFiles(path.join(directory, entry.name)));
			}
			continue;
		}
		if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
			files.push(path.join(directory, entry.name));
		}
	}
	return files;
}

function collectImports(file: string): readonly ISourceImport[] {
	const sourceText = readFileSync(file, 'utf8');
	const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
	const imports: ISourceImport[] = [];
	const addImport = (specifier: ts.Expression | undefined): void => {
		if (!specifier || !ts.isStringLiteralLike(specifier)) {
			return;
		}
		imports.push({
			specifier: specifier.text,
			line: sourceFile.getLineAndCharacterOfPosition(specifier.getStart(sourceFile)).line + 1,
		});
	};
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
			addImport(node.moduleSpecifier);
		} else if (ts.isImportEqualsDeclaration(node)
			&& ts.isExternalModuleReference(node.moduleReference)) {
			addImport(node.moduleReference.expression);
		} else if (ts.isCallExpression(node) && node.arguments.length > 0) {
			if (node.expression.kind === ts.SyntaxKind.ImportKeyword
				|| ts.isIdentifier(node.expression) && node.expression.text === 'require') {
				addImport(node.arguments[0]);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return imports;
}

function stripTypeScriptExtension(value: string): string {
	return value
		.replace(/\.d\.(?:cts|mts|ts)$/u, '')
		.replace(/\.(?:cts|mts|tsx|ts)$/u, '');
}

function resolveImportTarget(
	file: string,
	specifier: string,
	sourceRoot: string,
	compilerOptions: ts.CompilerOptions,
	moduleResolutionCache: ts.ModuleResolutionCache,
): string | undefined {
	if (!specifier.startsWith('.')) {
		return specifier;
	}

	const resolved = ts.resolveModuleName(
		specifier,
		file,
		compilerOptions,
		ts.sys,
		moduleResolutionCache,
	).resolvedModule?.resolvedFileName;
	if (!resolved) {
		return undefined;
	}

	const relativeTarget = path.relative(sourceRoot, resolved);
	if (relativeTarget === '..'
		|| relativeTarget.startsWith(`..${path.sep}`)
		|| path.isAbsolute(relativeTarget)) {
		return undefined;
	}

	return `cs/${stripTypeScriptExtension(toPosixPath(relativeTarget))}`;
}

function providerName(relativeFile: string): string | undefined {
	return /^sessions\/contrib\/providers\/([^/]+)\//u.exec(relativeFile)?.[1];
}

export function findLayerViolations(options: ILayerCheckOptions): readonly string[] {
	const sourceRoot = path.resolve(options.sourceRoot);
	const compilerOptions = options.compilerOptions;
	const moduleResolutionCache = ts.createModuleResolutionCache(
		sourceRoot,
		value => value,
		compilerOptions,
	);
	const violations: string[] = [];
	const report = (relativeFile: string, imported: ISourceImport, rule: string): void => {
		violations.push(`${relativeFile}:${imported.line}: ${rule}: ${imported.specifier}`);
	};

	for (const file of collectSourceFiles(sourceRoot)) {
		const relativeFile = toPosixPath(path.relative(sourceRoot, file));
		for (const imported of collectImports(file)) {
			const target = resolveImportTarget(
				file,
				imported.specifier,
				sourceRoot,
				compilerOptions,
				moduleResolutionCache,
			);
			if (!target) {
				continue;
			}
			if (/^(?:base|platform|editor|workbench)\//u.test(relativeFile)
				&& target.startsWith('cs/sessions/')) {
				report(relativeFile, imported, 'lower cs layers must not import Sessions');
			}
			if (relativeFile.startsWith('sessions/common/')
				&& target.startsWith('cs/sessions/')
				&& !target.startsWith('cs/sessions/common/')) {
				report(relativeFile, imported, 'Sessions common may import only Sessions common');
			}
			if (relativeFile.startsWith('sessions/services/')
				&& /^cs\/sessions\/(?:browser|electron-browser|node|contrib)(?:\/|$)/u.test(target)) {
				report(relativeFile, imported, 'Sessions services must not import shell, runtime, or contributions');
			}
			if (/^sessions\/(?:browser|electron-browser)\//u.test(relativeFile)
				&& target.startsWith('cs/sessions/contrib/')) {
				report(relativeFile, imported, 'Sessions core shell must not import contributions');
			}
			if (relativeFile.startsWith('sessions/contrib/')
				&& !relativeFile.startsWith('sessions/contrib/providers/')
				&& target.startsWith('cs/sessions/contrib/providers/')) {
				report(relativeFile, imported, 'Sessions feature contributions must not import providers');
			}

			const currentProvider = providerName(relativeFile);
			if (currentProvider) {
				if (/^cs\/sessions\/(?:browser|electron-browser)(?:\/|$)/u.test(target)) {
					report(relativeFile, imported, 'Sessions providers must not import the core shell');
				}
				const importedProvider = /^cs\/sessions\/contrib\/providers\/([^/]+)\//u.exec(target)?.[1];
				if (importedProvider && importedProvider !== currentProvider) {
					report(relativeFile, imported, 'Sessions providers must not import sibling providers');
				}
			}

			const isSessionsEntrypoint = /^sessions\/sessions\.(?:common|desktop|web)\.main\.ts$/u.test(relativeFile);
			if (!isSessionsEntrypoint
				&& target.startsWith('cs/sessions/contrib/')
				&& target.endsWith('.contribution')) {
				report(relativeFile, imported, 'only Sessions entry points may load contribution entry points');
			}
		}
	}

	return violations;
}

function loadCompilerOptions(repositoryRoot: string): ts.CompilerOptions {
	const configPath = ts.findConfigFile(repositoryRoot, ts.sys.fileExists, 'tsconfig.json');
	if (!configPath) {
		throw new Error(`TypeScript configuration was not found under '${repositoryRoot}'.`);
	}
	const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
	if (loaded.error) {
		throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'));
	}
	const parsed = ts.parseJsonConfigFileContent(
		loaded.config,
		ts.sys,
		path.dirname(configPath),
		undefined,
		configPath,
	);
	if (parsed.errors.length > 0) {
		throw new Error(parsed.errors
			.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
			.join('\n'));
	}
	return parsed.options;
}

function runRepositoryLayerCheck(): void {
	const repositoryRoot = process.cwd();
	const violations = findLayerViolations({
		sourceRoot: path.join(repositoryRoot, 'src/cs'),
		compilerOptions: loadCompilerOptions(repositoryRoot),
	});
	if (violations.length > 0) {
		console.error(['Sessions layer violations:', ...violations.map(violation => `- ${violation}`)].join('\n'));
		process.exitCode = 1;
		return;
	}
	console.log('Sessions layer check passed.');
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedFile === fileURLToPath(import.meta.url)) {
	runRepositoryLayerCheck();
}
