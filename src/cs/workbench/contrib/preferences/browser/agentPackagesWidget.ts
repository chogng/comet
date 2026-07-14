/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IContextViewProvider } from 'cs/base/browser/ui/contextview/contextview';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import type { IHoverService } from 'cs/platform/hover/browser/hover';
import type { IAgentConfigurationPropertySchema } from 'cs/platform/agentHost/common/configuration';
import type {
	AgentHostAuthorityId,
	AgentId,
	AgentPackageId,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import { createSettingsRow, createSettingsSection } from 'cs/workbench/contrib/preferences/browser/section';
import type { SettingsController } from 'cs/workbench/contrib/preferences/browser/settingsController';
import type { SettingsViewState } from 'cs/workbench/contrib/preferences/browser/settingsTypes';
import {
	buildSettingsButton,
	buildSettingsHint,
	buildSettingsInput,
	buildSettingsSelect,
	buildSettingsSwitch,
	createSettingsElement,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';

function createStatus(value: string): HTMLElement {
	const status = createSettingsElement('span', 'comet-settings-hint');
	status.textContent = value;
	return status;
}

function packageStatus(
	state: SettingsViewState,
	target: SettingsViewState['agentHostManagement']['targets'][number],
	packageId: AgentPackageId,
): string {
	if (target.pendingPackages.includes(packageId)) {
		return state.labels.settingsAgentWorking;
	}
	const installed = target.packages.installedPackages.find(candidate => candidate.packageId === packageId);
	if (installed?.distribution === 'bundled') {
		return state.labels.settingsAgentBuiltIn;
	}
	if (target.packages.activations.some(candidate => candidate.packageId === packageId)) {
		return state.labels.settingsAgentReady;
	}
	if (installed !== undefined) {
		return state.labels.settingsAgentInstalled;
	}
	return state.labels.settingsAgentNotInstalled;
}

function createPackageControl(
	state: SettingsViewState,
	target: SettingsViewState['agentHostManagement']['targets'][number],
	packageId: AgentPackageId,
	controller: SettingsController,
	hoverService: IHoverService,
	disposables: DisposableStore,
): HTMLElement {
	const pending = target.pendingPackages.includes(packageId);
	if (pending) {
		return createStatus(state.labels.settingsAgentWorking);
	}
	const installed = target.packages.installedPackages.find(candidate => candidate.packageId === packageId);
	if (installed?.distribution === 'bundled') {
		return createStatus(state.labels.settingsAgentBuiltIn);
	}
	if (installed !== undefined) {
		return buildSettingsButton({
			label: state.labels.settingsAgentUninstall,
			focusKey: `agent-package.${target.authority}.${packageId}.uninstall`,
			disabled: !target.supportsPackageOperations,
			onClick: () => void controller.uninstallAgentPackage(target.authority, packageId),
		}, hoverService, disposables);
	}
	return buildSettingsButton({
		label: state.labels.settingsAgentInstall,
		focusKey: `agent-package.${target.authority}.${packageId}.install`,
		disabled: !target.supportsPackageOperations,
		onClick: () => void controller.installAgentPackage(target.authority, packageId),
	}, hoverService, disposables);
}

function configurationValue(
	property: IAgentConfigurationPropertySchema,
	explicitValue: AgentHostProtocolValue | undefined,
): AgentHostProtocolValue | undefined {
	return explicitValue === undefined ? property.default : explicitValue;
}

function parseStructuredValue(value: string): AgentHostProtocolValue {
	const parsed: unknown = JSON.parse(value);
	assertAgentHostProtocolValue(parsed);
	return parsed;
}

function buildConfigurationControl(
	state: SettingsViewState,
	authority: AgentHostAuthorityId,
	agentId: AgentId,
	property: IAgentConfigurationPropertySchema,
	explicitValue: AgentHostProtocolValue | undefined,
	pending: boolean,
	controller: SettingsController,
	contextViewProvider: IContextViewProvider,
	hoverService: IHoverService,
	disposables: DisposableStore,
): HTMLElement {
	const control = createSettingsElement('div', 'comet-settings-input-row');
	const focusKey = `agent-configuration.${authority}.${agentId}.${property.id}`;
	const value = configurationValue(property, explicitValue);
	const applyValue = (nextValue: AgentHostProtocolValue) => {
		void controller.updateAgentDefault(authority, agentId, property.id, nextValue);
	};

	if (property.value.type === 'boolean') {
		control.append(buildSettingsSwitch({
			checked: value === true,
			focusKey,
			disabled: pending,
			onChange: applyValue,
		}, disposables));
	} else if (property.value.type === 'string' && property.value.enum !== undefined) {
		const enumIndex = explicitValue === undefined
			? -1
			: property.value.enum.indexOf(String(explicitValue));
		if (explicitValue !== undefined && enumIndex < 0) {
			throw new Error(`Agent configuration property '${property.id}' has a value outside its enum.`);
		}
		control.append(buildSettingsSelect(
			[
				{ value: 'default', label: state.labels.settingsAgentUseDefault, isDisabled: pending },
				...property.value.enum.map((option, index) => ({
					value: `value:${index}`,
					label: option,
					isDisabled: pending,
				})),
			],
			enumIndex < 0 ? 'default' : `value:${enumIndex}`,
			focusKey,
			selection => {
				if (selection === 'default') {
					void controller.removeAgentDefault(authority, agentId, property.id);
					return;
				}
				const index = Number(selection.slice('value:'.length));
				const selectedValue = property.value.type === 'string' ? property.value.enum?.[index] : undefined;
				if (selectedValue === undefined) {
					controller.reportInvalidAgentConfigurationValue();
					return;
				}
				applyValue(selectedValue);
			},
			contextViewProvider,
			'comet-settings-select-control',
			disposables,
		));
		return control;
	} else {
		const inputValue = property.value.type === 'string'
			? (typeof value === 'string' ? value : '')
			: value === undefined
				? ''
				: JSON.stringify(value);
		let pendingInputValue = inputValue;
		const input = buildSettingsInput({
			value: inputValue,
			className: 'comet-settings-input-control',
			focusKey,
			disabled: pending,
			onInput: nextValue => { pendingInputValue = nextValue; },
		}, disposables);
		const apply = () => {
			try {
				if (property.value.type === 'string') {
					applyValue(pendingInputValue);
					return;
				}
				if (property.value.type === 'number') {
					const numberValue = Number(pendingInputValue);
					if (!pendingInputValue.trim() || !Number.isFinite(numberValue)) {
						controller.reportInvalidAgentConfigurationValue();
						return;
					}
					applyValue(numberValue);
					return;
				}
				applyValue(parseStructuredValue(pendingInputValue));
			} catch {
				controller.reportInvalidAgentConfigurationValue();
			}
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				apply();
			}
		};
		input.inputElement.addEventListener('keydown', handleKeyDown);
		disposables.add(toDisposable(() => input.inputElement.removeEventListener('keydown', handleKeyDown)));
		control.append(input.element, buildSettingsButton({
			label: state.labels.settingsAgentApply,
			focusKey: `${focusKey}.apply`,
			disabled: pending,
			onClick: apply,
		}, hoverService, disposables));
	}

	control.append(buildSettingsButton({
		label: state.labels.settingsAgentUseDefault,
		focusKey: `${focusKey}.default`,
		disabled: pending || explicitValue === undefined,
		onClick: () => void controller.removeAgentDefault(authority, agentId, property.id),
	}, hoverService, disposables));
	return control;
}

export function renderAgentPackagesSection(
	state: SettingsViewState,
	controller: SettingsController,
	contextViewProvider: IContextViewProvider,
	hoverService: IHoverService,
	disposables: DisposableStore,
): HTMLElement {
	const container = createSettingsElement('div');
	const packages = createSettingsSection({
		title: state.labels.settingsAgentPackagesTitle,
		description: state.labels.settingsAgentPackagesHint,
	});
	const configuration = createSettingsSection({
		title: state.labels.settingsAgentConfigurationTitle,
		description: state.labels.settingsAgentConfigurationHint,
	});
	const models = createSettingsSection({
		title: state.labels.settingsAgentModelsTitle,
		description: state.labels.settingsAgentModelsHint,
	});

	if (state.agentHostManagement.targets.length === 0) {
		packages.panel.replaceChildren(buildSettingsHint(state.labels.settingsAgentNoHosts));
		configuration.panel.replaceChildren(buildSettingsHint(state.labels.settingsAgentNoHosts));
		models.panel.replaceChildren(buildSettingsHint(state.labels.settingsAgentNoHosts));
		container.append(packages.element, models.element, configuration.element);
		return container;
	}

	let modelCount = 0;
	for (const target of state.agentHostManagement.targets) {
		for (const agent of target.agents) {
			for (const model of agent.models) {
				modelCount += 1;
				models.list.append(createSettingsRow({
					title: model.displayName,
					description: `${target.label} · ${agent.displayName} · ${model.id} · ${model.revision}`,
					control: createStatus(model.enabled
						? state.labels.settingsAgentReady
						: state.labels.settingsAgentUnavailable),
				}));
			}
		}
	}
	if (modelCount === 0) {
		models.panel.replaceChildren(buildSettingsHint(state.labels.settingsAgentNoModels));
	}

	for (const target of state.agentHostManagement.targets) {
		const packageIds = new Set<AgentPackageId>();
		for (const offering of target.packages.installablePackages) {
			packageIds.add(offering.packageId);
		}
		for (const installed of target.packages.installedPackages) {
			packageIds.add(installed.packageId);
		}
		for (const packageId of [...packageIds].sort()) {
			const installed = target.packages.installedPackages.find(candidate => candidate.packageId === packageId);
			const offering = target.packages.installablePackages.find(candidate => candidate.packageId === packageId);
			const revision = installed?.revision ?? offering?.revision;
			if (revision === undefined) {
				throw new Error(`Agent package '${packageId}' has neither an installed record nor an offering.`);
			}
			packages.list.append(createSettingsRow({
				title: packageId,
				description: `${target.label} · ${revision} · ${packageStatus(state, target, packageId)}`,
				control: createPackageControl(state, target, packageId, controller, hoverService, disposables),
			}));
		}
	}

	let configurationPropertyCount = 0;
	for (const target of state.agentHostManagement.targets) {
		for (const defaults of target.agentDefaults) {
			const agent = target.agents.find(candidate => candidate.id === defaults.schema.agent);
			if (agent === undefined) {
				throw new Error(`Agent Host '${target.authority}' has configuration for unknown Agent '${defaults.schema.agent}'.`);
			}
			const pending = target.pendingConfigurations.includes(agent.id);
			for (const property of defaults.schema.properties) {
				configurationPropertyCount += 1;
				configuration.list.append(createSettingsRow({
					title: `${agent.displayName}: ${property.display.label}`,
					description: property.display.description
						? `${target.label} · ${property.display.description}`
						: target.label,
					control: buildConfigurationControl(
						state,
						target.authority,
						agent.id,
						property,
						defaults.values[property.id],
						pending,
						controller,
						contextViewProvider,
						hoverService,
						disposables,
					),
				}));
			}
			configuration.list.append(createSettingsRow({
				title: agent.displayName,
				description: target.label,
				control: buildSettingsButton({
					label: state.labels.settingsAgentResetConfiguration,
					focusKey: `agent-configuration.${target.authority}.${agent.id}.reset`,
					disabled: pending || Object.keys(defaults.values).length === 0,
					onClick: () => void controller.resetAgentDefaults(target.authority, agent.id),
				}, hoverService, disposables),
			}));
		}
	}
	if (configurationPropertyCount === 0) {
		configuration.panel.replaceChildren(buildSettingsHint(state.labels.settingsAgentNoConfiguration));
	}

	container.append(packages.element, models.element, configuration.element);
	return container;
}
