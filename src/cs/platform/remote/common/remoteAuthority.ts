/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { RemoteError, RemoteErrorCode } from './remoteErrors.js';

declare const remoteIdentityBrand: unique symbol;

type RemoteIdentity<TName extends string> = string & { readonly [remoteIdentityBrand]: TName };
type RemoteCounter<TName extends string> = number & { readonly [remoteIdentityBrand]: TName };

export type RemoteAuthorityKind = RemoteIdentity<'RemoteAuthorityKind'>;
export type RemoteAuthorityName = RemoteIdentity<'RemoteAuthorityName'>;
export type RemoteEndpointKind = RemoteIdentity<'RemoteEndpointKind'>;
export type RemoteEndpointAddress = RemoteIdentity<'RemoteEndpointAddress'>;
export type RemoteCredential = RemoteIdentity<'RemoteCredential'>;
export type RemoteClientId = RemoteIdentity<'RemoteClientId'>;
export type RemoteServerInstanceId = RemoteIdentity<'RemoteServerInstanceId'>;
export type RemoteProtocolVersion = RemoteIdentity<'RemoteProtocolVersion'>;
export type RemoteCapabilityId = RemoteIdentity<'RemoteCapabilityId'>;
export type RemoteChannelName = RemoteIdentity<'RemoteChannelName'>;
export type RemoteConnectionGeneration = RemoteCounter<'RemoteConnectionGeneration'>;

export interface IRemoteAuthority {
	readonly kind: RemoteAuthorityKind;
	readonly name: RemoteAuthorityName;
}

export interface IRemoteResolvedEndpoint {
	readonly authority: IRemoteAuthority;
	readonly kind: RemoteEndpointKind;
	readonly address: RemoteEndpointAddress;
	readonly credential: RemoteCredential;
	readonly trusted: boolean;
}

export interface IRemoteAuthorityResolver {
	readonly kind: RemoteAuthorityKind;
	resolve(authority: IRemoteAuthority): Promise<IRemoteResolvedEndpoint>;
}

export interface IRemoteAuthorityResolverService {
	resolve(authority: IRemoteAuthority): Promise<IRemoteResolvedEndpoint>;
}

const kindPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const namePattern = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const opaquePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const channelPattern = /^[A-Za-z][A-Za-z0-9._-]*$/;
const protocolPattern = /^[1-9][0-9]*$/;

function assertIdentity(value: string, identity: string, maximumLength: number, pattern: RegExp): string {
	if (value.length === 0 || value.length > maximumLength || !pattern.test(value)) {
		throw new RemoteError(RemoteErrorCode.InvalidAuthority, `Invalid ${identity}`, {
			identity,
			value: value.slice(0, 256),
		});
	}

	return value;
}

function createOpaqueIdentity<TName extends string>(value: string, identity: TName): RemoteIdentity<TName> {
	return assertIdentity(value, identity, 256, opaquePattern) as RemoteIdentity<TName>;
}

export function createRemoteAuthorityKind(value: string): RemoteAuthorityKind {
	return assertIdentity(value, 'RemoteAuthorityKind', 64, kindPattern) as RemoteAuthorityKind;
}

export function createRemoteAuthorityName(value: string): RemoteAuthorityName {
	return assertIdentity(value, 'RemoteAuthorityName', 192, namePattern) as RemoteAuthorityName;
}

export function createRemoteAuthority(kind: string, name: string): IRemoteAuthority {
	return Object.freeze({
		kind: createRemoteAuthorityKind(kind),
		name: createRemoteAuthorityName(name),
	});
}

export function parseRemoteAuthority(value: string): IRemoteAuthority {
	const separator = value.indexOf('+');
	if (separator <= 0 || separator === value.length - 1 || value.indexOf('+', separator + 1) !== -1) {
		throw new RemoteError(RemoteErrorCode.InvalidAuthority, 'Malformed Remote authority', {
			value: value.slice(0, 256),
		});
	}

	return createRemoteAuthority(value.slice(0, separator), value.slice(separator + 1));
}

export function formatRemoteAuthority(authority: IRemoteAuthority): string {
	return `${authority.kind}+${authority.name}`;
}

export function isEqualRemoteAuthority(first: IRemoteAuthority, second: IRemoteAuthority): boolean {
	return first.kind === second.kind && first.name === second.name;
}

export function createRemoteEndpointKind(value: string): RemoteEndpointKind {
	return assertIdentity(value, 'RemoteEndpointKind', 64, kindPattern) as RemoteEndpointKind;
}

export function createRemoteEndpointAddress(value: string): RemoteEndpointAddress {
	return createOpaqueIdentity(value, 'RemoteEndpointAddress');
}

export function createRemoteCredential(value: string): RemoteCredential {
	return createOpaqueIdentity(value, 'RemoteCredential');
}

export function createRemoteClientId(value: string): RemoteClientId {
	return createOpaqueIdentity(value, 'RemoteClientId');
}

export function createRemoteServerInstanceId(value: string): RemoteServerInstanceId {
	return createOpaqueIdentity(value, 'RemoteServerInstanceId');
}

export function createRemoteProtocolVersion(value: string): RemoteProtocolVersion {
	return assertIdentity(value, 'RemoteProtocolVersion', 16, protocolPattern) as RemoteProtocolVersion;
}

export function createRemoteCapabilityId(value: string): RemoteCapabilityId {
	return assertIdentity(value, 'RemoteCapabilityId', 128, channelPattern) as RemoteCapabilityId;
}

export function createRemoteChannelName(value: string): RemoteChannelName {
	return assertIdentity(value, 'RemoteChannelName', 128, channelPattern) as RemoteChannelName;
}

export function createRemoteConnectionGeneration(value: number): RemoteConnectionGeneration {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RemoteError(RemoteErrorCode.GenerationConflict, 'Invalid Remote connection generation', {
			generation: value,
		});
	}

	return value as RemoteConnectionGeneration;
}

/** Resolves each authority through its one exact registered kind. */
export class RemoteAuthorityResolverRegistry extends Disposable implements IRemoteAuthorityResolverService {
	private readonly resolvers = new Map<RemoteAuthorityKind, IRemoteAuthorityResolver>();
	private disposed = false;

	register(resolver: IRemoteAuthorityResolver): IDisposable {
		if (this.disposed) {
			throw new RemoteError(RemoteErrorCode.ResolverMissing, 'Remote authority resolver registry is disposed');
		}
		if (this.resolvers.has(resolver.kind)) {
			throw new RemoteError(RemoteErrorCode.DuplicateResolver, 'Remote authority resolver already registered', {
				kind: resolver.kind,
			});
		}

		this.resolvers.set(resolver.kind, resolver);
		return toDisposable(() => {
			if (this.resolvers.get(resolver.kind) === resolver) {
				this.resolvers.delete(resolver.kind);
			}
		});
	}

	async resolve(authority: IRemoteAuthority): Promise<IRemoteResolvedEndpoint> {
		if (this.disposed) {
			throw new RemoteError(RemoteErrorCode.ResolverMissing, 'Remote authority resolver registry is disposed');
		}
		const resolver = this.resolvers.get(authority.kind);
		if (!resolver) {
			throw new RemoteError(RemoteErrorCode.ResolverMissing, 'Remote authority resolver is not registered', {
				kind: authority.kind,
			});
		}

		const endpoint = await resolver.resolve(authority);
		if (!isEqualRemoteAuthority(endpoint.authority, authority)) {
			throw new RemoteError(RemoteErrorCode.ResolutionMismatch, 'Remote resolver returned another authority', {
				expected: formatRemoteAuthority(authority),
				received: formatRemoteAuthority(endpoint.authority),
			});
		}

		return Object.freeze({
			...endpoint,
			authority: Object.freeze({ ...endpoint.authority }),
		});
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.resolvers.clear();
		super.dispose();
	}
}
