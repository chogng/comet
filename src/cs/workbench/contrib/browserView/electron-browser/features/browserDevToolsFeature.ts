/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { KeyCode } from 'cs/base/common/keyCodes';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import {
	ContextKeyExpr,
	IContextKeyService,
	RawContextKey,
	type ContextKey,
} from 'cs/platform/contextkey/common/contextkey';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { localize2 } from 'cs/nls';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserEditor,
	BrowserEditorContribution,
	CONTEXT_BROWSER_HAS_ERROR,
	CONTEXT_BROWSER_HAS_URL,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

const CONTEXT_BROWSER_DEVTOOLS_OPEN = new RawContextKey<boolean>(
	'browserDevToolsOpen',
	false,
);

class BrowserEditorDevToolsContribution extends BrowserEditorContribution {
	private readonly devToolsOpenContext: ContextKey<boolean>;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super(editor);
		this.devToolsOpenContext = CONTEXT_BROWSER_DEVTOOLS_OPEN.bindTo(contextKeyService);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.devToolsOpenContext.set(model.isDevToolsOpen);
		store.add(model.onDidChangeDevToolsState(event => {
			this.devToolsOpenContext.set(event.isDevToolsOpen);
		}));
	}

	override onModelDetached(): void {
		this.devToolsOpenContext.reset();
	}
}

BrowserEditor.registerContribution(BrowserEditorDevToolsContribution);

class ToggleDevToolsAction extends Action2 {
	static readonly ID = BrowserViewCommandId.ToggleDevTools;

	constructor() {
		super({
			id: ToggleDevToolsAction.ID,
			title: localize2('browser.toggleDevToolsAction', "Developer Tools"),
			category: BrowserActionCategory,
			icon: Codicon.developerTools,
			f1: true,
			precondition: ContextKeyExpr.and(
				BROWSER_EDITOR_ACTIVE,
				CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
				CONTEXT_BROWSER_HAS_ERROR.isEqualTo(false),
			),
			toggled: ContextKeyExpr.equals(CONTEXT_BROWSER_DEVTOOLS_OPEN.key, true),
			keybinding: {
				when: ActiveEditorFocusedContext.isEqualTo(true),
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyCode.F12,
			},
		});
	}

	async run(accessor: ServicesAccessor, browserEditor = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		if (!(browserEditor instanceof BrowserEditor)) {
			throw new Error('The developer tools action target is not the active Browser editor.');
		}
		const model = browserEditor.model;
		if (!model) {
			throw new Error('The active Browser editor has no attached model.');
		}
		await model.toggleDevTools();
	}
}

registerAction2(ToggleDevToolsAction);
