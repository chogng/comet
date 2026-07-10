/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { getZoomLevel, onDidChangeZoomLevel } from 'cs/base/browser/browser';
import { mainWindow } from 'cs/base/browser/window';
import {
	BrowserPageZoomSettingId,
	defaultBrowserPageZoom,
} from 'cs/base/parts/sandbox/common/browserSettings';
import { status } from 'cs/base/browser/ui/aria/aria';
import { disposableTimeout } from 'cs/base/common/async';
import { Codicon } from 'cs/base/common/codicons';
import { Disposable, DisposableStore, MutableDisposable } from 'cs/base/common/lifecycle';
import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { ThemeIcon } from 'cs/base/common/themables';
import { localize, localize2 } from 'cs/nls';
import { Action2, MenuId, registerAction2 } from 'cs/platform/actions/common/actions';
import {
	browserZoomAccessibilityLabel,
	browserZoomFactors,
	browserZoomLabel,
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
import {
	BrowserZoomService,
	IBrowserZoomService,
	MATCH_WINDOW_ZOOM_LABEL,
} from 'cs/workbench/contrib/browserView/common/browserZoomService';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserActionGroup,
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	CONTEXT_BROWSER_FOCUSED,
	CONTEXT_BROWSER_HAS_ERROR,
	CONTEXT_BROWSER_HAS_URL,
	type IBrowserEditorWidget,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

const CONTEXT_BROWSER_CAN_ZOOM_IN = new RawContextKey<boolean>('browserCanZoomIn', true);
const CONTEXT_BROWSER_CAN_ZOOM_OUT = new RawContextKey<boolean>('browserCanZoomOut', true);
class BrowserZoomPill extends Disposable {
	readonly element: HTMLElement;
	private readonly icon: HTMLElement;
	private readonly label: HTMLElement;
	private readonly timeout = this._register(new MutableDisposable());

	constructor() {
		super();
		this.element = $('.browser-zoom-pill');
		this.element.setAttribute('aria-hidden', 'true');
		this.icon = $('span');
		this.label = $('span');
		this.element.append(this.icon, this.label);
	}

	show(zoomLabel: string, isAtOrAboveDefault: boolean): void {
		this.icon.className = ThemeIcon.asClassName(isAtOrAboveDefault ? Codicon.zoomIn : Codicon.zoomOut);
		this.label.textContent = zoomLabel;
		this.element.classList.add('visible');
		this.timeout.value = disposableTimeout(() => {
			this.element.classList.remove('visible');
		}, 750);
	}
}

export class BrowserEditorZoomSupport extends BrowserEditorContribution {
	private readonly zoomPill: BrowserZoomPill;
	private readonly canZoomInContext: ContextKey<boolean>;
	private readonly canZoomOutContext: ContextKey<boolean>;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IBrowserZoomService private readonly browserZoomService: IBrowserZoomService,
	) {
		super(editor);
		this.canZoomInContext = CONTEXT_BROWSER_CAN_ZOOM_IN.bindTo(contextKeyService);
		this.canZoomOutContext = CONTEXT_BROWSER_CAN_ZOOM_OUT.bindTo(contextKeyService);
		this.zoomPill = this._register(new BrowserZoomPill());
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [{
			location: BrowserWidgetLocation.PostUrl,
			element: this.zoomPill.element,
			order: 0,
		}];
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
		await this.editor.model?.zoomIn();
		this.showZoomPill();
	}

	async zoomOut(): Promise<void> {
		await this.editor.model?.zoomOut();
		this.showZoomPill();
	}

	async resetZoom(): Promise<void> {
		await this.editor.model?.resetZoom();
		this.showZoomPill();
	}

	private updateZoomContext(model: IBrowserViewModel): void {
		this.canZoomInContext.set(model.canZoomIn);
		this.canZoomOutContext.set(model.canZoomOut);
	}

	private showZoomPill(): void {
		const model = this.editor.model;
		if (!model) {
			return;
		}
		const defaultFactor = browserZoomFactors[this.browserZoomService.getEffectiveZoomIndex(undefined, false)];
		const currentFactor = model.zoomFactor;
		this.zoomPill.show(browserZoomLabel(currentFactor), currentFactor >= defaultFactor);
		status(browserZoomAccessibilityLabel(currentFactor));
	}
}

BrowserEditor.registerContribution(BrowserEditorZoomSupport);

function getBrowserEditor(candidate: unknown): BrowserEditor | undefined {
	return candidate instanceof BrowserEditor ? candidate : undefined;
}

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
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Zoom,
				order: 1,
				when: CONTEXT_BROWSER_CAN_ZOOM_IN.isEqualTo(true),
				isHiddenByDefault: true,
			},
			keybinding: {
				when: CONTEXT_BROWSER_FOCUSED.isEqualTo(true),
				weight: KeybindingWeight.WorkbenchContrib + 75,
				primary: KeyMod.CtrlCmd | KeyCode.Equal,
				secondary: [
					KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Equal,
					KeyMod.CtrlCmd | KeyCode.NumpadAdd,
				],
			},
		});
	}

	async run(_accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		await getBrowserEditor(browserEditor)?.getContribution(BrowserEditorZoomSupport)?.zoomIn();
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
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Zoom,
				order: 2,
				when: CONTEXT_BROWSER_CAN_ZOOM_OUT.isEqualTo(true),
				isHiddenByDefault: true,
			},
			keybinding: {
				when: CONTEXT_BROWSER_FOCUSED.isEqualTo(true),
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

	async run(_accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		await getBrowserEditor(browserEditor)?.getContribution(BrowserEditorZoomSupport)?.zoomOut();
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
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Zoom,
				order: 3,
				isHiddenByDefault: true,
			},
			keybinding: {
				when: CONTEXT_BROWSER_FOCUSED.isEqualTo(true),
				weight: KeybindingWeight.WorkbenchContrib + 75,
				primary: KeyMod.CtrlCmd | KeyCode.Numpad0,
			},
		});
	}

	async run(_accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		await getBrowserEditor(browserEditor)?.getContribution(BrowserEditorZoomSupport)?.resetZoom();
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
