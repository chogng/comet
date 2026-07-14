import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as esbuild from 'esbuild';

import { projectRoot, resolveProjectPath } from '../lib/util.ts';

const claudePackageRoot = resolveProjectPath('build', 'agent-sdk', 'agents', 'claude');
const outputRoot = resolveProjectPath('dist-agent-sdk', 'claude');

function sdkTarget(): string {
	if (!['darwin', 'linux', 'win32'].includes(process.platform)) {
		throw new Error(`Claude Agent SDK does not support ${process.platform}.`);
	}
	if (!['arm64', 'x64'].includes(process.arch)) {
		throw new Error(`Claude Agent SDK does not support ${process.arch}.`);
	}
	return `${process.platform}-${process.arch}`;
}

function platformPackage(target: string): string {
	return `claude-agent-sdk-${target}`;
}

async function runNpmCi(): Promise<void> {
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const cache = resolveProjectPath('.build', 'npm-cache');
	await fs.mkdir(cache, { recursive: true });
	await new Promise<void>((resolve, reject) => {
		const child = spawn(npm, ['ci', '--ignore-scripts', '--cache', cache], {
			cwd: claudePackageRoot,
			stdio: 'inherit',
			shell: process.platform === 'win32',
		});
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`Claude Agent SDK npm ci exited with ${signal ?? code}.`));
		});
	});
}

/** Produces the immutable executable input consumed by the desktop Agent package catalog. */
export async function packageAgentSdks(): Promise<void> {
	const packageJson = JSON.parse(await fs.readFile(path.join(claudePackageRoot, 'package.json'), 'utf8')) as {
		readonly dependencies: Readonly<Record<string, string>>;
	};
	const rootPackageJson = JSON.parse(await fs.readFile(resolveProjectPath('package.json'), 'utf8')) as {
		readonly devDependencies: Readonly<Record<string, string>>;
	};
	const version = packageJson.dependencies['@anthropic-ai/claude-agent-sdk'];
	if (
		typeof version !== 'string'
		|| !/^\d+\.\d+\.\d+$/.test(version)
		|| rootPackageJson.devDependencies['@anthropic-ai/claude-agent-sdk'] !== version
	) {
		throw new Error('Claude Agent SDK build and application versions must use the same exact pin.');
	}
	await runNpmCi();
	const target = sdkTarget();
	const executableName = process.platform === 'win32' ? 'claude.exe' : 'claude';
	const source = path.join(
		claudePackageRoot,
		'node_modules',
		'@anthropic-ai',
		platformPackage(target),
		executableName,
	);
	const bytes = await fs.readFile(source);
	if (bytes.byteLength === 0) {
		throw new Error(`Claude Agent SDK produced an empty ${target} executable.`);
	}
	const targetRoot = path.join(outputRoot, target);
	const destination = path.join(targetRoot, executableName);
	await fs.rm(outputRoot, { recursive: true, force: true });
	await fs.mkdir(targetRoot, { recursive: true });
	await fs.writeFile(destination, bytes, { mode: 0o500 });
	await fs.chmod(destination, 0o500);
	const sdkModule = path.join(targetRoot, 'sdk.js');
	await esbuild.build({
		absWorkingDir: claudePackageRoot,
		bundle: true,
		entryPoints: [path.join(claudePackageRoot, 'entry.ts')],
		external: ['node:*'],
		format: 'esm',
		logLevel: 'info',
		outfile: sdkModule,
		platform: 'node',
		target: 'node20',
	});
	const sdkModuleBytes = await fs.readFile(sdkModule);
	await fs.writeFile(path.join(targetRoot, 'artifact.json'), `${JSON.stringify({
		name: '@anthropic-ai/claude-agent-sdk',
		version,
		target,
		executableSha256: createHash('sha256').update(bytes).digest('hex'),
		moduleSha256: createHash('sha256').update(sdkModuleBytes).digest('hex'),
	}, null, 2)}\n`);
	console.log(`[agent-sdk] packaged Claude ${version} for ${target} from ${path.relative(projectRoot, source)}`);
}

if (import.meta.filename === process.argv[1]) {
	await packageAgentSdks();
}
