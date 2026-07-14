/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { Schemas } from 'cs/base/common/network';
import { URI } from 'cs/base/common/uri';
import {
	createRemoteAuthority,
	createRemoteCapabilityId,
	createRemoteCredential,
	createRemoteEndpointAddress,
	createRemoteEndpointKind,
	createRemoteProtocolVersion,
	formatRemoteAuthority,
	parseRemoteAuthority,
	RemoteAuthorityResolverRegistry,
	type IRemoteAuthority,
	type IRemoteAuthorityResolver,
	type IRemoteResolvedEndpoint,
} from 'cs/platform/remote/common/remoteAuthority';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';
import { validateRemoteEnvironment } from 'cs/platform/remote/common/remoteEnvironment';
import {
	assertRemoteResourceAuthority,
	createRemoteResourceUri,
	parseRemoteResourceUri,
	RemoteUriTransformer,
} from 'cs/platform/remote/common/remoteUri';

class TestResolver implements IRemoteAuthorityResolver {
	readonly kind;

	constructor(
		readonly authority: IRemoteAuthority,
		private readonly endpointAuthority = authority,
	) {
		this.kind = authority.kind;
	}

	async resolve(): Promise<IRemoteResolvedEndpoint> {
		return {
			authority: this.endpointAuthority,
			kind: createRemoteEndpointKind('mock'),
			address: createRemoteEndpointAddress('remote.test/server'),
			credential: createRemoteCredential('credential.test'),
			trusted: true,
		};
	}
}

suite('Remote authority and resource identity', { concurrency: false }, () => {
	test('selects exactly one resolver by authority kind', async context => {
		const registry = new RemoteAuthorityResolverRegistry();
		context.after(() => registry.dispose());
		const authority = createRemoteAuthority('mock', 'server.alpha');
		const registration = registry.register(new TestResolver(authority));
		context.after(() => registration.dispose());

		const resolved = await registry.resolve(authority);
		assert.equal(formatRemoteAuthority(resolved.authority), 'mock+server.alpha');
		assert.throws(
			() => registry.register(new TestResolver(createRemoteAuthority('mock', 'server.beta'))),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.DuplicateResolver,
		);
		await assert.rejects(
			registry.resolve(createRemoteAuthority('ssh', 'server.alpha')),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ResolverMissing,
		);
	});

	test('rejects malformed authorities and resolver identity substitution', async context => {
		for (const value of ['', 'mock', '+server', 'mock+', 'mock+server+extra', 'Mock+server', 'mock+server/name']) {
			assert.throws(
				() => parseRemoteAuthority(value),
				(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.InvalidAuthority,
			);
		}

		const requested = createRemoteAuthority('mock', 'server.alpha');
		const registry = new RemoteAuthorityResolverRegistry();
		context.after(() => registry.dispose());
		const registration = registry.register(new TestResolver(requested, createRemoteAuthority('mock', 'server.beta')));
		context.after(() => registration.dispose());
		await assert.rejects(
			registry.resolve(requested),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ResolutionMismatch,
		);
	});

	test('round trips authority-qualified resources without treating local files as Remote', () => {
		const authority = createRemoteAuthority('mock', 'server.alpha');
		const identity = {
			authority,
			path: '/workspace/readme.md',
			query: 'revision=7',
			fragment: 'overview',
		};
		const resource = createRemoteResourceUri(identity);
		assert.equal(resource.scheme, Schemas.vscodeRemote);
		assert.deepStrictEqual(parseRemoteResourceUri(resource), identity);

		const transformer = new RemoteUriTransformer(authority);
		assert.deepStrictEqual(transformer.toServerIdentity(resource), identity);
		assert.equal(transformer.toClientResource(identity).toString(), resource.toString());

		assert.throws(
			() => parseRemoteResourceUri(URI.file('/workspace/readme.md')),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.InvalidAuthority,
		);
		assert.throws(
			() => assertRemoteResourceAuthority(resource, createRemoteAuthority('mock', 'server.beta')),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ConnectionMismatch,
		);
	});

	test('validates environment roots with the addressed server operating system', () => {
		const common = {
			protocolVersion: createRemoteProtocolVersion('1'),
			architecture: 'x64',
			capabilities: [createRemoteCapabilityId('channels')],
			limits: {
				maximumFrameBytes: 2048,
				maximumPendingCalls: 8,
				maximumEventListeners: 8,
			},
		} as const;
		assert.equal(validateRemoteEnvironment({
			...common,
			operatingSystem: 'windows',
			userHome: 'C:\\Users\\Comet',
			temporaryDirectory: 'C:\\Temp',
			storageDirectory: '\\\\server\\share\\Comet',
			pathCasePolicy: 'insensitive',
		}).userHome, 'C:\\Users\\Comet');
		assert.throws(
			() => validateRemoteEnvironment({
				...common,
				operatingSystem: 'windows',
				userHome: '/home/comet',
				temporaryDirectory: 'C:\\Temp',
				storageDirectory: 'C:\\Comet',
				pathCasePolicy: 'insensitive',
			}),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.InvalidEnvironment,
		);
	});
});
