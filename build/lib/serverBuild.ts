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

export async function createServerBuildOptions(projectRoot = resolveProjectPath()): Promise<esbuild.BuildOptions> {
	const resolvePath = (...segments: string[]) => path.join(projectRoot, ...segments);
	const serverSourceRoot = resolvePath('src', 'cs', 'server', 'node', 'agentHost');
	const distServerDir = resolvePath('dist-server');
	const entryPoints = [
		path.join(serverSourceRoot, 'remoteAgentHostMain.ts'),
		path.join(serverSourceRoot, 'remoteTunnelAgentHostMain.ts'),
	];
	const projectAliases = {
		app: resolvePath('src'),
		base: resolvePath('src', 'cs', 'base'),
		code: resolvePath('src', 'cs', 'code'),
		editor: resolvePath('src', 'cs', 'editor'),
		language: resolvePath('build', 'lib'),
		cs: resolvePath('src', 'cs'),
		platform: resolvePath('src', 'cs', 'platform'),
		workbench: resolvePath('src', 'cs', 'workbench'),
	};
	const contents = await fsPromises.readFile(resolvePath('package.json'), 'utf8');
	const packageJson = JSON.parse(contents) as PackageJson;
	const packageNames = [
		...Object.keys(packageJson.dependencies),
		...Object.keys(packageJson.devDependencies),
	];
	const builtinExternals = builtinModules.flatMap(moduleName => [moduleName, `node:${moduleName}`]);

	return {
		absWorkingDir: projectRoot,
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
	const distServerDir = resolveProjectPath('dist-server');
	await fsPromises.rm(distServerDir, { force: true, recursive: true });
	await esbuild.build(await createServerBuildOptions());
}
