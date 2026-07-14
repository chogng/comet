/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { RemoteCapabilityId, RemoteProtocolVersion } from './remoteAuthority.js';
import { RemoteError, RemoteErrorCode } from './remoteErrors.js';

export type RemoteOperatingSystem = 'linux' | 'macOS' | 'windows';
export type RemotePathCasePolicy = 'sensitive' | 'insensitive';

export interface IRemoteTransportLimits {
	readonly maximumFrameBytes: number;
	readonly maximumPendingCalls: number;
	readonly maximumEventListeners: number;
}

export interface IRemoteEnvironment {
	readonly protocolVersion: RemoteProtocolVersion;
	readonly operatingSystem: RemoteOperatingSystem;
	readonly architecture: string;
	readonly userHome: string;
	readonly temporaryDirectory: string;
	readonly storageDirectory: string;
	readonly pathCasePolicy: RemotePathCasePolicy;
	readonly capabilities: readonly RemoteCapabilityId[];
	readonly limits: IRemoteTransportLimits;
}

const windowsDrivePathPattern = /^[A-Za-z]:[\\/]/;
const windowsUncPathPattern = /^\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$)/;

function assertAbsolutePath(value: string, field: string, operatingSystem: RemoteOperatingSystem): void {
	const absolute = operatingSystem === 'windows'
		? windowsDrivePathPattern.test(value) || windowsUncPathPattern.test(value)
		: value.startsWith('/');
	if (!absolute || value.length > 4096 || value.includes('\0')) {
		throw new RemoteError(RemoteErrorCode.InvalidEnvironment, 'Invalid Remote environment path', {
			field,
		});
	}
}

function assertLimit(value: number, field: string, maximum: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new RemoteError(RemoteErrorCode.InvalidEnvironment, 'Invalid Remote transport limit', {
			field,
			value,
		});
	}
}

export function validateRemoteEnvironment(environment: IRemoteEnvironment): IRemoteEnvironment {
	if (environment.architecture.length === 0 || environment.architecture.length > 64) {
		throw new RemoteError(RemoteErrorCode.InvalidEnvironment, 'Invalid Remote architecture', {
			field: 'architecture',
		});
	}

	assertAbsolutePath(environment.userHome, 'userHome', environment.operatingSystem);
	assertAbsolutePath(environment.temporaryDirectory, 'temporaryDirectory', environment.operatingSystem);
	assertAbsolutePath(environment.storageDirectory, 'storageDirectory', environment.operatingSystem);
	assertLimit(environment.limits.maximumFrameBytes, 'maximumFrameBytes', 16 * 1024 * 1024);
	assertLimit(environment.limits.maximumPendingCalls, 'maximumPendingCalls', 65536);
	assertLimit(environment.limits.maximumEventListeners, 'maximumEventListeners', 65536);

	const capabilities = new Set<RemoteCapabilityId>();
	for (const capability of environment.capabilities) {
		if (capabilities.has(capability)) {
			throw new RemoteError(RemoteErrorCode.InvalidEnvironment, 'Duplicate Remote capability', {
				capability,
			});
		}
		capabilities.add(capability);
	}

	return Object.freeze({
		...environment,
		capabilities: Object.freeze([...environment.capabilities]),
		limits: Object.freeze({ ...environment.limits }),
	});
}
