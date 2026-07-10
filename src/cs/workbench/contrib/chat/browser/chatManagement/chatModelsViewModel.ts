/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import {
	ILanguageModelsService,
	type ILanguageModelChatMetadataAndIdentifier,
	type ILanguageModelProviderDescriptor,
} from 'cs/workbench/contrib/chat/common/languageModels';
import type { ILanguageModelsProviderGroup } from 'cs/workbench/contrib/chat/common/languageModelsConfiguration';

export const MODEL_ENTRY_TEMPLATE_ID = 'model.entry.template';
export const VENDOR_ENTRY_TEMPLATE_ID = 'vendor.entry.template';
export const GROUP_ENTRY_TEMPLATE_ID = 'group.entry.template';

export interface ILanguageModelProvider {
	readonly vendor: ILanguageModelProviderDescriptor;
	readonly group?: ILanguageModelsProviderGroup;
}

export interface ILanguageModel extends ILanguageModelChatMetadataAndIdentifier {
	readonly provider: ILanguageModelProvider;
	hidden: boolean;
}

export interface ILanguageModelEntry {
	readonly type: 'model';
	readonly id: string;
	readonly templateId: typeof MODEL_ENTRY_TEMPLATE_ID;
	readonly model: ILanguageModel;
}

export interface ILanguageModelProviderEntry {
	readonly type: 'vendor';
	readonly id: string;
	readonly label: string;
	readonly templateId: typeof VENDOR_ENTRY_TEMPLATE_ID;
	readonly vendor: ILanguageModelProviderDescriptor;
	readonly collapsed: boolean;
}

export interface ILanguageModelGroupEntry {
	readonly type: 'group';
	readonly id: string;
	readonly label: string;
	readonly templateId: typeof GROUP_ENTRY_TEMPLATE_ID;
	readonly vendor: ILanguageModelProviderDescriptor;
	readonly group: ILanguageModelsProviderGroup;
	readonly collapsed: boolean;
	readonly hidden: boolean;
}

export type IViewModelEntry = ILanguageModelEntry | ILanguageModelProviderEntry | ILanguageModelGroupEntry;

export interface IViewModelChangeEvent {
	readonly entries: readonly IViewModelEntry[];
}

export function isLanguageModelEntry(entry: IViewModelEntry): entry is ILanguageModelEntry {
	return entry.type === 'model';
}

export function isLanguageModelProviderEntry(entry: IViewModelEntry): entry is ILanguageModelProviderEntry {
	return entry.type === 'vendor';
}

export function isLanguageModelGroupEntry(entry: IViewModelEntry): entry is ILanguageModelGroupEntry {
	return entry.type === 'group';
}

export class ChatModelsViewModel extends Disposable {
	private readonly onDidChangeEmitter = this._register(new EventEmitter<IViewModelChangeEvent>());
	readonly onDidChange: Event<IViewModelChangeEvent> = this.onDidChangeEmitter.event;

	private readonly entries: IViewModelEntry[] = [];
	private readonly collapsedEntries = new Set<string>();
	private searchValue = '';

	constructor(
		@ILanguageModelsService private readonly languageModelsService: ILanguageModelsService,
	) {
		super();
		this._register(this.languageModelsService.onDidChangeLanguageModels(() => {
			void this.refresh();
		}));
		this._register(this.languageModelsService.onDidChangeModelVisibility(() => {
			void this.refresh();
		}));
	}

	get viewModelEntries(): readonly IViewModelEntry[] {
		return this.entries;
	}

	async refresh(): Promise<void> {
		await this.languageModelsService.selectLanguageModels({});
		this.rebuildEntries();
	}

	filter(searchValue: string): readonly IViewModelEntry[] {
		this.searchValue = searchValue.trim().toLowerCase();
		this.rebuildEntries();
		return this.entries;
	}

	toggleCollapsed(entry: ILanguageModelProviderEntry | ILanguageModelGroupEntry): void {
		if (this.collapsedEntries.has(entry.id)) {
			this.collapsedEntries.delete(entry.id);
		} else {
			this.collapsedEntries.add(entry.id);
		}
		this.rebuildEntries();
	}

	setModelHidden(entry: ILanguageModelEntry, hidden: boolean): void {
		this.languageModelsService.setModelHidden(entry.model.identifier, hidden);
	}

	setModelsHidden(entries: readonly ILanguageModelEntry[], hidden: boolean): void {
		for (const entry of entries) {
			this.languageModelsService.setModelHidden(entry.model.identifier, hidden);
		}
	}

	setGroupHidden(entry: ILanguageModelGroupEntry, hidden: boolean): void {
		this.languageModelsService.setGroupHidden(entry.group.vendor, entry.group.name, hidden);
	}

	private rebuildEntries(): void {
		const nextEntries: IViewModelEntry[] = [];
		for (const vendor of this.languageModelsService.getVendors()) {
			const vendorEntry: ILanguageModelProviderEntry = {
				type: 'vendor',
				id: `vendor:${vendor.vendor}`,
				label: vendor.displayName,
				templateId: VENDOR_ENTRY_TEMPLATE_ID,
				vendor,
				collapsed: this.collapsedEntries.has(`vendor:${vendor.vendor}`),
			};

			const groups = this.languageModelsService.getLanguageModelGroups(vendor.vendor);
			if (groups.length === 0) {
				continue;
			}

			nextEntries.push(vendorEntry);
			if (vendorEntry.collapsed) {
				continue;
			}

			for (const group of groups) {
				if (group.group) {
					const groupEntry: ILanguageModelGroupEntry = {
						type: 'group',
						id: `group:${vendor.vendor}:${group.group.name}`,
						label: group.group.name,
						templateId: GROUP_ENTRY_TEMPLATE_ID,
						vendor,
						group: group.group,
						collapsed: this.collapsedEntries.has(`group:${vendor.vendor}:${group.group.name}`),
						hidden: this.languageModelsService.isGroupHidden(vendor.vendor, group.group.name),
					};
					nextEntries.push(groupEntry);
					if (groupEntry.collapsed) {
						continue;
					}
				}

				for (const identifier of group.modelIdentifiers) {
					const metadata = this.languageModelsService.lookupLanguageModel(identifier);
					if (!metadata || !this.matchesSearch(metadata.name, metadata.id, metadata.vendor)) {
						continue;
					}
					nextEntries.push({
						type: 'model',
						id: `model:${identifier}`,
						templateId: MODEL_ENTRY_TEMPLATE_ID,
						model: {
							identifier,
							metadata,
							provider: {
								vendor,
								group: group.group,
							},
							hidden: this.languageModelsService.isModelHidden(identifier),
						},
					});
				}
			}
		}

		this.entries.splice(0, this.entries.length, ...nextEntries);
		this.onDidChangeEmitter.fire({ entries: this.entries });
	}

	private matchesSearch(...values: readonly string[]): boolean {
		if (!this.searchValue) {
			return true;
		}
		return values.some(value => value.toLowerCase().includes(this.searchValue));
	}
}
