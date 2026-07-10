/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { CancellationTokenSource, type CancellationToken } from 'cs/base/common/cancellation';
import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore, type IDisposable } from 'cs/base/common/lifecycle';
import {
	ChatMessageRole,
	LanguageModelsService,
	type IChatMessage,
	type IChatResponsePart,
	type ILanguageModelChatInfoOptions,
	type ILanguageModelChatProvider,
	type ILanguageModelChatRequestOptions,
} from 'cs/workbench/contrib/chat/common/languageModels';
import {
	type ILanguageModelsConfigurationService,
	type ILanguageModelsProviderGroup,
} from 'cs/workbench/contrib/chat/common/languageModelsConfiguration';

const vendor = 'test-vendor';
const modelId = 'test-model';
const modelIdentifier = `${vendor}/${modelId}`;

class TestLanguageModelsConfigurationService extends Disposable implements ILanguageModelsConfigurationService {
	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeLanguageModelGroupsEmitter = this._register(new EventEmitter<readonly ILanguageModelsProviderGroup[]>());
	readonly onDidChangeLanguageModelGroups: Event<readonly ILanguageModelsProviderGroup[]> = this.onDidChangeLanguageModelGroupsEmitter.event;

	constructor(private readonly groups: readonly ILanguageModelsProviderGroup[] = []) {
		super();
	}

	getLanguageModelsProviderGroups(): readonly ILanguageModelsProviderGroup[] {
		return this.groups;
	}

	async addLanguageModelsProviderGroup(_group: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup> {
		throw new Error('Not implemented in the test configuration service.');
	}

	async updateLanguageModelsProviderGroup(_from: ILanguageModelsProviderGroup, _to: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup> {
		throw new Error('Not implemented in the test configuration service.');
	}

	async removeLanguageModelsProviderGroup(_group: ILanguageModelsProviderGroup): Promise<void> {
		throw new Error('Not implemented in the test configuration service.');
	}
}

interface ICapturedRequest {
	readonly modelId: string;
	readonly messages: readonly IChatMessage[];
	readonly from: string | undefined;
	readonly options: ILanguageModelChatRequestOptions;
	readonly token: CancellationToken;
}

interface ITestFixture {
	readonly service: LanguageModelsService;
	readonly providerRegistration: IDisposable;
	readonly infoOptions: ILanguageModelChatInfoOptions[];
	readonly getCapturedRequest: () => ICapturedRequest | undefined;
	readonly getCapturedTokenRequest: () => { modelId: string; message: string | IChatMessage; token: CancellationToken } | undefined;
	readonly dispose: () => void;
}

function createFixture(): ITestFixture {
	const store = new DisposableStore();
	const configurationService = store.add(new TestLanguageModelsConfigurationService());
	const service = store.add(new LanguageModelsService(configurationService));
	const infoOptions: ILanguageModelChatInfoOptions[] = [];
	let capturedRequest: ICapturedRequest | undefined;
	let capturedTokenRequest: { modelId: string; message: string | IChatMessage; token: CancellationToken } | undefined;
	const providerChangeEmitter = store.add(new EventEmitter<void>());

	service.deltaLanguageModelChatProviderDescriptors([{
		vendor,
		displayName: 'Test Vendor',
	}], []);

	const provider: ILanguageModelChatProvider = {
		onDidChange: providerChangeEmitter.event,
		async provideLanguageModelChatInfo(options) {
			infoOptions.push(options);
			return [{
				identifier: modelIdentifier,
				metadata: {
					name: 'Test Model',
					id: modelId,
					vendor,
					version: '1.0.0',
					family: 'test-family',
					maxInputTokens: 100,
					maxOutputTokens: 50,
				},
			}];
		},
		async sendChatRequest(requestModelId, messages, from, options, token) {
			capturedRequest = {
				modelId: requestModelId,
				messages,
				from,
				options,
				token,
			};

			const result = new Promise<void>(resolve => {
				token.onCancellationRequested(resolve);
			});
			const stream = (async function* (): AsyncIterable<IChatResponsePart> {
				yield { type: 'text', value: 'Hello ' };
				yield { type: 'text', value: 'world' };
			})();

			return { result, stream };
		},
		async provideTokenCount(requestModelId, message, token) {
			capturedTokenRequest = { modelId: requestModelId, message, token };
			return typeof message === 'string' ? message.length : message.content.length;
		},
	};
	const providerRegistration = service.registerLanguageModelProvider(vendor, provider);
	store.add(providerRegistration);

	return {
		service,
		providerRegistration,
		infoOptions,
		getCapturedRequest: () => capturedRequest,
		getCapturedTokenRequest: () => capturedTokenRequest,
		dispose: () => store.dispose(),
	};
}

test('LanguageModelsService discovers and selects models from a registered provider', async t => {
	const fixture = createFixture();
	t.after(fixture.dispose);

	const selectedModels = await fixture.service.selectLanguageModels({
		vendor,
		id: modelId,
		family: 'test-family',
		version: '1.0.0',
	});

	assert.deepStrictEqual({
		selectedModels,
		modelIds: fixture.service.getLanguageModelIds(),
		metadata: fixture.service.lookupLanguageModel(modelIdentifier),
		groups: fixture.service.getLanguageModelGroups(vendor),
		resolved: fixture.service.hasResolvedVendor(vendor),
		infoOptions: fixture.infoOptions,
	}, {
		selectedModels: [modelIdentifier],
		modelIds: [modelIdentifier],
		metadata: {
			name: 'Test Model',
			id: modelId,
			vendor,
			version: '1.0.0',
			family: 'test-family',
			maxInputTokens: 100,
			maxOutputTokens: 50,
		},
		groups: [{ modelIdentifiers: [modelIdentifier] }],
		resolved: true,
		infoOptions: [{ silent: true }],
	});
});

test('LanguageModelsService routes chat requests and streams provider responses', async t => {
	const fixture = createFixture();
	const cancellation = new CancellationTokenSource();
	t.after(() => {
		cancellation.dispose();
		fixture.dispose();
	});
	await fixture.service.selectLanguageModels({ id: modelId });
	const messages: readonly IChatMessage[] = [{
		role: ChatMessageRole.User,
		content: [{ type: 'text', value: 'Hello' }],
	}];
	const options: ILanguageModelChatRequestOptions = {
		configuration: { temperature: 0.2 },
	};

	const response = await fixture.service.sendChatRequest(
		modelIdentifier,
		'test.consumer',
		messages,
		options,
		cancellation.token,
	);
	const responseParts: IChatResponsePart[] = [];
	for await (const part of response.stream) {
		responseParts.push(...(Array.isArray(part) ? part : [part]));
	}
	const resultSettled = response.result.then(() => true);
	cancellation.cancel();

	assert.deepStrictEqual({
		request: fixture.getCapturedRequest(),
		responseParts,
		resultSettled: await resultSettled,
	}, {
		request: {
			modelId: modelIdentifier,
			messages,
			from: 'test.consumer',
			options,
			token: cancellation.token,
		},
		responseParts: [
			{ type: 'text', value: 'Hello ' },
			{ type: 'text', value: 'world' },
		],
		resultSettled: true,
	});
});

test('LanguageModelsService routes token counting and removes disposed providers', async t => {
	const fixture = createFixture();
	const cancellation = new CancellationTokenSource();
	t.after(() => {
		cancellation.dispose();
		fixture.dispose();
	});
	await fixture.service.selectLanguageModels({ id: modelId });

	const tokenCount = await fixture.service.computeTokenLength(modelIdentifier, 'four', cancellation.token);
	const tokenRequest = fixture.getCapturedTokenRequest();
	fixture.providerRegistration.dispose();

	assert.deepStrictEqual({
		tokenCount,
		tokenRequest,
		modelIds: fixture.service.getLanguageModelIds(),
	}, {
		tokenCount: 4,
		tokenRequest: {
			modelId: modelIdentifier,
			message: 'four',
			token: cancellation.token,
		},
		modelIds: [],
	});
	await assert.rejects(
		fixture.service.sendChatRequest(modelIdentifier, undefined, [], {}, cancellation.token),
		/Language model 'test-vendor\/test-model' is not registered/,
	);
});
