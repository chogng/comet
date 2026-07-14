/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { IAgentDescriptor } from 'cs/platform/agentHost/common/agent';
import type { IAgentConfigurationState } from 'cs/platform/agentHost/common/configuration';
import type {
	AgentHostAuthorityId,
	AgentConfigurationPropertyId,
	AgentId,
	AgentPackageId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentHostPackageCatalogState } from 'cs/platform/agentHost/common/packages';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';

export interface IAgentHostManagementTargetSnapshot {
	readonly authority: AgentHostAuthorityId;
	readonly label: string;
	readonly packages: IAgentHostPackageCatalogState;
	readonly supportsPackageOperations: boolean;
	readonly agents: readonly IAgentDescriptor[];
	readonly agentDefaults: readonly IAgentConfigurationState[];
	readonly pendingPackages: readonly AgentPackageId[];
	readonly pendingConfigurations: readonly AgentId[];
}

export interface IAgentHostManagementSnapshot {
	readonly targets: readonly IAgentHostManagementTargetSnapshot[];
}

export interface IAgentHostManagementTarget {
	readonly authority: AgentHostAuthorityId;
	readonly onDidChangeManagementState: Event<void>;
	getManagementSnapshot(): IAgentHostManagementTargetSnapshot;
	installPackage(packageId: AgentPackageId): Promise<void>;
	uninstallPackage(packageId: AgentPackageId): Promise<void>;
	updateAgentDefault(
		agentId: AgentId,
		propertyId: AgentConfigurationPropertyId,
		value: AgentHostProtocolValue,
	): Promise<void>;
	removeAgentDefault(agentId: AgentId, propertyId: AgentConfigurationPropertyId): Promise<void>;
	resetAgentDefaults(agentId: AgentId): Promise<void>;
}

export interface IAgentHostManagementService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<void>;
	getSnapshot(): IAgentHostManagementSnapshot;
	registerTarget(target: IAgentHostManagementTarget): IDisposable;
	installPackage(authority: AgentHostAuthorityId, packageId: AgentPackageId): Promise<void>;
	uninstallPackage(authority: AgentHostAuthorityId, packageId: AgentPackageId): Promise<void>;
	updateAgentDefault(
		authority: AgentHostAuthorityId,
		agentId: AgentId,
		propertyId: AgentConfigurationPropertyId,
		value: AgentHostProtocolValue,
	): Promise<void>;
	removeAgentDefault(
		authority: AgentHostAuthorityId,
		agentId: AgentId,
		propertyId: AgentConfigurationPropertyId,
	): Promise<void>;
	resetAgentDefaults(authority: AgentHostAuthorityId, agentId: AgentId): Promise<void>;
}

export const IAgentHostManagementService = createDecorator<IAgentHostManagementService>(
	'agentHostManagementService',
);

/** Owns the renderer-visible registry of exact Agent Host management targets. */
export class AgentHostManagementService extends Disposable implements IAgentHostManagementService {
	declare readonly _serviceBrand: undefined;

	private readonly targets = new Map<AgentHostAuthorityId, IAgentHostManagementTarget>();
	private readonly changeEmitter = this._register(new Emitter<void>());
	readonly onDidChange = this.changeEmitter.event;
	private snapshot: IAgentHostManagementSnapshot = Object.freeze({ targets: Object.freeze([]) });

	getSnapshot(): IAgentHostManagementSnapshot {
		return this.snapshot;
	}

	registerTarget(target: IAgentHostManagementTarget): IDisposable {
		if (this.targets.has(target.authority)) {
			throw new Error(`Agent Host management target '${target.authority}' is already registered.`);
		}
		this.targets.set(target.authority, target);
		const changeListener = target.onDidChangeManagementState(() => this.refreshSnapshot());
		this.refreshSnapshot();
		return toDisposable(() => {
			changeListener.dispose();
			if (this.targets.get(target.authority) === target) {
				this.targets.delete(target.authority);
				this.refreshSnapshot();
			}
		});
	}

	installPackage(authority: AgentHostAuthorityId, packageId: AgentPackageId): Promise<void> {
		return this.requireTarget(authority).installPackage(packageId);
	}

	uninstallPackage(authority: AgentHostAuthorityId, packageId: AgentPackageId): Promise<void> {
		return this.requireTarget(authority).uninstallPackage(packageId);
	}

	updateAgentDefault(
		authority: AgentHostAuthorityId,
		agentId: AgentId,
		propertyId: AgentConfigurationPropertyId,
		value: AgentHostProtocolValue,
	): Promise<void> {
		return this.requireTarget(authority).updateAgentDefault(agentId, propertyId, value);
	}

	removeAgentDefault(
		authority: AgentHostAuthorityId,
		agentId: AgentId,
		propertyId: AgentConfigurationPropertyId,
	): Promise<void> {
		return this.requireTarget(authority).removeAgentDefault(agentId, propertyId);
	}

	resetAgentDefaults(authority: AgentHostAuthorityId, agentId: AgentId): Promise<void> {
		return this.requireTarget(authority).resetAgentDefaults(agentId);
	}

	private requireTarget(authority: AgentHostAuthorityId): IAgentHostManagementTarget {
		const target = this.targets.get(authority);
		if (target === undefined) {
			throw new Error(`Agent Host management target '${authority}' is unavailable.`);
		}
		return target;
	}

	private refreshSnapshot(): void {
		this.snapshot = Object.freeze({
			targets: Object.freeze([...this.targets.values()]
				.map(target => target.getManagementSnapshot())
				.sort((left, right) => left.authority.localeCompare(right.authority))),
		});
		this.changeEmitter.fire();
	}
}

registerSingleton(
	IAgentHostManagementService,
	AgentHostManagementService,
	InstantiationType.Delayed,
);
