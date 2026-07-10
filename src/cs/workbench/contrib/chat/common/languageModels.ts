/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import {
	ILanguageModelsConfigurationService,
	type ILanguageModelsProviderGroup,
	type LanguageModelConfiguration,
} from 'cs/workbench/contrib/chat/common/languageModelsConfiguration';

export const ILanguageModelsService = createDecorator<ILanguageModelsService>('languageModelsService');

export const COPILOT_VENDOR_ID = 'copilot';

export const enum ChatMessageRole {
	System,
	User,
	Assistant,
}

export interface IChatMessageTextPart {
	readonly type: 'text';
	readonly value: string;
}

export interface IChatMessage {
	readonly role: ChatMessageRole;
	readonly content: readonly IChatMessageTextPart[];
}

export interface IChatResponseTextPart {
	readonly type: 'text';
	readonly value: string;
}

export type IChatResponsePart = IChatResponseTextPart;

export interface ILanguageModelChatResponse {
	readonly result: Promise<unknown>;
	readonly stream: AsyncIterable<IChatResponsePart | readonly IChatResponsePart[]>;
}

export interface ILanguageModelConfigurationSchema {
	readonly type?: string;
	readonly properties?: Record<string, ILanguageModelConfigurationSchema>;
	readonly required?: readonly string[];
	readonly enum?: readonly (string | number | boolean | null)[];
	readonly default?: unknown;
	readonly title?: string;
	readonly description?: string;
}

export interface ILanguageModelChatMetadata {
	readonly name: string;
	readonly id: string;
	readonly vendor: string;
	readonly version: string;
	readonly family?: string;
	readonly detail?: string;
	readonly tooltip?: string;
	readonly maxInputTokens?: number;
	readonly maxOutputTokens?: number;
	readonly isDefault?: boolean;
	readonly isUserSelectable?: boolean;
	readonly targetChatSessionType?: string;
	readonly configurationSchema?: ILanguageModelConfigurationSchema;
	readonly capabilities?: {
		readonly vision?: boolean;
		readonly toolCalling?: boolean;
		readonly agentMode?: boolean;
	};
}

export namespace ILanguageModelChatMetadata {
	export function asQualifiedName(metadata: ILanguageModelChatMetadata): string {
		return `${metadata.name} (${metadata.vendor})`;
	}

	export function matchesQualifiedName(qualifiedName: string, metadata: ILanguageModelChatMetadata): boolean {
		return qualifiedName === asQualifiedName(metadata);
	}
}

export interface ILanguageModelChatMetadataAndIdentifier {
	readonly metadata: ILanguageModelChatMetadata;
	readonly identifier: string;
}

export interface ILanguageModelChatSelector {
	readonly vendor?: string;
	readonly id?: string;
	readonly family?: string;
	readonly version?: string;
}

export interface ILanguageModelChatInfoOptions {
	readonly group?: string;
	readonly silent: boolean;
	readonly configuration?: LanguageModelConfiguration;
}

export interface ILanguageModelChatRequestOptions {
	readonly configuration?: LanguageModelConfiguration;
	readonly [key: string]: unknown;
}

export interface ILanguageModelChatProvider {
	readonly onDidChange: Event<void>;
	provideLanguageModelChatInfo(options: ILanguageModelChatInfoOptions, token: CancellationToken): Promise<readonly ILanguageModelChatMetadataAndIdentifier[]>;
	sendChatRequest(modelId: string, messages: readonly IChatMessage[], from: string | undefined, options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse>;
	provideTokenCount?(modelId: string, message: string | IChatMessage, token: CancellationToken): Promise<number>;
}

export interface IUserFriendlyLanguageModelProvider {
	readonly vendor: string;
	readonly displayName: string;
	readonly configuration?: ILanguageModelConfigurationSchema;
}

export interface ILanguageModelProviderDescriptor extends IUserFriendlyLanguageModelProvider {
	readonly isDefault: boolean;
}

export interface ILanguageModelsGroup {
	readonly group?: ILanguageModelsProviderGroup;
	readonly modelIdentifiers: readonly string[];
}

export interface ILanguageModelsService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeLanguageModelVendors: Event<readonly string[]>;
	readonly onDidChangeLanguageModels: Event<string>;
	readonly onDidChangePinnedModels: Event<void>;
	readonly onDidChangeModelVisibility: Event<void>;
	getLanguageModelIds(): string[];
	getVendors(): ILanguageModelProviderDescriptor[];
	getLanguageModelGroups(vendor: string): readonly ILanguageModelsGroup[];
	lookupLanguageModel(modelId: string): ILanguageModelChatMetadata | undefined;
	lookupLanguageModelByQualifiedName(qualifiedName: string): ILanguageModelChatMetadataAndIdentifier | undefined;
	hasResolvedVendor(vendor: string): boolean;
	selectLanguageModels(selector: ILanguageModelChatSelector): Promise<string[]>;
	deltaLanguageModelChatProviderDescriptors(added: readonly IUserFriendlyLanguageModelProvider[], removed: readonly IUserFriendlyLanguageModelProvider[]): void;
	registerLanguageModelProvider(vendor: string, provider: ILanguageModelChatProvider): IDisposable;
	sendChatRequest(modelId: string, from: string | undefined, messages: readonly IChatMessage[], options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse>;
	computeTokenLength(modelId: string, message: string | IChatMessage, token: CancellationToken): Promise<number>;
	isModelPinned(modelId: string): boolean;
	pinModel(modelId: string): void;
	unpinModel(modelId: string): void;
	isModelHidden(modelId: string): boolean;
	setModelHidden(modelId: string, hidden: boolean): void;
	isGroupHidden(vendor: string, groupName: string): boolean;
	setGroupHidden(vendor: string, groupName: string, hidden: boolean): void;
}

export class LanguageModelsService extends Disposable implements ILanguageModelsService {
	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeLanguageModelVendorsEmitter = this._register(new EventEmitter<readonly string[]>());
	readonly onDidChangeLanguageModelVendors = this.onDidChangeLanguageModelVendorsEmitter.event;

	private readonly onDidChangeLanguageModelsEmitter = this._register(new EventEmitter<string>());
	readonly onDidChangeLanguageModels = this.onDidChangeLanguageModelsEmitter.event;

	private readonly onDidChangePinnedModelsEmitter = this._register(new EventEmitter<void>());
	readonly onDidChangePinnedModels = this.onDidChangePinnedModelsEmitter.event;

	private readonly onDidChangeModelVisibilityEmitter = this._register(new EventEmitter<void>());
	readonly onDidChangeModelVisibility = this.onDidChangeModelVisibilityEmitter.event;

	private readonly providers = new Map<string, ILanguageModelChatProvider>();
	private readonly vendors = new Map<string, ILanguageModelProviderDescriptor>();
	private readonly modelCache = new Map<string, ILanguageModelChatMetadata>();
	private readonly modelGroups = new Map<string, ILanguageModelsGroup[]>();
	private readonly providerListeners = new Map<string, IDisposable>();
	private readonly resolvedVendors = new Set<string>();
	private readonly pinnedModelIds = new Set<string>();
	private readonly hiddenModelIds = new Set<string>();
	private readonly hiddenGroups = new Set<string>();

	constructor(
		@ILanguageModelsConfigurationService private readonly languageModelsConfigurationService: ILanguageModelsConfigurationService,
	) {
		super();
		this._register(this.languageModelsConfigurationService.onDidChangeLanguageModelGroups(groups => {
			for (const group of groups) {
				void this.resolveAllLanguageModels(group.vendor);
			}
		}));
	}

	getLanguageModelIds(): string[] {
		return Array.from(this.modelCache.keys());
	}

	getVendors(): ILanguageModelProviderDescriptor[] {
		return Array.from(this.vendors.values());
	}

	getLanguageModelGroups(vendor: string): readonly ILanguageModelsGroup[] {
		return this.modelGroups.get(vendor) ?? [];
	}

	lookupLanguageModel(modelId: string): ILanguageModelChatMetadata | undefined {
		return this.modelCache.get(modelId);
	}

	lookupLanguageModelByQualifiedName(qualifiedName: string): ILanguageModelChatMetadataAndIdentifier | undefined {
		for (const [identifier, metadata] of this.modelCache) {
			if (ILanguageModelChatMetadata.matchesQualifiedName(qualifiedName, metadata)) {
				return { identifier, metadata };
			}
		}
		return undefined;
	}

	hasResolvedVendor(vendor: string): boolean {
		return this.resolvedVendors.has(vendor);
	}

	async selectLanguageModels(selector: ILanguageModelChatSelector): Promise<string[]> {
		if (selector.vendor) {
			await this.resolveAllLanguageModels(selector.vendor);
		} else {
			await Promise.all(Array.from(this.vendors.keys()).map(vendor => this.resolveAllLanguageModels(vendor)));
		}

		const result: string[] = [];
		for (const [identifier, metadata] of this.modelCache) {
			if (this.matchesSelector(metadata, selector)) {
				result.push(identifier);
			}
		}
		return result;
	}

	deltaLanguageModelChatProviderDescriptors(added: readonly IUserFriendlyLanguageModelProvider[], removed: readonly IUserFriendlyLanguageModelProvider[]): void {
		const changedVendors: string[] = [];
		const removedVendors: string[] = [];

		for (const item of added) {
			this.assertVendorCanBeRegistered(item.vendor);
			this.vendors.set(item.vendor, {
				...item,
				isDefault: item.vendor === COPILOT_VENDOR_ID,
			});
			changedVendors.push(item.vendor);
		}

		for (const item of removed) {
			this.vendors.delete(item.vendor);
			this.providers.delete(item.vendor);
			this.providerListeners.get(item.vendor)?.dispose();
			this.providerListeners.delete(item.vendor);
			this.clearModelCache(item.vendor);
			this.modelGroups.delete(item.vendor);
			this.resolvedVendors.delete(item.vendor);
			changedVendors.push(item.vendor);
			removedVendors.push(item.vendor);
		}

		if (changedVendors.length > 0) {
			this.onDidChangeLanguageModelVendorsEmitter.fire(changedVendors);
			for (const vendor of removedVendors) {
				this.onDidChangeLanguageModelsEmitter.fire(vendor);
			}
		}
	}

	registerLanguageModelProvider(vendor: string, provider: ILanguageModelChatProvider): IDisposable {
		if (!this.vendors.has(vendor)) {
			throw new Error(`Chat model provider uses unknown vendor '${vendor}'.`);
		}
		if (this.providers.has(vendor)) {
			throw new Error(`Chat model provider for vendor '${vendor}' is already registered.`);
		}

		this.providers.set(vendor, provider);
		const listener = provider.onDidChange(() => {
			void this.resolveAllLanguageModels(vendor);
		});
		this.providerListeners.set(vendor, listener);

		return toDisposable(() => {
			listener.dispose();
			this.providerListeners.delete(vendor);
			this.providers.delete(vendor);
			this.clearModelCache(vendor);
			this.modelGroups.delete(vendor);
			this.resolvedVendors.delete(vendor);
			this.onDidChangeLanguageModelsEmitter.fire(vendor);
		});
	}

	async sendChatRequest(modelId: string, from: string | undefined, messages: readonly IChatMessage[], options: ILanguageModelChatRequestOptions, token: CancellationToken): Promise<ILanguageModelChatResponse> {
		const metadata = this.getRequiredModel(modelId);
		const provider = this.getRequiredProvider(metadata.vendor);
		return provider.sendChatRequest(modelId, messages, from, options, token);
	}

	async computeTokenLength(modelId: string, message: string | IChatMessage, token: CancellationToken): Promise<number> {
		const metadata = this.getRequiredModel(modelId);
		const provider = this.getRequiredProvider(metadata.vendor);
		if (!provider.provideTokenCount) {
			throw new Error(`Chat model provider '${metadata.vendor}' does not implement token counting.`);
		}
		return provider.provideTokenCount(modelId, message, token);
	}

	isModelPinned(modelId: string): boolean {
		return this.pinnedModelIds.has(modelId);
	}

	pinModel(modelId: string): void {
		this.getRequiredModel(modelId);
		this.pinnedModelIds.add(modelId);
		this.onDidChangePinnedModelsEmitter.fire();
	}

	unpinModel(modelId: string): void {
		this.pinnedModelIds.delete(modelId);
		this.onDidChangePinnedModelsEmitter.fire();
	}

	isModelHidden(modelId: string): boolean {
		return this.hiddenModelIds.has(modelId);
	}

	setModelHidden(modelId: string, hidden: boolean): void {
		this.getRequiredModel(modelId);
		if (hidden) {
			this.hiddenModelIds.add(modelId);
		} else {
			this.hiddenModelIds.delete(modelId);
		}
		this.onDidChangeModelVisibilityEmitter.fire();
	}

	isGroupHidden(vendor: string, groupName: string): boolean {
		return this.hiddenGroups.has(this.groupKey(vendor, groupName));
	}

	setGroupHidden(vendor: string, groupName: string, hidden: boolean): void {
		const key = this.groupKey(vendor, groupName);
		if (hidden) {
			this.hiddenGroups.add(key);
		} else {
			this.hiddenGroups.delete(key);
		}
		this.onDidChangeModelVisibilityEmitter.fire();
	}

	private async resolveAllLanguageModels(vendor: string): Promise<void> {
		const provider = this.getRequiredProvider(vendor);
		const groups: ILanguageModelsGroup[] = [];
		const models = await provider.provideLanguageModelChatInfo({ silent: true }, CancellationTokenNone);

		this.clearModelCache(vendor);
		if (models.length > 0) {
			for (const model of models) {
				this.modelCache.set(model.identifier, model.metadata);
			}
			groups.push({ modelIdentifiers: models.map(model => model.identifier) });
		}

		for (const group of this.languageModelsConfigurationService.getLanguageModelsProviderGroups()) {
			if (group.vendor !== vendor) {
				continue;
			}
			const groupModels = await provider.provideLanguageModelChatInfo({
				group: group.name,
				silent: true,
				configuration: group.configuration,
			}, CancellationTokenNone);
			for (const model of groupModels) {
				this.modelCache.set(model.identifier, model.metadata);
			}
			groups.push({ group, modelIdentifiers: groupModels.map(model => model.identifier) });
		}

		this.modelGroups.set(vendor, groups);
		this.resolvedVendors.add(vendor);
		this.onDidChangeLanguageModelsEmitter.fire(vendor);
	}

	private matchesSelector(metadata: ILanguageModelChatMetadata, selector: ILanguageModelChatSelector): boolean {
		return (selector.vendor === undefined || metadata.vendor === selector.vendor)
			&& (selector.id === undefined || metadata.id === selector.id)
			&& (selector.family === undefined || metadata.family === selector.family)
			&& (selector.version === undefined || metadata.version === selector.version);
	}

	private assertVendorCanBeRegistered(vendor: string): void {
		if (vendor.trim().length === 0) {
			throw new Error('Language model vendor cannot be empty.');
		}
		if (vendor.trim() !== vendor) {
			throw new Error('Language model vendor cannot start or end with whitespace.');
		}
		if (this.vendors.has(vendor)) {
			throw new Error(`Language model vendor '${vendor}' is already registered.`);
		}
	}

	private getRequiredModel(modelId: string): ILanguageModelChatMetadata {
		const model = this.modelCache.get(modelId);
		if (!model) {
			throw new Error(`Language model '${modelId}' is not registered.`);
		}
		return model;
	}

	private getRequiredProvider(vendor: string): ILanguageModelChatProvider {
		const provider = this.providers.get(vendor);
		if (!provider) {
			throw new Error(`Language model provider '${vendor}' is not registered.`);
		}
		return provider;
	}

	private clearModelCache(vendor: string): void {
		for (const [identifier, metadata] of this.modelCache) {
			if (metadata.vendor === vendor) {
				this.modelCache.delete(identifier);
			}
		}
	}

	private groupKey(vendor: string, groupName: string): string {
		return `${vendor}:${groupName}`;
	}
}

registerSingleton(ILanguageModelsService, LanguageModelsService, InstantiationType.Delayed);
