/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ISessionsLayoutPolicy,
	ISessionsLayoutState,
	ISessionsLayoutViewport,
} from 'cs/sessions/services/layout/browser/layoutPolicy';

const MinimumSidebarSize = 220;
const MinimumEditorSize = 420;
const DefaultSidebarSize = 250;

function normalizeSize(value: number, minimum: number): number {
	return Math.max(minimum, Math.round(value));
}

export class StandardSessionsLayoutPolicy implements ISessionsLayoutPolicy {
	declare readonly _serviceBrand: undefined;

	createInitialState(): ISessionsLayoutState {
		return {
			mode: 'agent',
			isSidebarVisible: true,
			sidebarSize: DefaultSidebarSize,
			isEditorCollapsed: true,
			expandedEditorSize: MinimumEditorSize,
		};
	}

	arrange(
		_viewport: ISessionsLayoutViewport,
		state: ISessionsLayoutState,
	): ISessionsLayoutState {
		return {
			...state,
			sidebarSize: normalizeSize(state.sidebarSize, MinimumSidebarSize),
			expandedEditorSize: normalizeSize(state.expandedEditorSize, MinimumEditorSize),
		};
	}
}
