/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const AgentPackageErrorCode = {
	InvalidPackage: 'invalidPackage',
	PackageNotInstallable: 'packageNotInstallable',
	PackageAlreadyInstalled: 'packageAlreadyInstalled',
	PackageNotInstalled: 'packageNotInstalled',
	BundledPackageMutationDenied: 'bundledPackageMutationDenied',
	IncompleteDependencyClosure: 'incompleteDependencyClosure',
	RegistrationInvalid: 'registrationInvalid',
	AgentIdConflict: 'agentIdConflict',
	CrossPackageAgentClaim: 'crossPackageAgentClaim',
	ResumeSchemaIncompatible: 'resumeSchemaIncompatible',
	OperationConflict: 'operationConflict',
	OperationNotFound: 'operationNotFound',
	AgentDataDeletionDenied: 'agentDataDeletionDenied',
	HostRecordPurgeDenied: 'hostRecordPurgeDenied',
	StateConflict: 'stateConflict',
} as const;

export type AgentPackageErrorCode = typeof AgentPackageErrorCode[keyof typeof AgentPackageErrorCode];

export interface IAgentPackageErrorData {
	readonly packageId?: string;
	readonly agentId?: string;
	readonly operationId?: string;
	readonly record?: string;
	readonly expected?: string | number;
	readonly actual?: string | number;
	readonly revision?: number;
	readonly catalogRevision?: number;
	readonly affectedRecords?: number;
	readonly remainingRecords?: number;
}

export class AgentPackageError extends Error {
	constructor(
		readonly code: AgentPackageErrorCode,
		message: string,
		readonly data: IAgentPackageErrorData = {},
	) {
		super(message);
		this.name = 'AgentPackageError';
	}
}
