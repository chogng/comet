/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { localize2 } from 'cs/nls';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import { ContextKeyExpr } from 'cs/platform/contextkey/common/contextkey';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { IOpenerService } from 'cs/platform/opener/common/opener';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserEditor,
	CONTEXT_BROWSER_CAN_GO_BACK,
	CONTEXT_BROWSER_CAN_GO_FORWARD,
	CONTEXT_BROWSER_HAS_URL,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';

function requireBrowserEditor(accessor: ServicesAccessor, candidate: unknown): BrowserEditor {
	const editor = candidate === undefined
		? accessor.get(IEditorService).activeEditorPane
		: candidate;
	if (!(editor instanceof BrowserEditor)) {
		throw new Error('The Browser action target is not the active Browser editor.');
	}
	return editor;
}

const BROWSER_EDITOR_FOCUSED = ContextKeyExpr.and(
	BROWSER_EDITOR_ACTIVE,
	ActiveEditorFocusedContext.isEqualTo(true),
);

class BrowserGoBackAction extends Action2 {
	constructor() {
		const precondition = ContextKeyExpr.and(
			BROWSER_EDITOR_ACTIVE,
			CONTEXT_BROWSER_CAN_GO_BACK.isEqualTo(true),
		);
		super({
			id: BrowserViewCommandId.GoBack,
			title: localize2('browser.goBackAction', "Back"),
			category: BrowserActionCategory,
			icon: Codicon.arrowLeft,
			f1: true,
			precondition,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 50,
				primary: KeyMod.Alt | KeyCode.LeftArrow,
				mac: {
					primary: KeyMod.CtrlCmd | KeyCode.BracketLeft,
					secondary: [KeyMod.CtrlCmd | KeyCode.LeftArrow],
				},
				when: ContextKeyExpr.and(precondition, ActiveEditorFocusedContext.isEqualTo(true)),
			},
		});
	}

	async run(accessor: ServicesAccessor, candidate?: unknown): Promise<void> {
		await requireBrowserEditor(accessor, candidate).goBack();
	}
}

class BrowserGoForwardAction extends Action2 {
	constructor() {
		const precondition = ContextKeyExpr.and(
			BROWSER_EDITOR_ACTIVE,
			CONTEXT_BROWSER_CAN_GO_FORWARD.isEqualTo(true),
		);
		super({
			id: BrowserViewCommandId.GoForward,
			title: localize2('browser.goForwardAction', "Forward"),
			category: BrowserActionCategory,
			icon: Codicon.arrowRight,
			f1: true,
			precondition,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 50,
				primary: KeyMod.Alt | KeyCode.RightArrow,
				mac: {
					primary: KeyMod.CtrlCmd | KeyCode.BracketRight,
					secondary: [KeyMod.CtrlCmd | KeyCode.RightArrow],
				},
				when: ContextKeyExpr.and(precondition, ActiveEditorFocusedContext.isEqualTo(true)),
			},
		});
	}

	async run(accessor: ServicesAccessor, candidate?: unknown): Promise<void> {
		await requireBrowserEditor(accessor, candidate).goForward();
	}
}

class BrowserReloadAction extends Action2 {
	constructor() {
		const precondition = ContextKeyExpr.and(
			BROWSER_EDITOR_ACTIVE,
			CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
		);
		super({
			id: BrowserViewCommandId.Reload,
			title: localize2('browser.reloadAction', "Reload"),
			category: BrowserActionCategory,
			icon: Codicon.refresh,
			f1: true,
			precondition,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 75,
				primary: KeyMod.CtrlCmd | KeyCode.KeyR,
				secondary: [KeyCode.F5],
				mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyR, secondary: [] },
				when: BROWSER_EDITOR_FOCUSED,
			},
		});
	}

	async run(accessor: ServicesAccessor, candidate?: unknown): Promise<void> {
		await requireBrowserEditor(accessor, candidate).reload();
	}
}

class BrowserHardReloadAction extends Action2 {
	constructor() {
		const precondition = ContextKeyExpr.and(
			BROWSER_EDITOR_ACTIVE,
			CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
		);
		super({
			id: BrowserViewCommandId.HardReload,
			title: localize2('browser.hardReloadAction', "Hard Reload"),
			category: BrowserActionCategory,
			icon: Codicon.debugRestart,
			f1: true,
			precondition,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib + 75,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyR,
				secondary: [KeyMod.CtrlCmd | KeyCode.F5],
				mac: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyR,
					secondary: [],
				},
				when: BROWSER_EDITOR_FOCUSED,
			},
		});
	}

	async run(accessor: ServicesAccessor, candidate?: unknown): Promise<void> {
		await requireBrowserEditor(accessor, candidate).reload(true);
	}
}

class BrowserFocusUrlInputAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.FocusUrlInput,
			title: localize2('browser.focusUrlInputAction', "Focus URL Input"),
			category: BrowserActionCategory,
			icon: Codicon.search,
			f1: true,
			precondition: BROWSER_EDITOR_ACTIVE,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KeyL,
				when: BROWSER_EDITOR_FOCUSED,
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IEditorGroupsService).mainPart.focusPrimaryInput();
	}
}

class BrowserOpenExternalAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.OpenExternal,
			title: localize2('browser.openExternalAction', "Open in External Browser"),
			category: BrowserActionCategory,
			icon: Codicon.linkExternal,
			f1: true,
			precondition: ContextKeyExpr.and(
				BROWSER_EDITOR_ACTIVE,
				CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
			),
		});
	}

	async run(accessor: ServicesAccessor, candidate?: unknown): Promise<void> {
		const model = requireBrowserEditor(accessor, candidate).model;
		if (!model?.url) {
			throw new Error('The active Browser editor has no URL to open externally.');
		}
		await accessor.get(IOpenerService).open(model.url, {
			openExternal: true,
			allowContributedOpeners: false,
		});
	}
}

registerAction2(BrowserGoBackAction);
registerAction2(BrowserGoForwardAction);
registerAction2(BrowserReloadAction);
registerAction2(BrowserHardReloadAction);
registerAction2(BrowserFocusUrlInputAction);
registerAction2(BrowserOpenExternalAction);
