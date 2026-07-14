/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { createMockAgentPackageProducts } from 'cs/code/common/agentHost/test/mockAgentPackages';
import {
	createLocalAgentPackageArtifactFile,
	LocalAgentPackageArtifactPort,
} from 'cs/code/electron-main/agentHost/localAgentPackageArtifactPort';
import {
	createAgentHostPayloadDigest,
	createAgentPackageOperationId,
} from 'cs/platform/agentHost/common/identities';
import { AgentPackageError, AgentPackageErrorCode } from 'cs/platform/agentHost/common/packageErrors';
import type { IAgentPackagePersistedState } from 'cs/platform/agentHost/common/packages';
import { validateAndFreezeAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageValidation';

function packageState(
	installedPackages: IAgentPackagePersistedState['installedPackages'],
	operations: IAgentPackagePersistedState['operations'] = Object.freeze([]),
): IAgentPackagePersistedState {
	return Object.freeze({
		revision: 1,
		catalogRevision: 1,
		operations,
		installedPackages,
		activeRegistrations: Object.freeze([]),
		retainedBackingRecords: Object.freeze([]),
		materializedBackings: Object.freeze([]),
	});
}

async function makeDirectoriesWritable(directory: string): Promise<void> {
	await chmod(directory, 0o700);
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isDirectory() && !entry.isSymbolicLink()) {
			await makeDirectoriesWritable(path.join(directory, entry.name));
		}
	}
}

async function removeTestRoot(root: string): Promise<void> {
	await makeDirectoriesWritable(root);
	await rm(root, { recursive: true, force: true });
}

test('local Agent package authority hashes, re-reads, and launches the exact runtime dependency bytes', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'comet-agent-package-artifact-'));
	try {
		const runtimePath = path.join(root, 'mock-agent-runtime.js');
		const runtimeBytes = new TextEncoder().encode('export const runtime = "verified";');
		await writeFile(runtimePath, runtimeBytes);
		const artifact = await createLocalAgentPackageArtifactFile(runtimePath);
		assert.equal(
			artifact.contentDigest,
			`sha256:${createHash('sha256').update(runtimeBytes).digest('hex')}`,
		);

		const target = Object.freeze({ operatingSystem: 'test', architecture: 'x64' });
		const product = createMockAgentPackageProducts(target, artifact)[0];
		assert.equal(product.verifiedPackage.manifest.contentDigest, artifact.contentDigest);
		assert.equal(product.verifiedPackage.manifest.dependencies[0].digest, artifact.contentDigest);
		assert.equal(product.verifiedPackage.dependencyClosure[0].verifiedDigest, artifact.contentDigest);

		const storageRoot = path.join(root, 'installed-packages');
		const artifacts = new LocalAgentPackageArtifactPort({
			storageRoot,
			packages: [product.verifiedPackage],
		});
		const staged = await artifacts.stage(
			product.offering,
			createAgentPackageOperationId('install-verified-mock'),
		);
		const installed = validateAndFreezeAgentPackage(staged, target);
		const installedEntryPoint = await artifacts.resolveRuntimeEntryPoint(installed);
		assert.notEqual(installedEntryPoint, await realpath(runtimePath));
		assert.deepEqual(await readFile(installedEntryPoint), Buffer.from(runtimeBytes));
		await artifacts.authorizeInstalledPackage(installed);

		await writeFile(runtimePath, 'export const runtime = "tampered";');
		await assert.rejects(
			artifacts.stage(product.offering, createAgentPackageOperationId('install-tampered-mock')),
			error => (
				error instanceof AgentPackageError
				&& error.code === AgentPackageErrorCode.InvalidPackage
				&& /bytes do not match/.test(error.message)
			),
		);
		assert.equal(await artifacts.resolveRuntimeEntryPoint(installed), installedEntryPoint);

		const nextArtifact = await createLocalAgentPackageArtifactFile(runtimePath);
		const nextProduct = createMockAgentPackageProducts(target, nextArtifact)[0];
		const restartedArtifacts = new LocalAgentPackageArtifactPort({
			storageRoot,
			packages: [nextProduct.verifiedPackage],
		});
		await restartedArtifacts.authorizeInstalledPackage(installed);
		assert.equal(await restartedArtifacts.resolveRuntimeEntryPoint(installed), installedEntryPoint);
		assert.notEqual(nextProduct.offering.contentDigest, installed.contentDigest);

		const storedPath = fileURLToPath(installed.dependencyClosure[0].source);
		await chmod(storedPath, 0o600);
		await writeFile(storedPath, 'export const runtime = "receipt-tampered";');
		await assert.rejects(
			restartedArtifacts.authorizeInstalledPackage(installed),
			/bytes do not match/,
		);
	} finally {
		await removeTestRoot(root);
	}
});

test('local Agent package authority rejects a runtime entry point without one verified dependency', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'comet-agent-package-entry-'));
	try {
		const runtimePath = path.join(root, 'mock-agent-runtime.js');
		await writeFile(runtimePath, 'export {};');
		const artifact = await createLocalAgentPackageArtifactFile(runtimePath);
		const product = createMockAgentPackageProducts(
			{ operatingSystem: 'test', architecture: 'x64' },
			artifact,
		)[0];
		const invalidPackage = Object.freeze({
			...product.verifiedPackage,
			manifest: Object.freeze({
				...product.verifiedPackage.manifest,
				runtimeEntryPoint: 'another-runtime.js',
			}),
		});
		const artifacts = new LocalAgentPackageArtifactPort({
			storageRoot: path.join(root, 'installed-packages'),
			packages: [invalidPackage],
		});
		await assert.rejects(
			artifacts.stage(product.offering, createAgentPackageOperationId('install-missing-runtime')),
			/runtime entry point has no verified dependency/,
		);
	} finally {
		await removeTestRoot(root);
	}
});

test('local Agent package cold authorization rejects an installed record without a product receipt', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'comet-agent-package-receipt-'));
	try {
		const runtimePath = path.join(root, 'mock-agent-runtime.js');
		await writeFile(runtimePath, 'export {};');
		const target = { operatingSystem: 'test', architecture: 'x64' };
		const product = createMockAgentPackageProducts(
			target,
			await createLocalAgentPackageArtifactFile(runtimePath),
		)[0];
		const artifacts = new LocalAgentPackageArtifactPort({
			storageRoot: path.join(root, 'installed-packages'),
			packages: [product.verifiedPackage],
		});
		const installedWithoutReceipt = validateAndFreezeAgentPackage(product.verifiedPackage, target);
		await assert.rejects(
			artifacts.authorizeInstalledPackage(installedWithoutReceipt),
			/artifact does not exist/,
		);
	} finally {
		await removeTestRoot(root);
	}
});

test('local Agent package staging rejects symlinked store roots before writing their targets', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'comet-agent-package-root-symlink-'));
	try {
		const runtimePath = path.join(root, 'mock-agent-runtime.js');
		await writeFile(runtimePath, 'export {};');
		const product = createMockAgentPackageProducts(
			Object.freeze({ operatingSystem: 'test', architecture: 'x64' }),
			await createLocalAgentPackageArtifactFile(runtimePath),
		)[0];
		const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';

		const externalStorageRoot = path.join(root, 'external-storage-root');
		const symlinkedStorageRoot = path.join(root, 'symlinked-storage-root');
		await mkdir(externalStorageRoot, { mode: 0o700 });
		await symlink(externalStorageRoot, symlinkedStorageRoot, symlinkType);
		const storageRootArtifacts = new LocalAgentPackageArtifactPort({
			storageRoot: symlinkedStorageRoot,
			packages: [product.verifiedPackage],
		});
		await assert.rejects(
			storageRootArtifacts.stage(
				product.offering,
				createAgentPackageOperationId('install-through-storage-root-symlink'),
			),
			/storage root must be a real directory/,
		);
		assert.deepEqual(await readdir(externalStorageRoot), []);

		const storageRoot = path.join(root, 'storage-root');
		const externalVersionRoot = path.join(root, 'external-version-root');
		await mkdir(storageRoot, { mode: 0o700 });
		await mkdir(externalVersionRoot, { mode: 0o700 });
		await symlink(externalVersionRoot, path.join(storageRoot, 'v1'), symlinkType);
		const versionRootArtifacts = new LocalAgentPackageArtifactPort({
			storageRoot,
			packages: [product.verifiedPackage],
		});
		await assert.rejects(
			versionRootArtifacts.stage(
				product.offering,
				createAgentPackageOperationId('install-through-version-root-symlink'),
			),
			/version root must be a real directory/,
		);
		assert.deepEqual(await readdir(externalVersionRoot), []);
	} finally {
		await removeTestRoot(root);
	}
});

test('local Agent package discard is owned by the exact staging operation', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'comet-agent-package-discard-'));
	try {
		const runtimePath = path.join(root, 'mock-agent-runtime.js');
		await writeFile(runtimePath, 'export {};');
		const target = Object.freeze({ operatingSystem: 'test', architecture: 'x64' });
		const product = createMockAgentPackageProducts(
			target,
			await createLocalAgentPackageArtifactFile(runtimePath),
		)[0];
		const artifacts = new LocalAgentPackageArtifactPort({
			storageRoot: path.join(root, 'installed-packages'),
			packages: [product.verifiedPackage],
		});
		const operation = createAgentPackageOperationId('install-owned-receipt');
		const staged = await artifacts.stage(product.offering, operation);
		const installed = validateAndFreezeAgentPackage(staged, target);

		await assert.rejects(
			artifacts.discard(staged, createAgentPackageOperationId('another-operation')),
			error => (
				error instanceof AgentPackageError
				&& error.code === AgentPackageErrorCode.InvalidPackage
				&& /operation-owned/.test(error.message)
			),
		);
		await artifacts.authorizeInstalledPackage(installed);

		await artifacts.discard(staged, operation);
		await assert.rejects(
			artifacts.authorizeInstalledPackage(installed),
			/artifact does not exist/,
		);
	} finally {
		await removeTestRoot(root);
	}
});

test('local Agent package discard rejects a symlinked receipt without changing its target', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'comet-agent-package-discard-symlink-'));
	try {
		const runtimePath = path.join(root, 'mock-agent-runtime.js');
		await writeFile(runtimePath, 'export {};');
		const target = Object.freeze({ operatingSystem: 'test', architecture: 'x64' });
		const product = createMockAgentPackageProducts(
			target,
			await createLocalAgentPackageArtifactFile(runtimePath),
		)[0];
		const artifacts = new LocalAgentPackageArtifactPort({
			storageRoot: path.join(root, 'installed-packages'),
			packages: [product.verifiedPackage],
		});
		const operation = createAgentPackageOperationId('discard-symlinked-receipt');
		const staged = await artifacts.stage(product.offering, operation);
		const receiptDirectory = path.dirname(fileURLToPath(staged.dependencyClosure[0].source));
		await chmod(receiptDirectory, 0o700);
		await rm(receiptDirectory, { recursive: true, force: true });

		const externalTarget = path.join(root, 'external-discard-target');
		await mkdir(externalTarget, { mode: 0o700 });
		await writeFile(path.join(externalTarget, 'marker'), 'unchanged');
		await chmod(externalTarget, 0o500);
		await symlink(
			externalTarget,
			receiptDirectory,
			process.platform === 'win32' ? 'junction' : 'dir',
		);

		await assert.rejects(
			artifacts.discard(staged, operation),
			/receipt directory is invalid/,
		);
		if (process.platform !== 'win32') {
			assert.equal((await stat(externalTarget)).mode & 0o777, 0o500);
		}
		assert.equal(await readFile(path.join(externalTarget, 'marker'), 'utf8'), 'unchanged');
	} finally {
		await removeTestRoot(root);
	}
});

test('local Agent package reconciliation retains unresolved revisions and collects terminal artifacts', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'comet-agent-package-reconcile-'));
	try {
		const firstRuntimePath = path.join(root, 'mock-agent-runtime-v1.js');
		const secondRuntimePath = path.join(root, 'mock-agent-runtime-v2.js');
		await writeFile(firstRuntimePath, 'export const revision = 1;');
		await writeFile(secondRuntimePath, 'export const revision = 2;');
		const target = Object.freeze({ operatingSystem: 'test', architecture: 'x64' });
		const firstProduct = createMockAgentPackageProducts(
			target,
			await createLocalAgentPackageArtifactFile(firstRuntimePath),
		)[0];
		const secondProduct = createMockAgentPackageProducts(
			target,
			await createLocalAgentPackageArtifactFile(secondRuntimePath),
		)[0];
		const storageRoot = path.join(root, 'installed-packages');
		const artifacts = new LocalAgentPackageArtifactPort({
			storageRoot,
			packages: [firstProduct.verifiedPackage, secondProduct.verifiedPackage],
		});

		const firstStaged = await artifacts.stage(
			firstProduct.offering,
			createAgentPackageOperationId('install-first-revision'),
		);
		const firstInstalled = validateAndFreezeAgentPackage(firstStaged, target);
		await artifacts.reconcile(packageState(Object.freeze([firstInstalled])));

		const updateOperation = createAgentPackageOperationId('update-second-revision');
		const secondStaged = await artifacts.stage(secondProduct.offering, updateOperation);
		const secondInstalled = validateAndFreezeAgentPackage(secondStaged, target);
		const pendingUpdate = Object.freeze({
			operation: updateOperation,
			digest: createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`),
			kind: 'update' as const,
			packageId: firstInstalled.packageId,
			affectedRecords: null,
			status: 'pending' as const,
			phase: 'runtimePrepared' as const,
			runtimeTransition: Object.freeze({
				previous: Object.freeze({ installedPackage: firstInstalled, registrations: Object.freeze([]) }),
				next: Object.freeze({ installedPackage: secondInstalled, registrations: Object.freeze([]) }),
			}),
		});
		await artifacts.reconcile(packageState(
			Object.freeze([firstInstalled]),
			Object.freeze([pendingUpdate]),
		));
		await artifacts.authorizeInstalledPackage(firstInstalled);
		await artifacts.authorizeInstalledPackage(secondInstalled);

		await artifacts.reconcile(packageState(Object.freeze([secondInstalled])));
		await assert.rejects(
			artifacts.authorizeInstalledPackage(firstInstalled),
			/artifact does not exist/,
		);
		await artifacts.authorizeInstalledPackage(secondInstalled);

		await artifacts.reconcile(packageState(Object.freeze([])));
		await assert.rejects(
			artifacts.authorizeInstalledPackage(secondInstalled),
			/artifact does not exist/,
		);

		const orphaned = validateAndFreezeAgentPackage(
			await artifacts.stage(
				firstProduct.offering,
				createAgentPackageOperationId('orphaned-install'),
			),
			target,
		);
		const restartedArtifacts = new LocalAgentPackageArtifactPort({
			storageRoot,
			packages: [secondProduct.verifiedPackage],
		});
		await restartedArtifacts.reconcile(packageState(Object.freeze([])));
		await assert.rejects(
			restartedArtifacts.authorizeInstalledPackage(orphaned),
			/artifact does not exist/,
		);
	} finally {
		await removeTestRoot(root);
	}
});
