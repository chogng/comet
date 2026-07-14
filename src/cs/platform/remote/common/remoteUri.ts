/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'cs/base/common/network';
import { URI } from 'cs/base/common/uri';
import {
	formatRemoteAuthority,
	IRemoteAuthority,
	isEqualRemoteAuthority,
	parseRemoteAuthority,
} from './remoteAuthority.js';
import { RemoteError, RemoteErrorCode } from './remoteErrors.js';

export interface IRemoteResourceIdentity {
	readonly authority: IRemoteAuthority;
	readonly path: string;
	readonly query: string;
	readonly fragment: string;
}

function validateRemotePath(path: string): void {
	if (!path.startsWith('/') || path.length > 16 * 1024 || path.includes('\0')) {
		throw new RemoteError(RemoteErrorCode.InvalidAuthority, 'Invalid Remote resource path', {
			path: path.slice(0, 256),
		});
	}
}

export function createRemoteResourceUri(identity: IRemoteResourceIdentity): URI {
	validateRemotePath(identity.path);
	return URI.from({
		scheme: Schemas.vscodeRemote,
		authority: formatRemoteAuthority(identity.authority),
		path: identity.path,
		query: identity.query,
		fragment: identity.fragment,
	});
}

export function parseRemoteResourceUri(resource: URI): IRemoteResourceIdentity {
	if (resource.scheme !== Schemas.vscodeRemote) {
		throw new RemoteError(RemoteErrorCode.InvalidAuthority, 'Resource is not Remote-owned', {
			scheme: resource.scheme,
		});
	}

	validateRemotePath(resource.path);
	return Object.freeze({
		authority: parseRemoteAuthority(resource.authority),
		path: resource.path,
		query: resource.query,
		fragment: resource.fragment,
	});
}

export function assertRemoteResourceAuthority(resource: URI, authority: IRemoteAuthority): IRemoteResourceIdentity {
	const identity = parseRemoteResourceUri(resource);
	if (!isEqualRemoteAuthority(identity.authority, authority)) {
		throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Remote resource belongs to another authority', {
			expected: formatRemoteAuthority(authority),
			received: formatRemoteAuthority(identity.authority),
		});
	}

	return identity;
}

/** Transforms only at the client/server resource serialization boundary. */
export class RemoteUriTransformer {
	constructor(readonly authority: IRemoteAuthority) {}

	toServerIdentity(resource: URI): IRemoteResourceIdentity {
		return assertRemoteResourceAuthority(resource, this.authority);
	}

	toClientResource(identity: IRemoteResourceIdentity): URI {
		if (!isEqualRemoteAuthority(identity.authority, this.authority)) {
			throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Remote identity belongs to another authority', {
				expected: formatRemoteAuthority(this.authority),
				received: formatRemoteAuthority(identity.authority),
			});
		}

		return createRemoteResourceUri(identity);
	}
}
