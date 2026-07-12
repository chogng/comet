/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'cs/base/common/lifecycle';
import {
	IContextKeyService,
	type ContextKey,
} from 'cs/platform/contextkey/common/contextkey';
import { SessionsContextKeys } from 'cs/sessions/common/contextkeys';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

interface ISessionsLayoutContextKeys {
	readonly sidebarVisible: ContextKey<boolean>;
	readonly editorCollapsed: ContextKey<boolean>;
}

class SessionsLayoutContextKeysContribution extends Disposable {
	private readonly keys: ISessionsLayoutContextKeys;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ISessionsLayoutService private readonly layoutService: ISessionsLayoutService,
	) {
		super();
		this.keys = {
			sidebarVisible: SessionsContextKeys.sidebarVisible.bindTo(contextKeyService),
			editorCollapsed: SessionsContextKeys.editorCollapsed.bindTo(contextKeyService),
		};
		this._register(this.layoutService.onDidChangeLayoutState(this.syncContextKeys, this));
		this.syncContextKeys();
	}

	override dispose(): void {
		this.keys.sidebarVisible.reset();
		this.keys.editorCollapsed.reset();
		super.dispose();
	}

	private syncContextKeys(): void {
		const state = this.layoutService.getLayoutState();
		this.keys.sidebarVisible.set(state.isSidebarVisible);
		this.keys.editorCollapsed.set(state.isEditorCollapsed);
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(SessionsLayoutContextKeysContribution),
);
