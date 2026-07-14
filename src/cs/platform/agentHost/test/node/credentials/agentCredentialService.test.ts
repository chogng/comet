/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationTokenNone, CancellationTokenSource, type CancellationToken } from 'cs/base/common/cancellation';
import { isCancellationError } from 'cs/base/common/errors';
import type { IAgentCredentialReference, IAgentCredentialResolutionRequest } from 'cs/platform/agentHost/common/credentials';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentChatId,
	createAgentId,
	createAgentPackageId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import {
	AgentCredentialService,
	type IAgentCredentialSecretSource,
} from 'cs/platform/agentHost/node/credentials/agentCredentialService';

const credential: IAgentCredentialReference = Object.freeze({
	provider: 'test.provider',
	scope: 'llm',
	reference: 'primary',
});
const packageId = createAgentPackageId('test-package');
const agentId = createAgentId('test-agent');
const runtimeRegistration = createAgentRuntimeRegistrationRevision('test.runtime.v1');
const session = createAgentSessionId('test-session');
const chat = createAgentChatId('test-chat');
const turn = createAgentTurnId('test-turn');
const requiredPrivilege = 'test.provider-api-key';

class TestCredentialSource implements IAgentCredentialSecretSource {
	resolveCalls = 0;
	value: string | undefined = 'short-lived-secret';
	error: Error | undefined;
	pending = false;

	requiredPrivilege(candidate: IAgentCredentialReference): string {
		assert.deepEqual(candidate, credential);
		return requiredPrivilege;
	}

	async resolve(candidate: IAgentCredentialReference): Promise<string | undefined> {
		this.resolveCalls += 1;
		assert.deepEqual(candidate, credential);
		if (this.error !== undefined) {
			throw this.error;
		}
		if (this.pending) {
			return new Promise<string | undefined>(() => undefined);
		}
		return this.value;
	}
}

function resolutionRequest(
	overrides: Partial<IAgentCredentialResolutionRequest> = {},
): IAgentCredentialResolutionRequest {
	return Object.freeze({
		packageId,
		agentId,
		runtimeRegistration,
		session,
		chat,
		turn,
		credential,
		...overrides,
	});
}

function bind(service: AgentCredentialService) {
	return service.bindTurn({
		packageId,
		agentId,
		runtimeRegistration,
		session,
		chat,
		turn,
		credentials: Object.freeze([credential]),
		grantedPrivileges: Object.freeze([Object.freeze({ kind: 'secret' as const, value: requiredPrivilege })]),
	});
}

function assertAgentHostError(error: unknown, code: string): boolean {
	assert.ok(error instanceof AgentHostError);
	assert.equal(error.code, code);
	return true;
}

suite('AgentCredentialService', () => {
	test('resolves only an exact authorized Turn binding and retires it on disposal', async () => {
		const source = new TestCredentialSource();
		const service = new AgentCredentialService(source);
		const binding = bind(service);

		assert.equal(await service.resolve(resolutionRequest(), CancellationTokenNone), 'short-lived-secret');
		assert.equal(source.resolveCalls, 1);
		binding.dispose();
		await assert.rejects(
			service.resolve(resolutionRequest(), CancellationTokenNone),
			error => assertAgentHostError(error, AgentHostErrorCode.CredentialUnauthorized),
		);
		assert.equal(source.resolveCalls, 1);
	});

	test('rejects missing privileges, duplicate references, and cross-identity resolution before the source', async () => {
		const source = new TestCredentialSource();
		const service = new AgentCredentialService(source);
		assert.throws(
			() => service.bindTurn({
				packageId,
				agentId,
				runtimeRegistration,
				session,
				chat,
				turn,
				credentials: Object.freeze([credential]),
				grantedPrivileges: Object.freeze([]),
			}),
			error => assertAgentHostError(error, AgentHostErrorCode.CredentialUnauthorized),
		);
		assert.throws(
			() => service.bindTurn({
				packageId,
				agentId,
				runtimeRegistration,
				session,
				chat,
				turn,
				credentials: Object.freeze([credential, credential]),
				grantedPrivileges: Object.freeze([Object.freeze({ kind: 'secret' as const, value: requiredPrivilege })]),
			}),
			error => assertAgentHostError(error, AgentHostErrorCode.InvalidProtocolValue),
		);

		const binding = bind(service);
		await assert.rejects(
			service.resolve(resolutionRequest({ packageId: createAgentPackageId('other-package') }), CancellationTokenNone),
			error => assertAgentHostError(error, AgentHostErrorCode.CredentialUnauthorized),
		);
		await assert.rejects(
			service.resolve(resolutionRequest({
				credential: Object.freeze({ ...credential, reference: 'secondary' }),
			}), CancellationTokenNone),
			error => assertAgentHostError(error, AgentHostErrorCode.CredentialUnauthorized),
		);
		assert.equal(source.resolveCalls, 0);
		binding.dispose();
	});

	test('maps absent, oversized, and source failures to redacted unavailability', async () => {
		const source = new TestCredentialSource();
		const service = new AgentCredentialService(source);
		const binding = bind(service);

		for (const value of [undefined, '', 'x'.repeat(64 * 1024 + 1)]) {
			source.value = value;
			await assert.rejects(
				service.resolve(resolutionRequest(), CancellationTokenNone),
				error => assertAgentHostError(error, AgentHostErrorCode.CredentialUnavailable),
			);
		}
		source.error = new Error('source exposed raw-secret-marker');
		await assert.rejects(
			service.resolve(resolutionRequest(), CancellationTokenNone),
			error => {
				assertAgentHostError(error, AgentHostErrorCode.CredentialUnavailable);
				assert.doesNotMatch(String(error), /raw-secret-marker/);
				assert.doesNotMatch(JSON.stringify((error as AgentHostError).data), /primary|raw-secret-marker/);
				return true;
			},
		);
		binding.dispose();
	});

	test('cancels resolution even when the secret source ignores the token', async () => {
		const source = new TestCredentialSource();
		source.pending = true;
		const service = new AgentCredentialService(source);
		const binding = bind(service);
		const cancellation = new CancellationTokenSource();
		const resolution = service.resolve(resolutionRequest(), cancellation.token);
		cancellation.cancel();
		await assert.rejects(resolution, error => isCancellationError(error));
		assert.equal(source.resolveCalls, 1);
		binding.dispose();
		cancellation.dispose();
	});

	test('cancels an in-flight source and rejects its late secret when the Turn binding is disposed', async () => {
		const completion = new DeferredPromise<string | undefined>();
		const started = new DeferredPromise<void>();
		let sourceToken: CancellationToken | undefined;
		const source: IAgentCredentialSecretSource = {
			requiredPrivilege: candidate => {
				assert.deepEqual(candidate, credential);
				return requiredPrivilege;
			},
			resolve: (candidate, token) => {
				assert.deepEqual(candidate, credential);
				sourceToken = token;
				started.complete();
				return completion.p;
			},
		};
		const service = new AgentCredentialService(source);
		const binding = bind(service);
		const resolution = service.resolve(resolutionRequest(), CancellationTokenNone);
		await started.p;

		completion.complete('late-secret');
		binding.dispose();

		assert.equal(sourceToken?.isCancellationRequested, true);
		await assert.rejects(resolution, error => isCancellationError(error));
	});
});
