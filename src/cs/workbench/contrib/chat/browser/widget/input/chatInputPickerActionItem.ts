/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ActionBarMenuItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import type { DropdownOption } from 'cs/base/browser/ui/dropdown/dropdown';
import {
	DropdownMenuActionViewItem,
	type DropdownMenuActionViewItemOptions,
} from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createFilterMenuHeader } from 'cs/base/browser/ui/dropdown/dropdownSearchHeader';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LlmProviderId } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { IDisposable } from 'cs/base/common/lifecycle';
import { toDisposable } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import type { ChatModelDropdownOption } from 'cs/workbench/contrib/chat/browser/chat';
import {
	parseLlmModelOptionValue,
	serializeLlmModelOptionValue,
	type LlmReasoningEffort,
	type LlmServiceTier,
} from 'cs/workbench/services/llm/registry';

export type ChatInputModelPickerProps = {
	readonly activeLlmModelLabel: string;
	readonly isMaxContextWindowEnabled: boolean;
	readonly activeLlmModelSupportsMaxContextWindow: boolean;
	readonly llmModelOptions: ChatModelDropdownOption[];
	readonly activeLlmModelOptionValue: string;
	readonly onToggleAutoModelRouting: (options?: { suppressRender?: boolean }) => string | void;
	readonly onSelectLlmModel: (value: string) => void;
	readonly onToggleMaxContextWindow: (options?: { suppressRender?: boolean }) => void;
	readonly onOpenModelSettings: () => void;
};

type ChatModelMenuGroup = {
	readonly key: string;
	readonly providerId: LlmProviderId;
	readonly modelId: string;
	readonly label: string;
	readonly title?: string;
	readonly icon?: LxIconName;
	disabled: boolean;
	readonly options: ChatModelDropdownOption[];
};

function createElement<K extends keyof HTMLElementTagNameMap>(
	tagName: K,
	className?: string,
) {
	const element = document.createElement(tagName);
	if (className) {
		element.className = className;
	}
	return element;
}

export class ChatInputModelPickerActionViewItem {
	private props: ChatInputModelPickerProps;
	private modelDropdownActionViewItem: DropdownMenuActionViewItem | null = null;
	private transientActiveLlmModelOptionValue: string | null = null;
	private transientMaxContextWindowEnabled: boolean | null = null;

	constructor(props: ChatInputModelPickerProps) {
		this.props = props;
	}

	setProps(props: ChatInputModelPickerProps) {
		this.props = props;
		this.transientActiveLlmModelOptionValue = null;
		this.transientMaxContextWindowEnabled = null;
	}

	render(container: HTMLElement): IDisposable {
		const viewItem = new DropdownMenuActionViewItem(
			this.createModelDropdownActionViewItemOptions(),
		);
		this.modelDropdownActionViewItem = viewItem;
		viewItem.render(container);
		return toDisposable(() => {
			viewItem.dispose();
			if (this.modelDropdownActionViewItem === viewItem) {
				this.modelDropdownActionViewItem = null;
			}
		});
	}

	private createModelDropdownActionViewItemOptions(): DropdownMenuActionViewItemOptions {
		const currentOption = this.resolveCurrentModelOption();
		const currentLabel = this.getModelDropdownTriggerLabel(currentOption);

		return {
			label: currentLabel,
			title: currentLabel,
			mode: 'custom',
			buttonClassName: 'chat-model-switch-btn',
			className: 'chat-model-switch',
			disabled: this.props.llmModelOptions.length === 0,
			minWidth: 236,
			menuClassName: 'chat-model-menu',
			menuData: 'chat-model-menu',
			content: () => this.renderModelDropdownTrigger(currentOption),
			menu: this.createModelMenuItems(''),
			menuHeader: createFilterMenuHeader({
				inputClassName: 'chat-model-menu-search-input',
				placeholder: localize('chatModelSearch', "Search models"),
				ariaLabel: localize('chatModelSearch', "Search models"),
				getMenuItems: query => this.createModelMenuItems(query),
			}),
		};
	}

	private resolveCurrentModelOption() {
		const activeLlmModelOptionValue = this.getActiveLlmModelOptionValue();
		const exactOption =
			this.props.llmModelOptions.find(
				option => option.value === activeLlmModelOptionValue,
			) ?? null;
		if (!exactOption) {
			return null;
		}

		return {
			...exactOption,
			label: this.getModelOptionBaseLabel(exactOption),
		};
	}

	private renderModelDropdownTrigger(currentOption: DropdownOption | null) {
		const trigger = createElement('span', 'chat-model-switch-trigger');
		const label = createElement('span', 'chat-model-switch-label');
		label.textContent = this.getModelDropdownTriggerLabel(currentOption);
		const chevron = createLxIcon('chevron-down', 'chat-model-switch-chevron');

		trigger.append(label, chevron);
		return trigger;
	}

	private getModelDropdownTriggerLabel(currentOption: DropdownOption | null) {
		if (this.getActiveLlmModelOptionValue() === 'auto') {
			return localize('chatModelAuto', "Auto");
		}

		return currentOption?.label
			|| this.props.activeLlmModelLabel
			|| localize('chatModelSelect', "Select model");
	}

	private createModelMenuItems(keyword: string): readonly ActionBarMenuItem[] {
		const normalizedKeyword = keyword.trim().toLowerCase();
		const isAutoModelRoutingEnabled =
			this.getActiveLlmModelOptionValue() === 'auto';
		const matchesKeyword = (value: string | undefined) =>
			!normalizedKeyword || value?.toLowerCase().includes(normalizedKeyword);
		const modelGroups = this.getModelMenuGroups().filter(group =>
			[
				group.label,
				group.title,
				group.providerId,
				group.modelId,
				...group.options.flatMap(option => [
					option.label,
					option.title,
					option.value,
					option.reasoningEffort,
					option.serviceTier,
				]),
			]
				.filter(Boolean)
				.some(value => matchesKeyword(value)),
		);
		const autoLabel = localize('chatModelAuto', "Auto");
		const autoTitle = localize(
			'chatModelAutoTitle',
			"Automatically route to a suitable model for the question.",
		);
		const autoDescription = localize(
			'chatModelAutoDescription',
			"Balanced quality and speed, recommended for most tasks",
		);
		const maxModeLabel = localize('chatModelMaxMode', "Max mode");
		const maxModeTitle = localize(
			'chatModelMaxModeTitle',
			"Use the 1M context window when available.",
		);
		const addModelsLabel = localize('chatModelAdd', "Add models");
		const addModelsTitle = localize(
			'chatModelAddTitle',
			"Open Settings to manage enabled models.",
		);
		const multipleModelsLabel = localize('chatModelMultiple', "Use multiple models");
		const unavailableTitle = localize('chatModelUnavailable', "Not available yet.");
		const emptyLabel = localize('chatModelSearchEmpty', "No matching models");

		const autoItem: ActionBarMenuItem = {
			label: autoLabel,
			title: autoTitle,
			description: isAutoModelRoutingEnabled
				? autoDescription
				: undefined,
			checked: isAutoModelRoutingEnabled,
			checkedDisplay: 'switch',
			keepOpenOnClick: true,
			onClick: () => {
				this.handleToggleAutoModelRoutingFromMenu();
			},
		};
		const items: ActionBarMenuItem[] = [
			autoItem,
			{
				label: maxModeLabel,
				title: maxModeTitle,
				checked: this.getIsMaxContextWindowEnabled(),
				checkedDisplay: 'switch',
				keepOpenOnClick: true,
				disabled: !this.props.activeLlmModelSupportsMaxContextWindow,
				onClick: () => {
					this.handleToggleMaxContextWindowFromMenu();
				},
			},
			{
				label: multipleModelsLabel,
				title: unavailableTitle,
				icon: 'reasoning' as LxIconName,
				disabled: true,
			},
		];

		if (isAutoModelRoutingEnabled) {
			const autoItems = [autoItem].filter(item =>
				[
					item.label,
					item.title,
					item.description,
				]
					.filter(Boolean)
					.some(value => matchesKeyword(value)),
			);
			return autoItems.length > 0
				? autoItems
				: [{
					id: 'chat-model-empty',
					label: emptyLabel,
					disabled: true,
				}];
		}

		const filteredItems = [
			...items.filter(item =>
				[
					item.label,
					item.title,
				]
					.filter(Boolean)
					.some(value => matchesKeyword(value)),
			),
			...modelGroups.map(group =>
				this.createModelGroupMenuItem(group, isAutoModelRoutingEnabled),
			),
			...(matchesKeyword(`${addModelsLabel} ${addModelsTitle}`)
				? [{
					label: addModelsLabel,
					title: addModelsTitle,
					icon: 'gear' as LxIconName,
					onClick: () => {
						this.props.onOpenModelSettings();
					},
				}]
				: []),
		];

		if (filteredItems.length > 0) {
			return filteredItems;
		}

		return [
			{
				id: 'chat-model-empty',
				label: emptyLabel,
				disabled: true,
			},
		];
	}

	private getActiveLlmModelOptionValue() {
		return this.transientActiveLlmModelOptionValue
			?? this.props.activeLlmModelOptionValue;
	}

	private getIsMaxContextWindowEnabled() {
		return this.transientMaxContextWindowEnabled
			?? this.props.isMaxContextWindowEnabled;
	}

	private resolveManualModelOptionValue() {
		if (this.props.activeLlmModelOptionValue !== 'auto') {
			return this.props.activeLlmModelOptionValue;
		}

		return this.props.llmModelOptions.find(option => option.value !== 'auto')?.value
			?? this.props.activeLlmModelOptionValue;
	}

	private handleToggleAutoModelRoutingFromMenu() {
		const previousValue = this.getActiveLlmModelOptionValue();
		const nextValue = this.props.onToggleAutoModelRouting({
			suppressRender: true,
		});
		this.transientActiveLlmModelOptionValue =
			typeof nextValue === 'string'
				? nextValue
				: previousValue === 'auto'
					? this.resolveManualModelOptionValue()
					: 'auto';
		this.refreshModelDropdownActionViewItem();
	}

	private handleToggleMaxContextWindowFromMenu() {
		this.props.onToggleMaxContextWindow({ suppressRender: true });
		this.transientMaxContextWindowEnabled = !this.getIsMaxContextWindowEnabled();
		this.refreshModelDropdownActionViewItem();
	}

	private refreshModelDropdownActionViewItem() {
		this.modelDropdownActionViewItem?.setOptions(
			this.createModelDropdownActionViewItemOptions(),
		);
	}

	private getModelMenuGroups(): ChatModelMenuGroup[] {
		const groups = new Map<string, ChatModelMenuGroup>();

		for (const option of this.props.llmModelOptions) {
			if (option.value === 'auto') {
				continue;
			}

			const parsed = parseLlmModelOptionValue(option.value);
			const providerId = option.providerId ?? parsed?.providerId;
			const modelId = option.modelId ?? parsed?.modelId;
			if (!providerId || !modelId) {
				continue;
			}

			const key = `${providerId}:${modelId}`;
			const existing = groups.get(key);
			if (existing) {
				existing.options.push(option);
				existing.disabled = existing.disabled && Boolean(option.disabled);
				continue;
			}

			groups.set(key, {
				key,
				providerId,
				modelId,
				label: this.getModelOptionBaseLabel(option),
				title: option.title,
				icon: option.icon,
				disabled: Boolean(option.disabled),
				options: [option],
			});
		}

		return [...groups.values()];
	}

	private getModelOptionBaseLabel(option: ChatModelDropdownOption) {
		if (option.modelLabel) {
			return option.modelLabel;
		}

		return option.label
			.replace(/\s+\u00B7\s*(none|low|medium|high|xhigh|higher|highest|fast)$/i, '')
			.replace(/\s+[Nn]one$/, '')
			.replace(/\s+[Ll]ow$/, '')
			.replace(/\s+[Mm]edium$/, '')
			.replace(/\s+[Hh]igh$/, '')
			.replace(/\s+[Xx][Hh]igh$/, '')
			.replace(/\s+[Hh]igher$/, '')
			.replace(/\s+[Hh]ighest$/, '')
			.replace(/\s+[Ff]ast$/, '');
	}

	private createModelGroupMenuItem(
		group: ChatModelMenuGroup,
		isAutoModelRoutingEnabled: boolean,
	): ActionBarMenuItem {
		const active = this.getActiveModelGroupKey() === group.key;
		const disabled = group.disabled || isAutoModelRoutingEnabled;
		const hasRuntimeOptions = group.options.some(option =>
			Boolean(option.reasoningEffort ?? parseLlmModelOptionValue(option.value)?.reasoningEffort)
			|| Boolean(option.serviceTier ?? parseLlmModelOptionValue(option.value)?.serviceTier),
		);

		if (!hasRuntimeOptions) {
			return {
				label: group.label,
				title: group.title,
				icon: group.icon,
				checked: active,
				disabled,
				onClick: () => {
					this.props.onSelectLlmModel(this.resolvePreferredModelOptionValue(group));
				},
			};
		}

		return {
			label: group.label,
			title: group.title,
			icon: group.icon,
			checked: active,
			disabled,
			submenu: this.createModelGroupSubmenu(group),
		};
	}

	private createModelGroupSubmenu(group: ChatModelMenuGroup): ActionBarMenuItem[] {
		const activeRuntime = this.getActiveRuntimeParams(group);
		const submenu: ActionBarMenuItem[] = [
			{
				label: localize('chatModelUse', "Use model"),
				checked: this.getActiveModelGroupKey() === group.key,
				onClick: () => {
					this.props.onSelectLlmModel(this.resolvePreferredModelOptionValue(group));
				},
			},
		];

		const reasoningEfforts = this.getGroupReasoningEfforts(group);
		for (const effort of reasoningEfforts) {
			submenu.push({
				label: localize(
					'chatModelReasoning',
					"Reasoning: {0}",
					this.formatReasoningEffortLabel(effort),
				),
				checked:
					this.getActiveModelGroupKey() === group.key &&
					(activeRuntime.reasoningEffort ?? 'none') === effort,
				onClick: () => {
					this.props.onSelectLlmModel(
						this.resolveModelOptionValue(group, effort, activeRuntime.serviceTier),
					);
				},
			});
		}

		const supportsFast = group.options.some(option =>
			(option.serviceTier ?? parseLlmModelOptionValue(option.value)?.serviceTier) === 'priority',
		);
		if (supportsFast) {
			for (const serviceTier of [undefined, 'priority' as const]) {
				submenu.push({
					label: serviceTier === 'priority'
						? localize('chatModelFastOn', "Fast: On")
						: localize('chatModelFastOff', "Fast: Off"),
					checked:
						this.getActiveModelGroupKey() === group.key &&
						(activeRuntime.serviceTier ?? undefined) === serviceTier,
					onClick: () => {
						this.props.onSelectLlmModel(
							this.resolveModelOptionValue(group, activeRuntime.reasoningEffort, serviceTier),
						);
					},
				});
			}
		}

		return submenu;
	}

	private getActiveModelGroupKey() {
		const parsed = parseLlmModelOptionValue(this.props.activeLlmModelOptionValue);
		return parsed ? `${parsed.providerId}:${parsed.modelId}` : '';
	}

	private getActiveRuntimeParams(group: ChatModelMenuGroup) {
		const parsed = parseLlmModelOptionValue(this.props.activeLlmModelOptionValue);
		if (!parsed || `${parsed.providerId}:${parsed.modelId}` !== group.key) {
			return {
				reasoningEffort: this.getPreferredReasoningEffort(group),
				serviceTier: undefined as LlmServiceTier | undefined,
			};
		}

		return {
			reasoningEffort: parsed.reasoningEffort,
			serviceTier: parsed.serviceTier,
		};
	}

	private getGroupReasoningEfforts(group: ChatModelMenuGroup) {
		const efforts = group.options
			.map(option => option.reasoningEffort ?? parseLlmModelOptionValue(option.value)?.reasoningEffort)
			.filter((effort): effort is LlmReasoningEffort => Boolean(effort));
		return [...new Set(efforts)];
	}

	private getPreferredReasoningEffort(group: ChatModelMenuGroup) {
		const efforts = this.getGroupReasoningEfforts(group);
		for (const effort of ['medium', 'low', 'high', 'xhigh', 'none'] as const) {
			if (efforts.includes(effort)) {
				return effort;
			}
		}
		return efforts[0];
	}

	private resolvePreferredModelOptionValue(group: ChatModelMenuGroup) {
		const activeRuntime = this.getActiveRuntimeParams(group);
		return this.resolveModelOptionValue(
			group,
			activeRuntime.reasoningEffort,
			activeRuntime.serviceTier,
		);
	}

	private resolveModelOptionValue(
		group: ChatModelMenuGroup,
		reasoningEffort?: LlmReasoningEffort,
		serviceTier?: LlmServiceTier,
	) {
		const candidate = serializeLlmModelOptionValue(
			group.providerId,
			group.modelId,
			reasoningEffort,
			serviceTier,
		);
		if (group.options.some(option => option.value === candidate)) {
			return candidate;
		}

		const withoutServiceTier = serializeLlmModelOptionValue(
			group.providerId,
			group.modelId,
			reasoningEffort,
		);
		if (group.options.some(option => option.value === withoutServiceTier)) {
			return withoutServiceTier;
		}

		const base = serializeLlmModelOptionValue(group.providerId, group.modelId);
		if (group.options.some(option => option.value === base)) {
			return base;
		}

		return group.options[0]?.value ?? base;
	}

	private formatReasoningEffortLabel(reasoningEffort: LlmReasoningEffort) {
		switch (reasoningEffort) {
			case 'none':
				return localize('chatReasoningNone', "None");
			case 'low':
				return localize('chatReasoningLow', "Low");
			case 'medium':
				return localize('chatReasoningMedium', "Medium");
			case 'high':
				return localize('chatReasoningHigh', "High");
			case 'xhigh':
				return localize('chatReasoningXhigh', "Xhigh");
			case 'higher':
				return localize('chatReasoningHigher', "Higher");
			case 'highest':
				return localize('chatReasoningHighest', "Highest");
		}
	}
}

