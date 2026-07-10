/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { IStorageService, StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';

export const ILanguageModelsConfigurationService =
	createDecorator<ILanguageModelsConfigurationService>('languageModelsConfigurationService');

export type LanguageModelConfigurationValue =
	| string
	| number
	| boolean
	| null
	| readonly LanguageModelConfigurationValue[]
	| { readonly [key: string]: LanguageModelConfigurationValue };

export type LanguageModelConfiguration = Record<string, LanguageModelConfigurationValue>;

export interface ILanguageModelsProviderGroup {
	readonly vendor: string;
	readonly name: string;
	readonly configuration?: LanguageModelConfiguration;
	readonly settings?: Record<string, LanguageModelConfiguration>;
}

export interface ILanguageModelsConfigurationService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeLanguageModelGroups: Event<readonly ILanguageModelsProviderGroup[]>;
	getLanguageModelsProviderGroups(): readonly ILanguageModelsProviderGroup[];
	addLanguageModelsProviderGroup(group: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup>;
	updateLanguageModelsProviderGroup(from: ILanguageModelsProviderGroup, to: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup>;
	removeLanguageModelsProviderGroup(group: ILanguageModelsProviderGroup): Promise<void>;
}

const LANGUAGE_MODELS_PROVIDER_GROUPS_STORAGE_KEY = 'chat.languageModels.providerGroups';

export class LanguageModelsConfigurationService extends Disposable implements ILanguageModelsConfigurationService {
	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeLanguageModelGroupsEmitter = this._register(new EventEmitter<readonly ILanguageModelsProviderGroup[]>());
	readonly onDidChangeLanguageModelGroups = this.onDidChangeLanguageModelGroupsEmitter.event;

	private readonly groups: ILanguageModelsProviderGroup[];

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.groups = this.storageService.getObject<ILanguageModelsProviderGroup[]>(
			LANGUAGE_MODELS_PROVIDER_GROUPS_STORAGE_KEY,
			StorageScope.PROFILE,
			[],
		);
	}

	getLanguageModelsProviderGroups(): readonly ILanguageModelsProviderGroup[] {
		return this.groups;
	}

	async addLanguageModelsProviderGroup(group: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup> {
		this.assertGroupDoesNotExist(group.vendor, group.name);
		this.groups.push(group);
		this.storeGroups();
		this.onDidChangeLanguageModelGroupsEmitter.fire([group]);
		return group;
	}

	async updateLanguageModelsProviderGroup(from: ILanguageModelsProviderGroup, to: ILanguageModelsProviderGroup): Promise<ILanguageModelsProviderGroup> {
		const index = this.findGroupIndex(from.vendor, from.name);
		this.groups[index] = to;
		this.storeGroups();
		this.onDidChangeLanguageModelGroupsEmitter.fire([to]);
		return to;
	}

	async removeLanguageModelsProviderGroup(group: ILanguageModelsProviderGroup): Promise<void> {
		const index = this.findGroupIndex(group.vendor, group.name);
		this.groups.splice(index, 1);
		this.storeGroups();
		this.onDidChangeLanguageModelGroupsEmitter.fire([group]);
	}

	private storeGroups(): void {
		this.storageService.store(
			LANGUAGE_MODELS_PROVIDER_GROUPS_STORAGE_KEY,
			this.groups,
			StorageScope.PROFILE,
			StorageTarget.USER,
		);
	}

	private assertGroupDoesNotExist(vendor: string, name: string): void {
		if (this.groups.some(group => group.vendor === vendor && group.name === name)) {
			throw new Error(`Language model provider group '${name}' already exists for vendor '${vendor}'.`);
		}
	}

	private findGroupIndex(vendor: string, name: string): number {
		const index = this.groups.findIndex(group => group.vendor === vendor && group.name === name);
		if (index === -1) {
			throw new Error(`Language model provider group '${name}' does not exist for vendor '${vendor}'.`);
		}
		return index;
	}
}

registerSingleton(ILanguageModelsConfigurationService, LanguageModelsConfigurationService, InstantiationType.Delayed);
