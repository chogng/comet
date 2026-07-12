/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export interface ISessionsLayoutState {
	readonly mode: 'agent' | 'flow';
	readonly isSidebarVisible: boolean;
	readonly sidebarSize: number;
	readonly isEditorCollapsed: boolean;
	readonly expandedEditorSize: number;
}

export interface ISessionsLayoutViewport {
	readonly width: number;
	readonly height: number;
}

export const ISessionsLayoutPolicy = createDecorator<ISessionsLayoutPolicy>('sessionsLayoutPolicy');

export interface ISessionsLayoutPolicy {
	readonly _serviceBrand: undefined;
	createInitialState(): ISessionsLayoutState;
	arrange(viewport: ISessionsLayoutViewport, state: ISessionsLayoutState): ISessionsLayoutState;
}

let registeredPolicy = false;

export function registerSessionsLayoutPolicy(
	policy: new () => ISessionsLayoutPolicy,
): void {
	if (registeredPolicy) {
		throw new Error('A Sessions layout policy is already registered.');
	}

	registeredPolicy = true;
	registerSingleton(ISessionsLayoutPolicy, policy, InstantiationType.Delayed);
}
