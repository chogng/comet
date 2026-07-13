/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Event } from 'cs/base/common/event';
import { commandsRegistry } from 'cs/platform/commands/common/commands';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { SessionsLayoutCommandIds } from 'cs/sessions/common/layoutCommands';
import { SessionsLayoutActionsContribution } from 'cs/sessions/contrib/layout/browser/layoutActions';
import type {
	ISessionsPartSizes,
	ISessionsLayoutService,
	SessionsLayoutMode,
} from 'cs/sessions/services/layout/browser/layoutService';
import type { ISessionsLayoutState } from 'cs/sessions/services/layout/browser/layoutPolicy';

test('Sessions layout commands use the injected layout owner and unregister with their contribution', () => {
	const calls: unknown[][] = [];
	const layoutService: ISessionsLayoutService = {
		_serviceBrand: undefined,
		onDidChangeLayoutState: Event.None,
		onDidChangeLayoutGeometry: Event.None,
		getLayoutState(): ISessionsLayoutState {
			throw new Error('Unexpected layout state read.');
		},
		getLayoutGeometry() {
			return undefined;
		},
		setLayoutGeometry(): void {
			throw new Error('Unexpected layout geometry mutation.');
		},
		setViewport(): void {
			throw new Error('Unexpected viewport mutation.');
		},
		applyStartupLayoutMode(): boolean {
			throw new Error('Unexpected startup layout mutation.');
		},
		applyLayoutMode(mode: SessionsLayoutMode): void {
			calls.push(['applyLayoutMode', mode]);
		},
		setPartSizes(_sizes: ISessionsPartSizes): void {
			throw new Error('Unexpected Part size mutation.');
		},
		setSidebarVisible(): void {
			throw new Error('Unexpected Sidebar visibility mutation.');
		},
		setSidebarSize(): void {
			throw new Error('Unexpected Sidebar size mutation.');
		},
		toggleSidebarVisibility(): void {
			calls.push(['toggleSidebarVisibility']);
		},
		setEditorCollapsed(): void {
			throw new Error('Unexpected Editor collapse mutation.');
		},
		toggleEditorCollapsed(expandedEditorSize?: number): void {
			calls.push(['toggleEditorCollapsed', expandedEditorSize]);
		},
	};
	const accessor = {
		get(): never {
			throw new Error('Sessions layout commands must not resolve services through an accessor.');
		},
	} as ServicesAccessor;
	const contribution = new SessionsLayoutActionsContribution(layoutService);

	try {
		commandsRegistry.getCommand(SessionsLayoutCommandIds.applyAgentLayout)?.handler(accessor);
		commandsRegistry.getCommand(SessionsLayoutCommandIds.applyFlowLayout)?.handler(accessor);
		commandsRegistry.getCommand(SessionsLayoutCommandIds.toggleSidebarVisibility)?.handler(accessor);
		commandsRegistry.getCommand(SessionsLayoutCommandIds.toggleEditorCollapsed)?.handler(accessor, 640);

		assert.deepEqual(calls, [
			['applyLayoutMode', 'agent'],
			['applyLayoutMode', 'flow'],
			['toggleSidebarVisibility'],
			['toggleEditorCollapsed', 640],
		]);
	} finally {
		contribution.dispose();
	}

	for (const commandId of Object.values(SessionsLayoutCommandIds)) {
		assert.equal(commandsRegistry.getCommand(commandId), null);
	}
});
