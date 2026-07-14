/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fsPromises } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import * as esbuild from 'esbuild';

import { resolveProjectPath } from './util.ts';

type PackageJson = {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
};

const serverSourceRoot = resolveProjectPath('src', 'cs', 'server', 'node', 'agentHost');
const distServerDir = resolveProjectPath('dist-server');
const entryPoints = [
	path.join(serverSourceRoot, 'remoteAgentHostMain.ts'),
	path.join(serverSourceRoot, 'remoteTunnelAgentHostMain.ts'),
];
const projectAliases = {
	app: resolveProjectPath('src'),
	base: resolveProjectPath('src', 'cs', 'base'),
	code: resolveProjectPath('src', 'cs', 'code'),
	editor: resolveProjectPath('src', 'cs', 'editor'),
	language: resolveProjectPath('build', 'lib'),
	cs: resolveProjectPath('src', 'cs'),
	platform: resolveProjectPath('src', 'cs', 'platform'),
	workbench: resolveProjectPath('src', 'cs', 'workbench'),
};

async function readPackageJson(): Promise<PackageJson> {
	const contents = await fsPromises.readFile(resolveProjectPath('package.json'), 'utf8');
	return JSON.parse(contents) as PackageJson;
}

export async function createServerBuildOptions(): Promise<esbuild.BuildOptions> {
	const packageJson = await readPackageJson();
	const packageNames = [
		...Object.keys(packageJson.dependencies),
		...Object.keys(packageJson.devDependencies),
	];
	const builtinExternals = builtinModules.flatMap(moduleName => [moduleName, `node:${moduleName}`]);

	return {
		absWorkingDir: resolveProjectPath(),
		alias: projectAliases,
		bundle: true,
		entryPoints,
		external: [...builtinExternals, ...packageNames],
		format: 'esm',
		logLevel: 'info',
		outbase: serverSourceRoot,
		outdir: distServerDir,
		packages: 'external',
		platform: 'node',
		sourcemap: true,
		target: 'node20',
	} satisfies esbuild.BuildOptions;
}

export async function buildServer(): Promise<void> {
	await fsPromises.rm(distServerDir, { force: true, recursive: true });
	await esbuild.build(await createServerBuildOptions());
}
