/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import {
	chmod,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	realpath,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	createAgentPackageContentDigest,
	type AgentPackageContentDigest,
	type AgentPackageOperationId,
} from 'cs/platform/agentHost/common/identities';
import { AgentPackageError, AgentPackageErrorCode } from 'cs/platform/agentHost/common/packageErrors';
import type {
	IAgentPackageManifest,
	IAgentPackageOffering,
	IAgentPackagePersistedState,
	IInstalledAgentPackage,
	IVerifiedAgentPackageDependency,
} from 'cs/platform/agentHost/common/packages';
import { encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type { IAgentRuntimeInstalledArtifactPort } from 'cs/platform/agentHost/common/runtimeSandbox';
import type { IAgentPackageArtifactPort } from 'cs/platform/agentHost/node/packages/agentPackageLifecycle';
import type { IVerifiedAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageTypes';
import { validateAndFreezeAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageValidation';

const localArtifactStoreSchema = 1;
const localArtifactStoreVersionDirectory = 'v1';
const localArtifactReceiptFile = 'authority.json';

function offeringKey(offering: IAgentPackageOffering): string {
	return encodeAgentHostProtocolValue(offering);
}

function offeringFromInstalledPackage(installedPackage: IInstalledAgentPackage): IAgentPackageOffering {
	return Object.freeze({
		packageId: installedPackage.packageId,
		revision: installedPackage.revision,
		contentDigest: installedPackage.contentDigest,
		source: installedPackage.source,
		distribution: installedPackage.distribution,
	});
}

function artifactAuthorityKey(offering: IAgentPackageOffering): string {
	return createHash('sha256').update(offeringKey(offering)).digest('hex');
}

export interface ILocalAgentPackageArtifactFile {
	readonly source: string;
	readonly contentDigest: AgentPackageContentDigest;
}

export interface ILocalAgentPackageContentArtifact {
	readonly target: string;
	readonly contentDigest: AgentPackageContentDigest;
}

export interface ILocalAgentPackageArtifactPortOptions {
	readonly storageRoot: string;
	readonly packages: readonly IVerifiedAgentPackage[];
}

interface ILocalAgentPackageArtifactAuthority {
	readonly packageId: IAgentPackageManifest['packageId'];
	readonly manifest: IAgentPackageManifest;
	readonly dependencyClosure: readonly IVerifiedAgentPackageDependency[];
}

interface ILocalAgentPackageArtifactReceipt {
	readonly schema: typeof localArtifactStoreSchema;
	readonly verifiedPackage: IVerifiedAgentPackage;
}

interface IVerifiedLocalArtifact {
	readonly path: string;
	readonly bytes: Uint8Array;
}

interface IPublishedLocalAgentPackageReceipt {
	readonly verifiedPackage: IVerifiedAgentPackage;
	readonly created: boolean;
}

interface IStagedLocalAgentPackageReceipt extends IPublishedLocalAgentPackageReceipt {
	readonly offering: string;
}

function invalidArtifact(
	message: string,
	packageId?: IAgentPackageManifest['packageId'],
	expected?: string,
	actual?: string,
): AgentPackageError {
	return new AgentPackageError(
		AgentPackageErrorCode.InvalidPackage,
		message,
		{
			...(packageId === undefined ? {} : { packageId }),
			...(expected === undefined ? {} : { expected }),
			...(actual === undefined ? {} : { actual }),
		},
	);
}

async function readRegularArtifact(
	artifactPath: string,
	packageId?: IAgentPackageManifest['packageId'],
): Promise<IVerifiedLocalArtifact> {
	let metadata;
	try {
		metadata = await lstat(artifactPath);
	} catch {
		throw invalidArtifact('Agent package artifact does not exist', packageId);
	}
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw invalidArtifact('Agent package artifact must be a regular file', packageId);
	}
	const canonicalPath = await realpath(artifactPath);
	const bytes = await readFile(canonicalPath);
	if (bytes.byteLength === 0) {
		throw invalidArtifact('Agent package artifact is empty', packageId);
	}
	return Object.freeze({ path: canonicalPath, bytes });
}

function digest(bytes: Uint8Array): AgentPackageContentDigest {
	return createAgentPackageContentDigest(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
}

function assertInsideDirectory(candidate: string, directory: string, packageId: IAgentPackageManifest['packageId']): void {
	const relative = path.relative(directory, candidate);
	if (relative.length === 0 || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
		throw invalidArtifact('Agent package artifact is outside its immutable package receipt', packageId);
	}
}

/** Derives the only local artifact authority accepted by the desktop package catalog. */
export async function createLocalAgentPackageArtifactFile(
	artifactPath: string,
): Promise<ILocalAgentPackageArtifactFile> {
	const artifact = await readRegularArtifact(artifactPath);
	return Object.freeze({
		source: pathToFileURL(artifact.path).toString(),
		contentDigest: digest(artifact.bytes),
	});
}

/** Computes one package root digest from its ordered target-to-content closure. */
export function createLocalAgentPackageContentDigest(
	artifacts: readonly ILocalAgentPackageContentArtifact[],
): AgentPackageContentDigest {
	if (artifacts.length === 0 || new Set(artifacts.map(artifact => artifact.target)).size !== artifacts.length) {
		throw new Error('Local Agent package content closure must contain unique targets.');
	}
	const encoded = encodeAgentHostProtocolValue(Object.freeze(artifacts.map(artifact => Object.freeze({
		target: artifact.target,
		contentDigest: artifact.contentDigest,
	}))));
	return createAgentPackageContentDigest(`sha256:${createHash('sha256').update(encoded).digest('hex')}`);
}

async function verifyDependency(
	packageId: IAgentPackageManifest['packageId'],
	dependency: IVerifiedAgentPackageDependency,
	expectedDirectory?: string,
): Promise<IVerifiedLocalArtifact> {
	let source: URL;
	try {
		source = new URL(dependency.source);
	} catch {
		throw invalidArtifact('Agent package dependency source is not an absolute URL', packageId);
	}
	if (source.protocol !== 'file:') {
		throw invalidArtifact('Desktop Agent package dependency source must be a local file URL', packageId);
	}
	const artifact = await readRegularArtifact(fileURLToPath(source), packageId);
	if (expectedDirectory !== undefined) {
		assertInsideDirectory(artifact.path, expectedDirectory, packageId);
	}
	const actualDigest = digest(artifact.bytes);
	if (actualDigest !== dependency.digest || actualDigest !== dependency.verifiedDigest) {
		throw invalidArtifact(
			'Agent package dependency bytes do not match the verified digest',
			packageId,
			dependency.verifiedDigest,
			actualDigest,
		);
	}
	return artifact;
}

async function verifyLocalArtifactAuthority(
	value: ILocalAgentPackageArtifactAuthority,
	expectedDirectory?: string,
): Promise<ReadonlyMap<string, IVerifiedLocalArtifact>> {
	if (value.manifest.packageId !== value.packageId) {
		throw invalidArtifact('Agent package artifact authority has mismatched package identity', value.packageId);
	}
	const declaredById = new Map(value.manifest.dependencies.map(dependency => [dependency.id, dependency]));
	if (
		declaredById.size !== value.manifest.dependencies.length
		|| value.dependencyClosure.length !== value.manifest.dependencies.length
	) {
		throw invalidArtifact('Agent package artifact authority has an incomplete dependency closure', value.packageId);
	}
	const artifactsById = new Map<string, IVerifiedLocalArtifact>();
	const targets = new Set<string>();
	for (const dependency of value.dependencyClosure) {
		const declared = declaredById.get(dependency.id);
		if (
			declared === undefined
			|| encodeAgentHostProtocolValue(declared) !== encodeAgentHostProtocolValue({
				id: dependency.id,
				source: dependency.source,
				target: dependency.target,
				digest: dependency.digest,
				license: dependency.license,
				executable: dependency.executable,
			})
			|| dependency.immutable !== true
			|| artifactsById.has(dependency.id)
			|| targets.has(dependency.target)
		) {
			throw invalidArtifact('Agent package dependency authority does not match its manifest', value.packageId);
		}
		artifactsById.set(
			dependency.id,
			await verifyDependency(value.packageId, dependency, expectedDirectory),
		);
		targets.add(dependency.target);
	}
	if (
		value.manifest.execution.kind === 'connected'
		&& !targets.has(value.manifest.execution.entryPoint)
	) {
		throw invalidArtifact('Connected Agent package entry point has no verified dependency', value.packageId);
	}
	return artifactsById;
}

function parseReceipt(bytes: Uint8Array, packageId: IAgentPackageManifest['packageId']): ILocalAgentPackageArtifactReceipt {
	let value: unknown;
	try {
		value = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw invalidArtifact('Agent package immutable authorization receipt is invalid', packageId);
	}
	if (
		value === null
		|| typeof value !== 'object'
		|| Array.isArray(value)
		|| Object.keys(value).length !== 2
		|| !Object.hasOwn(value, 'schema')
		|| !Object.hasOwn(value, 'verifiedPackage')
		|| (value as { readonly schema?: unknown }).schema !== localArtifactStoreSchema
	) {
		throw invalidArtifact('Agent package immutable authorization receipt is invalid', packageId);
	}
	return value as ILocalAgentPackageArtifactReceipt;
}

function safeArtifactExtension(target: string): string {
	const extension = path.extname(target);
	return /^\.[a-zA-Z0-9]{1,10}$/.test(extension) ? extension : '.bin';
}

function storedArtifactName(dependency: IVerifiedAgentPackageDependency, index: number): string {
	const identity = createHash('sha256')
		.update(encodeAgentHostProtocolValue({ id: dependency.id, target: dependency.target }))
		.digest('hex')
		.slice(0, 24);
	return `${index}-${identity}${safeArtifactExtension(dependency.target)}`;
}

function referencedInstalledPackages(state: IAgentPackagePersistedState): readonly IInstalledAgentPackage[] {
	const packages = new Map<string, IInstalledAgentPackage>();
	const retain = (installedPackage: IInstalledAgentPackage | undefined): void => {
		if (installedPackage !== undefined && installedPackage.distribution === 'user') {
			packages.set(offeringKey(offeringFromInstalledPackage(installedPackage)), installedPackage);
		}
	};
	for (const installedPackage of state.installedPackages) {
		retain(installedPackage);
	}
	for (const operation of state.operations) {
		if (
			operation.status === 'succeeded'
			|| (operation.status === 'failed' && operation.failure.reconciliation !== 'sameOperationRequired')
			|| operation.phase === 'recorded'
		) {
			continue;
		}
		retain(operation.activationTransition.previous?.installedPackage);
		retain(operation.activationTransition.next?.installedPackage);
	}
	return Object.freeze([...packages.values()]);
}

/** Owns immutable, product-authorized local package receipts and their dependency closures. */
export class LocalAgentPackageArtifactPort implements IAgentPackageArtifactPort, IAgentRuntimeInstalledArtifactPort {
	private readonly packages: ReadonlyMap<string, IVerifiedAgentPackage>;
	private readonly storageRoot: string;
	private readonly stagedReceipts = new Map<AgentPackageOperationId, IStagedLocalAgentPackageReceipt>();

	constructor(options: ILocalAgentPackageArtifactPortOptions) {
		if (!path.isAbsolute(options.storageRoot)) {
			throw new Error('Local Agent package artifact storage root must be absolute.');
		}
		const entries = options.packages.map(candidate => [offeringKey(candidate.offering), candidate] as const);
		if (new Set(entries.map(([key]) => key)).size !== entries.length) {
			throw new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Product Agent package artifact catalog contains a duplicate offering',
			);
		}
		this.packages = new Map(entries);
		this.storageRoot = path.resolve(options.storageRoot);
	}

	async stage(
		offering: IAgentPackageOffering,
		operationId: AgentPackageOperationId,
	): Promise<IVerifiedAgentPackage> {
		const existingStage = this.stagedReceipts.get(operationId);
		if (existingStage !== undefined) {
			if (existingStage.offering !== offeringKey(offering)) {
				throw new AgentPackageError(
					AgentPackageErrorCode.OperationConflict,
					'Agent package operation already owns another immutable artifact receipt',
					{ operationId },
				);
			}
			await this.authorizeVerifiedPackage(existingStage.verifiedPackage);
			return existingStage.verifiedPackage;
		}
		const verifiedPackage = this.packages.get(offeringKey(offering));
		if (verifiedPackage === undefined) {
			throw new AgentPackageError(
				AgentPackageErrorCode.PackageNotInstallable,
				'Agent package offering is not present in the exact product artifact catalog',
				{ packageId: offering.packageId },
			);
		}
		validateAndFreezeAgentPackage(verifiedPackage, verifiedPackage.manifest.target);
		const sourceArtifacts = await verifyLocalArtifactAuthority({
			packageId: verifiedPackage.offering.packageId,
			manifest: verifiedPackage.manifest,
			dependencyClosure: verifiedPackage.dependencyClosure,
		});
		const published = await this.publishImmutableReceipt(verifiedPackage, sourceArtifacts);
		this.stagedReceipts.set(operationId, Object.freeze({
			...published,
			offering: offeringKey(offering),
		}));
		return published.verifiedPackage;
	}

	async discard(
		verifiedPackage: IVerifiedAgentPackage,
		operationId: AgentPackageOperationId,
	): Promise<void> {
		const staged = this.stagedReceipts.get(operationId);
		if (
			staged === undefined
			|| encodeAgentHostProtocolValue(staged.verifiedPackage) !== encodeAgentHostProtocolValue(verifiedPackage)
		) {
			throw invalidArtifact(
				'Cannot discard an Agent package outside its exact operation-owned immutable receipt',
				verifiedPackage.offering.packageId,
			);
		}
		if (staged.created) {
			await this.removeReceiptDirectory(
				await this.resolveReceiptDirectory(verifiedPackage.offering),
			);
		}
		this.stagedReceipts.delete(operationId);
	}

	async authorizeInstalledPackage(installedPackage: IInstalledAgentPackage): Promise<void> {
		await this.resolveAuthorizedInstalledPackage(installedPackage);
	}

	async resolveRuntimeEntryPoint(installedPackage: IInstalledAgentPackage): Promise<string> {
		if (installedPackage.manifest.execution.kind !== 'connected') {
			throw invalidArtifact('Host Agent package has no connected entry point', installedPackage.packageId);
		}
		const entryPoint = installedPackage.manifest.execution.entryPoint;
		const artifactsById = await this.resolveAuthorizedInstalledPackage(installedPackage);
		const runtimeDependency = installedPackage.dependencyClosure.find(dependency => (
			dependency.target === entryPoint
		));
		if (runtimeDependency === undefined) {
			throw invalidArtifact('Connected Agent package entry point has no verified dependency', installedPackage.packageId);
		}
		return artifactsById.get(runtimeDependency.id)!.path;
	}

	async reconcile(state: IAgentPackagePersistedState): Promise<void> {
		const retainedPackages = referencedInstalledPackages(state);
		const retainedKeys = new Set<string>();
		const unresolvedOperationIds = new Set(state.operations.flatMap(operation => (
			operation.status === 'pending'
			|| (operation.status === 'failed' && operation.failure.reconciliation === 'sameOperationRequired')
				? [operation.operation]
				: []
		)));
		for (const operationId of this.stagedReceipts.keys()) {
			if (!unresolvedOperationIds.has(operationId)) {
				this.stagedReceipts.delete(operationId);
			}
		}
		for (const installedPackage of retainedPackages) {
			await this.authorizeInstalledPackage(installedPackage);
			retainedKeys.add(artifactAuthorityKey(offeringFromInstalledPackage(installedPackage)));
		}

		const versionRoot = await this.ensureVersionRoot();
		for (const entry of await readdir(versionRoot, { withFileTypes: true })) {
			const entryPath = path.join(versionRoot, entry.name);
			if (entry.isSymbolicLink() || !entry.isDirectory()) {
				throw invalidArtifact('Agent package artifact store contains an invalid entry');
			}
			if (entry.name.startsWith('.staging-') || !retainedKeys.has(entry.name)) {
				await this.removeReceiptDirectory(entryPath);
			}
		}
	}

	private async publishImmutableReceipt(
		verifiedPackage: IVerifiedAgentPackage,
		sourceArtifacts: ReadonlyMap<string, IVerifiedLocalArtifact>,
	): Promise<IPublishedLocalAgentPackageReceipt> {
		const versionRoot = await this.ensureVersionRoot();
		const finalDirectory = this.receiptDirectory(verifiedPackage.offering, versionRoot);
		const temporaryDirectory = await mkdtemp(path.join(versionRoot, '.staging-'));
		let published = false;
		try {
			const dependencies: IAgentPackageManifest['dependencies'][number][] = [];
			const closure: IVerifiedAgentPackageDependency[] = [];
			for (const [index, declared] of verifiedPackage.manifest.dependencies.entries()) {
				const verified = verifiedPackage.dependencyClosure.find(candidate => candidate.id === declared.id);
				const artifact = sourceArtifacts.get(declared.id);
				if (verified === undefined || artifact === undefined) {
					throw invalidArtifact('Agent package artifact authority has an incomplete dependency closure', verifiedPackage.offering.packageId);
				}
				const artifactName = storedArtifactName(verified, index);
				const temporaryPath = path.join(temporaryDirectory, artifactName);
				const finalPath = path.join(finalDirectory, artifactName);
				const mode = declared.executable ? 0o500 : 0o400;
				await writeFile(temporaryPath, artifact.bytes, { flag: 'wx', mode });
				await chmod(temporaryPath, mode);
				const source = pathToFileURL(finalPath).toString();
				dependencies.push(Object.freeze({ ...declared, source }));
				closure.push(Object.freeze({ ...verified, source }));
			}

			const staged: IVerifiedAgentPackage = Object.freeze({
				offering: verifiedPackage.offering,
				manifest: Object.freeze({
					...verifiedPackage.manifest,
					dependencies: Object.freeze(dependencies),
				}),
				dependencyClosure: Object.freeze(closure),
				grantedPrivileges: verifiedPackage.grantedPrivileges,
			});
			validateAndFreezeAgentPackage(staged, staged.manifest.target);
			const receipt: ILocalAgentPackageArtifactReceipt = Object.freeze({
				schema: localArtifactStoreSchema,
				verifiedPackage: staged,
			});
			const receiptPath = path.join(temporaryDirectory, localArtifactReceiptFile);
			await writeFile(receiptPath, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
			await chmod(receiptPath, 0o400);
			try {
				await rename(temporaryDirectory, finalDirectory);
				published = true;
				await chmod(finalDirectory, 0o500);
			} catch (error) {
				if (!this.isExistingDirectoryError(error)) {
					throw error;
				}
				const existingDirectory = await this.resolveReceiptDirectory(verifiedPackage.offering);
				const existing = await this.readReceipt(verifiedPackage.offering, existingDirectory);
				if (encodeAgentHostProtocolValue(existing) !== encodeAgentHostProtocolValue(staged)) {
					throw invalidArtifact(
						'Agent package immutable authorization receipt conflicts with the staged product',
						verifiedPackage.offering.packageId,
					);
				}
				await verifyLocalArtifactAuthority({
					packageId: existing.offering.packageId,
					manifest: existing.manifest,
					dependencyClosure: existing.dependencyClosure,
				}, existingDirectory);
			}
			return Object.freeze({ verifiedPackage: staged, created: published });
		} finally {
			if (!published) {
				await this.removeReceiptDirectory(temporaryDirectory);
			}
		}
	}

	private async resolveAuthorizedInstalledPackage(
		installedPackage: IInstalledAgentPackage,
	): Promise<ReadonlyMap<string, IVerifiedLocalArtifact>> {
		const offering = offeringFromInstalledPackage(installedPackage);
		const directory = await this.resolveReceiptDirectory(offering);
		const receipt = await this.readReceipt(offering, directory);
		const expected = validateAndFreezeAgentPackage(receipt, installedPackage.manifest.target);
		if (encodeAgentHostProtocolValue(expected) !== encodeAgentHostProtocolValue(installedPackage)) {
			throw invalidArtifact(
				'Installed Agent package does not match its immutable product authorization receipt',
				installedPackage.packageId,
			);
		}
		return verifyLocalArtifactAuthority({
			packageId: receipt.offering.packageId,
			manifest: receipt.manifest,
			dependencyClosure: receipt.dependencyClosure,
		}, directory);
	}

	private async authorizeVerifiedPackage(verifiedPackage: IVerifiedAgentPackage): Promise<void> {
		const installedPackage = validateAndFreezeAgentPackage(
			verifiedPackage,
			verifiedPackage.manifest.target,
		);
		await this.resolveAuthorizedInstalledPackage(installedPackage);
	}

	private async readReceipt(
		offering: IAgentPackageOffering,
		directory: string,
	): Promise<IVerifiedAgentPackage> {
		const receiptPath = path.join(directory, localArtifactReceiptFile);
		const receiptArtifact = await readRegularArtifact(receiptPath, offering.packageId);
		const receipt = parseReceipt(receiptArtifact.bytes, offering.packageId);
		if (offeringKey(receipt.verifiedPackage.offering) !== offeringKey(offering)) {
			throw invalidArtifact('Agent package immutable authorization receipt has the wrong address', offering.packageId);
		}
		return receipt.verifiedPackage;
	}

	private async resolveReceiptDirectory(offering: IAgentPackageOffering): Promise<string> {
		const canonicalVersionRoot = await this.resolveVersionRoot(offering.packageId);
		const directory = this.receiptDirectory(offering, canonicalVersionRoot);
		let metadata;
		try {
			metadata = await lstat(directory);
		} catch {
			throw invalidArtifact('Agent package artifact does not exist', offering.packageId);
		}
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw invalidArtifact('Agent package immutable authorization receipt directory is invalid', offering.packageId);
		}
		const canonicalDirectory = await realpath(directory);
		assertInsideDirectory(canonicalDirectory, canonicalVersionRoot, offering.packageId);
		if (path.dirname(canonicalDirectory) !== canonicalVersionRoot) {
			throw invalidArtifact('Agent package immutable authorization receipt has the wrong store parent', offering.packageId);
		}
		return canonicalDirectory;
	}

	private async ensureVersionRoot(): Promise<string> {
		await mkdir(this.storageRoot, { recursive: true, mode: 0o700 });
		await this.resolveStorageRoot();
		await mkdir(this.versionRoot(), { recursive: true, mode: 0o700 });
		return this.resolveVersionRoot();
	}

	private async resolveStorageRoot(packageId?: IAgentPackageManifest['packageId']): Promise<string> {
		let metadata;
		try {
			metadata = await lstat(this.storageRoot);
		} catch {
			throw invalidArtifact('Agent package artifact does not exist', packageId);
		}
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw invalidArtifact('Agent package artifact storage root must be a real directory', packageId);
		}
		return realpath(this.storageRoot);
	}

	private async resolveVersionRoot(packageId?: IAgentPackageManifest['packageId']): Promise<string> {
		const canonicalStorageRoot = await this.resolveStorageRoot(packageId);
		const versionRoot = this.versionRoot();
		let metadata;
		try {
			metadata = await lstat(versionRoot);
		} catch {
			throw invalidArtifact('Agent package artifact does not exist', packageId);
		}
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw invalidArtifact('Agent package artifact version root must be a real directory', packageId);
		}
		const canonicalVersionRoot = await realpath(versionRoot);
		if (canonicalVersionRoot !== path.join(canonicalStorageRoot, localArtifactStoreVersionDirectory)) {
			throw invalidArtifact('Agent package artifact version root has the wrong canonical address', packageId);
		}
		return canonicalVersionRoot;
	}

	private versionRoot(): string {
		return path.join(this.storageRoot, localArtifactStoreVersionDirectory);
	}

	private receiptDirectory(offering: IAgentPackageOffering, versionRoot = this.versionRoot()): string {
		return path.join(versionRoot, artifactAuthorityKey(offering));
	}

	private async removeReceiptDirectory(directory: string): Promise<void> {
		let metadata;
		try {
			metadata = await lstat(directory);
		} catch {
			throw invalidArtifact('Agent package artifact does not exist');
		}
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw invalidArtifact('Agent package artifact removal requires a real receipt directory');
		}
		await chmod(directory, 0o700);
		await rm(directory, { recursive: true, force: true });
	}

	private isExistingDirectoryError(error: unknown): boolean {
		if (error === null || typeof error !== 'object' || !('code' in error)) {
			return false;
		}
		return error.code === 'EEXIST' || error.code === 'ENOTEMPTY';
	}
}
