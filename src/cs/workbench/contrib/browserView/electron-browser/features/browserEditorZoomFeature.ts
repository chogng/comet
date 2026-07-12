/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getZoomLevel, onDidChangeZoomLevel } from 'cs/base/browser/browser';
import { mainWindow } from 'cs/base/browser/window';
import {
	BrowserPageZoomSettingId,
	defaultBrowserPageZoom,
} from 'cs/base/parts/sandbox/common/browserSettings';
import { status } from 'cs/base/browser/ui/aria/aria';
import { Codicon } from 'cs/base/common/codicons';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { localize, localize2 } from 'cs/nls';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import {
	browserZoomAccessibilityLabel,
	browserZoomFactors,
} from 'cs/platform/browserView/common/browserView';
import {
	configurationRegistry,
	ConfigurationScope,
} from 'cs/platform/configuration/common/configurationRegistry';
import { ContextKeyExpr, IContextKeyService, RawContextKey, type ContextKey } from 'cs/platform/contextkey/common/contextkey';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { zoomLevelToZoomFactor } from 'cs/platform/window/common/window';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import {
	BrowserZoomService,
	IBrowserZoomService,
	MATCH_WINDOW_ZOOM_LABEL,
} from 'cs/workbench/contrib/browserView/common/browserZoomService';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserEditor,
	BrowserEditorContribution,
	CONTEXT_BROWSER_HAS_ERROR,
	CONTEXT_BROWSER_HAS_URL,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';

const CONTEXT_BROWSER_CAN_ZOOM_IN = new RawContextKey<boolean>('browserCanZoomIn', true);
const CONTEXT_BROWSER_CAN_ZOOM_OUT = new RawContextKey<boolean>('browserCanZoomOut', true);

export class BrowserEditorZoomSupport extends BrowserEditorContribution {
	private readonly canZoomInContext: ContextKey<boolean>;
	private readonly canZoomOutContext: ContextKey<boolean>;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super(editor);
		this.canZoomInContext = CONTEXT_BROWSER_CAN_ZOOM_IN.bindTo(contextKeyService);
		this.canZoomOutContext = CONTEXT_BROWSER_CAN_ZOOM_OUT.bindTo(contextKeyService);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.updateZoomContext(model);
		store.add(model.onDidChangeZoom(() => this.updateZoomContext(model)));
	}

	override onModelDetached(): void {
		this.canZoomInContext.reset();
		this.canZoomOutContext.reset();
	}

	async zoomIn(): Promise<void> {
		const model = this.editor.model;
		if (!model) {
			throw new Error('The Browser editor has no attached model.');
		}
		await model.zoomIn();
		this.announceZoom(model);
	}

	async zoomOut(): Promise<void> {
		const model = this.editor.model;
		if (!model) {
			throw new Error('The Browser editor has no attached model.');
		}
		await model.zoomOut();
		this.announceZoom(model);
	}

	async resetZoom(): Promise<void> {
		const model = this.editor.model;
		if (!model) {
			throw new Error('The Browser editor has no attached model.');
		}
		await model.resetZoom();
		this.announceZoom(model);
	}

	private updateZoomContext(model: IBrowserViewModel): void {
		this.canZoomInContext.set(model.canZoomIn);
		this.canZoomOutContext.set(model.canZoomOut);
	}

	private announceZoom(model: IBrowserViewModel): void {
		status(browserZoomAccessibilityLabel(model.zoomFactor));
	}
}

BrowserEditor.registerContribution(BrowserEditorZoomSupport);

const browserCanShowZoomActions = ContextKeyExpr.and(
	BROWSER_EDITOR_ACTIVE,
	CONTEXT_BROWSER_HAS_URL.isEqualTo(true),
	CONTEXT_BROWSER_HAS_ERROR.isEqualTo(false),
);

class BrowserZoomInAction extends Action2 {
	static readonly ID = 'workbench.action.browser.zoomIn';

	constructor() {
		super({
			id: BrowserZoomInAction.ID,
			title: localize2('browser.zoomInAction', "Zoom In"),
			category: BrowserActionCategory,
			icon: Codicon.zoomIn,
			f1: true,
			precondition: browserCanShowZoomActions,
			keybinding: {
				when: ActiveEditorFocusedContext.isEqualTo(true),
				weight: KeybindingWeight.WorkbenchContrib + 75,
				primary: KeyMod.CtrlCmd | KeyCode.Equal,
				secondary: [
					KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Equal,
					KeyMod.CtrlCmd | KeyCode.NumpadAdd,
				],
			},
		});
	}

	async run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		if (!(browserEditor instanceof BrowserEditor)) {
			throw new Error('The zoom in action target is not the active Browser editor.');
		}
		const contribution = browserEditor.getContribution(BrowserEditorZoomSupport);
		if (!contribution) {
			throw new Error('The active Browser editor has no zoom contribution.');
		}
		await contribution.zoomIn();
	}
}

class BrowserZoomOutAction extends Action2 {
	static readonly ID = 'workbench.action.browser.zoomOut';

	constructor() {
		super({
			id: BrowserZoomOutAction.ID,
			title: localize2('browser.zoomOutAction', "Zoom Out"),
			category: BrowserActionCategory,
			icon: Codicon.zoomOut,
			f1: true,
			precondition: browserCanShowZoomActions,
			keybinding: {
				when: ActiveEditorFocusedContext.isEqualTo(true),
				weight: KeybindingWeight.WorkbenchContrib + 75,
				primary: KeyMod.CtrlCmd | KeyCode.Minus,
				secondary: [
					KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Minus,
					KeyMod.CtrlCmd | KeyCode.NumpadSubtract,
				],
				linux: {
					primary: KeyMod.CtrlCmd | KeyCode.Minus,
					secondary: [KeyMod.CtrlCmd | KeyCode.NumpadSubtract],
				},
			},
		});
	}

	async run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		if (!(browserEditor instanceof BrowserEditor)) {
			throw new Error('The zoom out action target is not the active Browser editor.');
		}
		const contribution = browserEditor.getContribution(BrowserEditorZoomSupport);
		if (!contribution) {
			throw new Error('The active Browser editor has no zoom contribution.');
		}
		await contribution.zoomOut();
	}
}

class BrowserResetZoomAction extends Action2 {
	static readonly ID = 'workbench.action.browser.resetZoom';

	constructor() {
		super({
			id: BrowserResetZoomAction.ID,
			title: localize2('browser.resetZoomAction', "Reset Zoom"),
			category: BrowserActionCategory,
			icon: Codicon.screenNormal,
			f1: true,
			precondition: browserCanShowZoomActions,
			keybinding: {
				when: ActiveEditorFocusedContext.isEqualTo(true),
				weight: KeybindingWeight.WorkbenchContrib + 75,
				primary: KeyMod.CtrlCmd | KeyCode.Numpad0,
			},
		});
	}

	async run(accessor: ServicesAccessor, browserEditor: unknown = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		if (!(browserEditor instanceof BrowserEditor)) {
			throw new Error('The reset zoom action target is not the active Browser editor.');
		}
		const contribution = browserEditor.getContribution(BrowserEditorZoomSupport);
		if (!contribution) {
			throw new Error('The active Browser editor has no zoom contribution.');
		}
		await contribution.resetZoom();
	}
}

registerAction2(BrowserZoomInAction);
registerAction2(BrowserZoomOutAction);
registerAction2(BrowserResetZoomAction);

class BrowserWindowZoomSynchronizer extends Disposable {
	constructor(@IBrowserZoomService browserZoomService: IBrowserZoomService) {
		super();
		browserZoomService.notifyWindowZoomChanged(zoomLevelToZoomFactor(getZoomLevel(mainWindow)));
		this._register(onDidChangeZoomLevel(() => {
			browserZoomService.notifyWindowZoomChanged(zoomLevelToZoomFactor(getZoomLevel(mainWindow)));
		}));
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(BrowserWindowZoomSynchronizer),
);

registerSingleton(IBrowserZoomService, BrowserZoomService, InstantiationType.Delayed);

configurationRegistry.registerConfigurationProperties({
	[BrowserPageZoomSettingId]: {
		type: 'string',
		enum: [
			MATCH_WINDOW_ZOOM_LABEL,
			...browserZoomFactors.map(factor => `${Math.round(factor * 100)}%`),
		],
		markdownEnumDescriptions: [
			localize(
				{ key: 'browser.defaultZoomLevel.matchWindow', comment: ['This is the description for a setting enum value.'] },
				"Matches the application's current UI zoom level.",
			),
			...browserZoomFactors.map(() => ''),
		],
		default: defaultBrowserPageZoom,
		markdownDescription: localize(
			{ key: 'browser.pageZoom', comment: ['This is the description for a setting.'] },
			"Default zoom level for all sites in the Integrated Browser.",
		),
		scope: ConfigurationScope.MACHINE,
	},
});
