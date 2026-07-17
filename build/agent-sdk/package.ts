import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import * as esbuild from 'esbuild';

import { projectRoot, resolveProjectPath } from '../lib/util.ts';
import { verifyCodexProtocolSources } from './codexProtocol.ts';

const agentSdkRoot = resolveProjectPath('build', 'agent-sdk', 'agents');
const outputRoot = resolveProjectPath('dist-agent-sdk');

function sdkTarget(agent: 'Claude' | 'Codex'): string {
	if (!['darwin', 'linux', 'win32'].includes(process.platform)) {
		throw new Error(`${agent} Agent SDK does not support ${process.platform}.`);
	}
	if (!['arm64', 'x64'].includes(process.arch)) {
		throw new Error(`${agent} Agent SDK does not support ${process.arch}.`);
	}
	return `${process.platform}-${process.arch}`;
}

function platformPackage(target: string): string {
	return `claude-agent-sdk-${target}`;
}

async function runNpmCi(packageRoot: string, displayName: string): Promise<void> {
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const cache = resolveProjectPath('.build', 'npm-cache');
	await fs.mkdir(cache, { recursive: true });
	await new Promise<void>((resolve, reject) => {
		const child = spawn(npm, ['ci', '--ignore-scripts', '--cache', cache], {
			cwd: packageRoot,
			stdio: 'inherit',
			shell: process.platform === 'win32',
		});
		child.once('error', reject);
		child.once('exit', (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(new Error(`${displayName} SDK npm ci exited with ${signal ?? code}.`));
		});
	});
}

async function packageClaudeAgentSdk(): Promise<void> {
	const claudePackageRoot = path.join(agentSdkRoot, 'claude');
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
	await runNpmCi(claudePackageRoot, 'Claude Agent');
	const target = sdkTarget('Claude');
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
	const agentOutputRoot = path.join(outputRoot, 'claude');
	const targetRoot = path.join(agentOutputRoot, target);
	const destination = path.join(targetRoot, executableName);
	await fs.rm(agentOutputRoot, { recursive: true, force: true });
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

function codexBinaryTriple(target: string): string {
	switch (target) {
		case 'linux-x64': return 'x86_64-unknown-linux-musl';
		case 'linux-arm64': return 'aarch64-unknown-linux-musl';
		case 'darwin-x64': return 'x86_64-apple-darwin';
		case 'darwin-arm64': return 'aarch64-apple-darwin';
		case 'win32-x64': return 'x86_64-pc-windows-msvc';
		case 'win32-arm64': return 'aarch64-pc-windows-msvc';
	}
	throw new Error(`Codex SDK has no executable triple for ${target}.`);
}

async function packageCodexAgentSdk(): Promise<void> {
	const codexPackageRoot = path.join(agentSdkRoot, 'codex');
	const packageJson = JSON.parse(await fs.readFile(path.join(codexPackageRoot, 'package.json'), 'utf8')) as {
		readonly dependencies: Readonly<Record<string, string>>;
	};
	const version = packageJson.dependencies['@openai/codex'];
	if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
		throw new Error('Codex SDK build must use an exact version pin.');
	}
	await runNpmCi(codexPackageRoot, 'Codex');
	const protocol = await verifyCodexProtocolSources();
	if (protocol.sdkVersion !== version) {
		throw new Error('Codex SDK artifact version does not match its generated protocol.');
	}
	const target = sdkTarget('Codex');
	const executableName = process.platform === 'win32' ? 'codex.exe' : 'codex';
	const source = path.join(
		codexPackageRoot,
		'node_modules',
		'@openai',
		`codex-${target}`,
		'vendor',
		codexBinaryTriple(target),
		'bin',
		executableName,
	);
	const bytes = await fs.readFile(source);
	if (bytes.byteLength === 0) {
		throw new Error(`Codex SDK produced an empty ${target} executable.`);
	}
	const agentOutputRoot = path.join(outputRoot, 'codex');
	const targetRoot = path.join(agentOutputRoot, target);
	const destination = path.join(targetRoot, executableName);
	await fs.rm(agentOutputRoot, { recursive: true, force: true });
	await fs.mkdir(targetRoot, { recursive: true });
	await fs.writeFile(destination, bytes, { mode: 0o500 });
	await fs.chmod(destination, 0o500);
	const protocolManifestBytes = Buffer.from(`${JSON.stringify({
		schema: 1,
		name: 'codex-app-server-protocol',
		sdkVersion: protocol.sdkVersion,
		sourceDigest: protocol.sourceDigest,
		fileCount: protocol.fileCount,
	}, null, 2)}\n`);
	await fs.writeFile(path.join(targetRoot, 'protocol.json'), protocolManifestBytes);
	await fs.writeFile(path.join(targetRoot, 'artifact.json'), `${JSON.stringify({
		name: '@openai/codex',
		version,
		target,
		executableSha256: createHash('sha256').update(bytes).digest('hex'),
		protocolManifestSha256: createHash('sha256').update(protocolManifestBytes).digest('hex'),
	}, null, 2)}\n`);
	console.log(`[agent-sdk] packaged Codex ${version} for ${target} from ${path.relative(projectRoot, source)}`);
}

/** Produces every immutable SDK input consumed by the desktop Agent package catalog. */
export async function packageAgentSdks(): Promise<void> {
	await Promise.all([
		packageClaudeAgentSdk(),
		packageCodexAgentSdk(),
	]);
}

if (import.meta.filename === process.argv[1]) {
	await packageAgentSdks();
}
