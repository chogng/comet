/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType, getWindow } from 'cs/base/browser/dom';
import { createActionBarView, type ActionBarView } from 'cs/base/browser/ui/actionbar/actionbar';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { Orientation, Sash, SashState, type ISashEvent } from 'cs/base/browser/ui/sash/sash';
import { SelectBox } from 'cs/base/browser/ui/selectbox/selectBox';
import { Codicon } from 'cs/base/common/codicons';
import { KeyCode } from 'cs/base/common/keyCodes';
import { Emitter } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { ThemeIcon } from 'cs/base/common/themables';
import { localize, localize2 } from 'cs/nls';
import { MenuWorkbenchToolBar } from 'cs/platform/actions/browser/toolbar';
import { Action2, MenuId, MenuRegistry, registerAction2 } from 'cs/platform/actions/common/actions';
import type { IBrowserDeviceProfile } from 'cs/platform/browserView/common/browserView';
import { IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { ContextKeyExpr, IContextKeyService, RawContextKey, type ContextKey } from 'cs/platform/contextkey/common/contextkey';
import { IHoverService } from 'cs/platform/hover/browser/hover';
import { IInstantiationService, type ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { IQuickInputService, type IQuickPickItem } from 'cs/platform/quickinput/common/quickInput';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserActionGroup,
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	type IBrowserEditorWidget,
	type IContainerLayout,
	type IContainerLayoutOverride,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

const CONTEXT_BROWSER_EMULATION_TOOLBAR_VISIBLE = new RawContextKey<boolean>('browserEmulationToolbarVisible', false);
const CONTEXT_BROWSER_EMULATION_IS_MOBILE = new RawContextKey<boolean>('browserEmulationIsMobile', false);
const CONTEXT_BROWSER_EMULATION_HAS_USER_AGENT = new RawContextKey<boolean>('browserEmulationHasUserAgent', false);

interface IBrowserDevicePreset {
	readonly name: string;
	readonly device?: IBrowserDeviceProfile;
}

const DEFAULT_BROWSER_DEVICE_PRESETS: readonly IBrowserDevicePreset[] = [
	{
		name: 'iPhone 15 Pro',
		device: { width: 393, height: 852, mobile: true, deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
	},
	{
		name: 'iPhone SE',
		device: { width: 375, height: 667, mobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
	},
	{
		name: 'Pixel 8',
		device: { width: 412, height: 915, mobile: true, deviceScaleFactor: 2.625, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' },
	},
	{
		name: 'iPad Mini',
		device: { width: 768, height: 1024, mobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
	},
];

const lastSettings: { device: IBrowserDeviceProfile | undefined; scale: number | undefined } = {
	device: undefined,
	scale: undefined,
};

class BrowserEmulationToolbar extends Disposable {
	private static readonly ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
	private static readonly AUTO_INDEX = 0;

	readonly element = $('.browser-emulation-toolbar');
	private readonly groupWrapper = $('.browser-emulation-toolbar-groups');
	private readonly widthInput: InputBox;
	private readonly heightInput: InputBox;
	private readonly dprInput: InputBox;
	private readonly zoom: SelectBox;
	private readonly swapDimensionsActionView: ActionBarView;
	private suppressChange = false;
	private autoFitScale = 1;

	constructor(
		private readonly support: BrowserEditorEmulationSupport,
		actionsContainer: HTMLElement,
		@IContextViewService contextViewService: IContextViewService,
		@IHoverService hoverService: IHoverService,
	) {
		super();
		this.element.style.display = 'none';
		this.element.appendChild(this.groupWrapper);

		const dimensions = this.appendGroup('dimensions');
		const dimensionsLabel = $('span.browser-emulation-toolbar-label');
		dimensionsLabel.textContent = localize('browser.device.dimensionsLabel', "Dimensions:");
		dimensions.appendChild(dimensionsLabel);
		this.widthInput = this.createNumberInput(dimensions, contextViewService, localize('browser.device.widthAriaLabel', "Viewport width"), 1, 9999);
		this.swapDimensionsActionView = this._register(createActionBarView({ hoverService }));
		dimensions.appendChild(this.swapDimensionsActionView.getElement());
		this.heightInput = this.createNumberInput(dimensions, contextViewService, localize('browser.device.heightAriaLabel', "Viewport height"), 1, 9999);

		const dprGroup = this.appendGroup('dpr');
		const dprLabel = $('span.browser-emulation-toolbar-label');
		dprLabel.textContent = localize('browser.device.dprLabel', "DPR:");
		dprGroup.appendChild(dprLabel);
		this.dprInput = this.createNumberInput(dprGroup, contextViewService, localize('browser.device.dprAriaLabel', "Device pixel ratio"), 0, 8, 'decimal');

		const zoomGroup = this.appendGroup('zoom');
		const zoomLabel = $('span.browser-emulation-toolbar-label');
		zoomLabel.textContent = localize('browser.device.scaleLabel', "Scale:");
		zoomGroup.appendChild(zoomLabel);
		this.zoom = this._register(new SelectBox(
			this.buildZoomOptions(),
			BrowserEmulationToolbar.AUTO_INDEX,
			contextViewService,
			{},
			{ ariaLabel: localize('browser.device.zoomAriaLabel', "Zoom factor") },
		));
		this.zoom.render(zoomGroup);

		this.element.appendChild($('.browser-emulation-toolbar-spacer'));
		this.element.appendChild(actionsContainer);

		this.registerEvents();
	}

	get isVisible(): boolean {
		return this.element.style.display !== 'none';
	}

	show(): void {
		this.element.style.display = '';
	}

	hide(): void {
		this.element.style.display = 'none';
	}

	setAutoFitScale(scale: number): void {
		const oldPercent = Math.round(this.autoFitScale * 100);
		this.autoFitScale = scale;
		if (oldPercent === Math.round(scale * 100)) {
			return;
		}
		const wasSuppressed = this.suppressChange;
		this.suppressChange = true;
		try {
			this.zoom.setOptions(this.buildZoomOptions(), this.currentZoomIndex());
		} finally {
			this.suppressChange = wasSuppressed;
		}
	}

	refresh(): void {
		const device = this.support.model?.device;
		this.suppressChange = true;
		try {
			this.widthInput.value = device?.width ? String(device.width) : '';
			this.heightInput.value = device?.height ? String(device.height) : '';
			this.dprInput.value = device?.deviceScaleFactor ? String(device.deviceScaleFactor) : '';
			this.zoom.select(this.currentZoomIndex());
			this.zoom.domNode.disabled = !device;
		} finally {
			this.suppressChange = false;
		}
		this.refreshSwapDimensionsAction(!!device?.width || !!device?.height);
	}

	private appendGroup(name: string): HTMLElement {
		const group = $(`.browser-emulation-toolbar-group.browser-emulation-toolbar-${name}`);
		this.groupWrapper.appendChild(group);
		return group;
	}

	private refreshSwapDimensionsAction(enabled: boolean): void {
		this.swapDimensionsActionView.setProps({
			items: [{
				id: 'browser.device.swapDimensions',
				label: localize('browser.device.swapDimensionsTitle', "Swap Dimensions"),
				content: $('span', { class: ThemeIcon.asClassName(Codicon.arrowSwap) }),
				mode: 'icon',
				disabled: !enabled,
				run: () => this.support.swapDimensions(),
			}],
		});
	}

	private createNumberInput(parent: HTMLElement, contextViewService: IContextViewService, label: string, min: number, max: number, inputMode: 'numeric' | 'decimal' = 'numeric'): InputBox {
		const container = $('.browser-emulation-toolbar-input');
		parent.appendChild(container);
		const input = this._register(new InputBox(container, contextViewService, {
			type: 'number',
			ariaLabel: label,
			placeholder: localize('browser.device.inputPlaceholderAuto', "auto"),
			inputAttributes: {
				min: String(min),
				max: String(max),
				inputMode,
				step: inputMode === 'decimal' ? '0.5' : undefined,
			},
		}));
		if (inputMode === 'decimal') {
			input.inputElement.step = '0.5';
		}
		return input;
	}

	private buildZoomOptions(): { text: string }[] {
		return [
			{ text: localize('browser.device.zoomAuto', "Auto ({0}%)", Math.round(this.autoFitScale * 100)) },
			...BrowserEmulationToolbar.ZOOM_PRESETS.map(scale => ({ text: `${Math.round(scale * 100)}%` })),
		];
	}

	private currentZoomIndex(): number {
		const scale = this.support.scale;
		if (scale === undefined) {
			return BrowserEmulationToolbar.AUTO_INDEX;
		}
		const index = BrowserEmulationToolbar.ZOOM_PRESETS.findIndex(candidate => Math.abs(candidate - scale) < 0.005);
		return index >= 0 ? index + 1 : BrowserEmulationToolbar.AUTO_INDEX;
	}

	private registerEvents(): void {
		const commitDimensions = () => {
			if (this.suppressChange) {
				return;
			}
			this.support.setDimensions(parseDimension(this.widthInput.value), parseDimension(this.heightInput.value));
		};
		this._register(addDisposableListener(this.widthInput.inputElement, EventType.CHANGE, commitDimensions));
		this._register(addDisposableListener(this.heightInput.inputElement, EventType.CHANGE, commitDimensions));
		this._register(addDisposableListener(this.widthInput.inputElement, EventType.KEY_DOWN, event => {
			if (event.keyCode === KeyCode.Enter) {
				commitDimensions();
			}
		}));
		this._register(addDisposableListener(this.heightInput.inputElement, EventType.KEY_DOWN, event => {
			if (event.keyCode === KeyCode.Enter) {
				commitDimensions();
			}
		}));
		this._register(addDisposableListener(this.dprInput.inputElement, EventType.CHANGE, () => {
			if (!this.suppressChange) {
				this.support.setDeviceScaleFactor(parseDeviceScaleFactor(this.dprInput.value));
			}
		}));
		this._register(addDisposableListener(this.dprInput.inputElement, EventType.KEY_DOWN, event => {
			if (event.keyCode === KeyCode.Enter && !this.suppressChange) {
				this.support.setDeviceScaleFactor(parseDeviceScaleFactor(this.dprInput.value));
			}
		}));
		this._register(this.zoom.onDidSelect(event => {
			if (this.suppressChange || !this.support.model?.device) {
				return;
			}
			const scale = event.index === BrowserEmulationToolbar.AUTO_INDEX
				? undefined
				: BrowserEmulationToolbar.ZOOM_PRESETS[event.index - 1];
			if (scale === this.support.scale) {
				return;
			}
			this.support.setScale(scale);
		}));
	}
}

export class BrowserEditorEmulationSupport extends BrowserEditorContribution {
	private readonly toolbarVisibleContext: ContextKey<boolean>;
	private readonly isMobileContext: ContextKey<boolean>;
	private readonly hasUserAgentContext: ContextKey<boolean>;
	private readonly toolbar: BrowserEmulationToolbar;
	private scaleValue: number | undefined;
	private autoFitScale = 1;
	private readonly onDidChangeAutoFitScaleEmitter = this._register(new Emitter<number>());
	private eastSash: Sash | undefined;
	private southSash: Sash | undefined;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(editor);
		this.toolbarVisibleContext = CONTEXT_BROWSER_EMULATION_TOOLBAR_VISIBLE.bindTo(contextKeyService);
		this.isMobileContext = CONTEXT_BROWSER_EMULATION_IS_MOBILE.bindTo(contextKeyService);
		this.hasUserAgentContext = CONTEXT_BROWSER_EMULATION_HAS_USER_AGENT.bindTo(contextKeyService);
		const actionsContainer = $('.browser-emulation-toolbar-actions');
		const actionsToolbar = this._register(instantiationService.createInstance(
			MenuWorkbenchToolBar,
			actionsContainer,
			MenuId.BrowserEmulationToolbar,
			{
				hoverDelegate: undefined,
				highlightToggledItems: true,
				toolbarOptions: { primaryGroup: () => true },
				menuOptions: { shouldForwardArgs: true },
			},
		));
		actionsToolbar.context = editor;
		this.toolbar = this._register(instantiationService.createInstance(BrowserEmulationToolbar, this, actionsContainer));
		this._register(this.onDidChangeAutoFitScaleEmitter.event(scale => this.toolbar.setAutoFitScale(scale)));
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [{ location: BrowserWidgetLocation.Toolbar, element: this.toolbar.element, order: 0 }];
	}

	override onContainerCreated(container: HTMLElement): void {
		this.createResizeSashes(container);
		const observer = new (getWindow(container).ResizeObserver)(() => {
			this.eastSash?.layout(container.clientWidth + 6, container.clientHeight);
			this.southSash?.layout(container.clientHeight + 6, container.clientWidth);
		});
		observer.observe(container);
		this._register({ dispose: () => observer.disconnect() });
	}

	override beforeContainerLayout(): IContainerLayoutOverride | undefined {
		if (!this.editor.model?.device) {
			return undefined;
		}
		return {
			padding: { right: 16, bottom: 16 },
			compute: (_current, pane) => this.computeLayout(pane.width, pane.height),
			priority: 0,
		};
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.toolbar.refresh();
		this.syncContextKeys(model.device);
		this.updateSashState();
		this.setToolbarVisible(!!model.device);
		store.add(model.onDidChangeDevice(device => {
			this.updateSashState();
			if (!device) {
				this.setScale(undefined);
			} else {
				lastSettings.device = device;
			}
			this.toolbar.refresh();
			this.syncContextKeys(device);
			this.setToolbarVisible(!!device);
			void this.editor.layoutBrowserContainer();
		}));
	}

	override onModelDetached(): void {
		this.scaleValue = undefined;
		this.toolbar.refresh();
		this.syncContextKeys(undefined);
		this.updateSashState();
		this.setToolbarVisible(false);
	}

	get model(): IBrowserViewModel | undefined {
		return this.editor.model;
	}

	get scale(): number | undefined {
		return this.scaleValue;
	}

	get isVisible(): boolean {
		return this.toolbar.isVisible;
	}

	setVisible(visible: boolean): void {
		const model = this.editor.model;
		if (visible) {
			if (model && !model.device) {
				void model.setDevice({ ...(lastSettings.device ?? {}) });
				this.setScale(lastSettings.scale);
			}
			this.setToolbarVisible(true);
		} else {
			void model?.setDevice(undefined);
			this.setToolbarVisible(false);
		}
	}

	setScale(scale: number | undefined): void {
		if (this.scaleValue === scale) {
			return;
		}
		this.scaleValue = scale;
		lastSettings.scale = scale;
		this.toolbar.refresh();
		void this.editor.layoutBrowserContainer();
	}

	applyPreset(preset: IBrowserDevicePreset): void {
		void this.editor.model?.setDevice({ ...(preset.device ?? {}) });
	}

	resetAll(): void {
		void this.editor.model?.setDevice({});
		this.setScale(undefined);
	}

	swapDimensions(): void {
		const model = this.editor.model;
		const device = model?.device;
		if (!model || !device || (!device.width && !device.height)) {
			return;
		}
		void model.setDevice({ ...device, width: device.height, height: device.width });
	}

	toggleMobile(): void {
		const model = this.editor.model;
		if (!model) {
			return;
		}
		void model.setDevice({ ...(model.device ?? {}), mobile: !model.device?.mobile });
	}

	setDimensions(width: number | undefined, height: number | undefined): void {
		const model = this.editor.model;
		if (!model?.device) {
			return;
		}
		void model.setDevice({ ...model.device, width, height });
	}

	setDeviceScaleFactor(deviceScaleFactor: number | undefined): void {
		const model = this.editor.model;
		if (!model?.device) {
			return;
		}
		void model.setDevice({ ...model.device, deviceScaleFactor });
	}

	setUserAgent(userAgent: string | undefined): void {
		const model = this.editor.model;
		if (!model) {
			return;
		}
		void model.setDevice({ ...(model.device ?? {}), userAgent });
	}

	get userAgent(): string | undefined {
		return this.editor.model?.device?.userAgent;
	}

	private computeLayout(paneWidth: number, paneHeight: number): IContainerLayout {
		const device = this.editor.model?.device;
		const width = device?.width;
		const height = device?.height;
		const fitScale = paneWidth > 0 && paneHeight > 0
			? Math.min(width ? paneWidth / width : 1, height ? paneHeight / height : 1, 1)
			: 1;
		if (this.autoFitScale !== fitScale) {
			this.autoFitScale = fitScale;
			this.onDidChangeAutoFitScaleEmitter.fire(fitScale);
		}
		const scale = this.scaleValue ?? fitScale;
		const layoutWidth = width ? Math.min(width * scale, paneWidth) : paneWidth;
		const layoutHeight = height ? Math.min(height * scale, paneHeight) : paneHeight;
		return {
			width: layoutWidth,
			height: layoutHeight,
			left: Math.max(0, (paneWidth - layoutWidth) / 2),
			top: Math.max(0, (paneHeight - layoutHeight) / 2),
			emulation: { scale },
		};
	}

	private setToolbarVisible(visible: boolean): void {
		if (visible === this.toolbar.isVisible) {
			return;
		}
		if (visible) {
			this.toolbar.show();
		} else {
			this.toolbar.hide();
		}
		this.toolbarVisibleContext.set(visible);
		void this.editor.layoutBrowserContainer();
	}

	private syncContextKeys(device: IBrowserDeviceProfile | undefined): void {
		this.isMobileContext.set(!!device?.mobile);
		this.hasUserAgentContext.set(!!device?.userAgent);
	}

	private updateSashState(): void {
		const state = this.editor.model?.device ? SashState.Enabled : SashState.Disabled;
		this.eastSash?.setState(state);
		this.southSash?.setState(state);
	}

	private createResizeSashes(container: HTMLElement): void {
		const sashOffset = 6;
		const eastSash = this._register(new Sash(container, Orientation.VERTICAL, { offsetMode: 'center' }));
		const southSash = this._register(new Sash(container, Orientation.HORIZONTAL, { offsetMode: 'center' }));
		this.eastSash = eastSash;
		this.southSash = southSash;
		this.updateSashState();

		const layoutSashes = () => {
			eastSash.layout(container.clientWidth + sashOffset, container.clientHeight);
			southSash.layout(container.clientHeight + sashOffset, container.clientWidth);
		};
		layoutSashes();

		type DragState = {
			readonly startContainerWidth: number;
			readonly startContainerHeight: number;
			readonly scale: number;
			readonly paneWidth: number;
			readonly paneHeight: number;
		};
		let drag: DragState | undefined;

		const onStart = () => {
			const model = this.editor.model;
			if (!model?.device) {
				return;
			}
			const device = model.device;
			const pane = this.editor.paneSize;
			const containerRect = container.getBoundingClientRect();
			const fitScale = pane.width > 0 && pane.height > 0
				? Math.min(device.width ? pane.width / device.width : 1, device.height ? pane.height / device.height : 1, 1)
				: 1;
			drag = {
				startContainerWidth: containerRect.width,
				startContainerHeight: containerRect.height,
				scale: Math.max(0.01, this.scaleValue ?? fitScale),
				paneWidth: pane.width,
				paneHeight: pane.height,
			};
		};

		const onChange = (axis: 'x' | 'y', event: ISashEvent) => {
			if (!drag) {
				return;
			}
			const device = this.editor.model?.device ?? {};
			if (axis === 'x') {
				const width = Math.max(50, Math.min(drag.paneWidth, drag.startContainerWidth + (event.currentX - event.startX) * 2));
				void this.editor.model?.setDevice({ ...device, width: Math.max(50, Math.round(width / drag.scale)) });
			} else {
				const height = Math.max(50, Math.min(drag.paneHeight, drag.startContainerHeight + (event.currentY - event.startY) * 2));
				void this.editor.model?.setDevice({ ...device, height: Math.max(50, Math.round(height / drag.scale)) });
			}
		};

		const onEnd = () => {
			if (!drag) {
				return;
			}
			drag = undefined;
		};

		this._register(eastSash.onDidStart(onStart));
		this._register(southSash.onDidStart(onStart));
		this._register(eastSash.onDidChange(event => onChange('x', event)));
		this._register(southSash.onDidChange(event => onChange('y', event)));
		this._register(eastSash.onDidEnd(onEnd));
		this._register(southSash.onDidEnd(onEnd));
		this._register(eastSash.onDidReset(() => this.resetAxis('x')));
		this._register(southSash.onDidReset(() => this.resetAxis('y')));
	}

	private resetAxis(axis: 'x' | 'y'): void {
		const model = this.editor.model;
		if (!model?.device) {
			return;
		}
		const device = model.device;
		void model.setDevice(axis === 'x'
			? { ...device, width: undefined }
			: { ...device, height: undefined });
	}
}

BrowserEditor.registerContribution(BrowserEditorEmulationSupport);

function getBrowserEditor(candidate: unknown): BrowserEditor | undefined {
	return candidate instanceof BrowserEditor ? candidate : undefined;
}

class ToggleBrowserEmulationAction extends Action2 {
	static readonly ID = 'workbench.action.browser.toggleDeviceEmulation';

	constructor() {
		super({
			id: ToggleBrowserEmulationAction.ID,
			title: localize2('browser.toggleDeviceEmulation', "Device Emulation"),
			category: BrowserActionCategory,
			icon: Codicon.deviceMobile,
			f1: true,
			toggled: CONTEXT_BROWSER_EMULATION_TOOLBAR_VISIBLE.isEqualTo(true),
			precondition: BROWSER_EDITOR_ACTIVE,
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Tools,
				order: 3,
				isHiddenByDefault: true,
			},
		});
	}

	override run(_accessor: ServicesAccessor, browserEditor?: unknown): void {
		const support = getBrowserEditor(browserEditor)?.getContribution(BrowserEditorEmulationSupport);
		support?.setVisible(!support.isVisible);
	}
}
MenuRegistry.appendMenuItem(MenuId.BrowserEmulationToolbar, {
	command: {
		id: ToggleBrowserEmulationAction.ID,
		title: localize('browser.emulationToolbar.close', "Close"),
		icon: Codicon.close,
	},
	order: 100,
});

class ToggleBrowserMobileEmulationAction extends Action2 {
	static readonly ID = 'workbench.action.browser.toggleMobileEmulation';

	constructor() {
		super({
			id: ToggleBrowserMobileEmulationAction.ID,
			title: localize2('browser.toggleMobileEmulation', "Toggle Mobile Emulation"),
			category: BrowserActionCategory,
			icon: Codicon.deviceMobile,
			f1: true,
			toggled: CONTEXT_BROWSER_EMULATION_IS_MOBILE.isEqualTo(true),
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_EMULATION_TOOLBAR_VISIBLE.isEqualTo(true)),
		});
	}

	override run(_accessor: ServicesAccessor, browserEditor?: unknown): void {
		getBrowserEditor(browserEditor)?.getContribution(BrowserEditorEmulationSupport)?.toggleMobile();
	}
}
MenuRegistry.appendMenuItem(MenuId.BrowserEmulationToolbar, {
	command: {
		id: ToggleBrowserMobileEmulationAction.ID,
		title: localize('browser.emulationToolbar.mobile', "Mobile Emulation"),
		icon: Codicon.deviceMobile,
		toggled: CONTEXT_BROWSER_EMULATION_IS_MOBILE.isEqualTo(true),
	},
	order: 20,
});

class PickBrowserDevicePresetAction extends Action2 {
	static readonly ID = 'workbench.action.browser.pickDevicePreset';

	constructor() {
		super({
			id: PickBrowserDevicePresetAction.ID,
			title: localize2('browser.pickDevicePreset', "Emulate Device..."),
			category: BrowserActionCategory,
			icon: Codicon.library,
			f1: true,
			precondition: BROWSER_EDITOR_ACTIVE,
		});
	}

	override async run(accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		const support = getBrowserEditor(browserEditor)?.getContribution(BrowserEditorEmulationSupport);
		if (!support) {
			return;
		}
		const quickInputService = accessor.get(IQuickInputService);
		type PresetItem = IQuickPickItem & { preset: IBrowserDevicePreset };
		const items: PresetItem[] = DEFAULT_BROWSER_DEVICE_PRESETS.map(preset => ({
			label: preset.name,
			description: preset.device?.width && preset.device.height
				? `${preset.device.width}x${preset.device.height}${preset.device.mobile ? ` - ${localize('browser.devicePresets.mobileTag', "mobile")}` : ''}`
				: undefined,
			preset,
		}));
		const picked = await quickInputService.pick<PresetItem, { placeHolder: string; matchOnDescription: true }>(items, {
			placeHolder: localize('browser.devicePresets.placeholder', "Select a device preset"),
			matchOnDescription: true,
		});
		if (picked) {
			support.applyPreset(picked.preset);
		}
	}
}
MenuRegistry.appendMenuItem(MenuId.BrowserEmulationToolbar, {
	command: {
		id: PickBrowserDevicePresetAction.ID,
		title: localize('browser.emulationToolbar.presets', "Apply Preset..."),
		icon: Codicon.library,
	},
	order: 5,
});

class SetBrowserUserAgentAction extends Action2 {
	static readonly ID = 'workbench.action.browser.setUserAgent';

	constructor() {
		super({
			id: SetBrowserUserAgentAction.ID,
			title: localize2('browser.setUserAgent', "Emulate User Agent..."),
			category: BrowserActionCategory,
			icon: Codicon.tag,
			f1: true,
			toggled: CONTEXT_BROWSER_EMULATION_HAS_USER_AGENT.isEqualTo(true),
			precondition: BROWSER_EDITOR_ACTIVE,
		});
	}

	override async run(accessor: ServicesAccessor, browserEditor?: unknown): Promise<void> {
		const support = getBrowserEditor(browserEditor)?.getContribution(BrowserEditorEmulationSupport);
		if (!support) {
			return;
		}
		const value = await accessor.get(IQuickInputService).input({
			prompt: localize('browser.userAgent.prompt', "User agent string (leave empty for the default)"),
			value: support.userAgent ?? '',
		});
		if (value !== undefined) {
			support.setUserAgent(value.trim() || undefined);
		}
	}
}
MenuRegistry.appendMenuItem(MenuId.BrowserEmulationToolbar, {
	command: {
		id: SetBrowserUserAgentAction.ID,
		title: localize('browser.emulationToolbar.userAgent', "Set User Agent..."),
		icon: Codicon.tag,
		toggled: CONTEXT_BROWSER_EMULATION_HAS_USER_AGENT.isEqualTo(true),
	},
	order: 6,
});

class ResetBrowserEmulationAction extends Action2 {
	static readonly ID = 'workbench.action.browser.resetEmulation';

	constructor() {
		super({
			id: ResetBrowserEmulationAction.ID,
			title: localize2('browser.resetEmulation', "Reset Emulation"),
			category: BrowserActionCategory,
			icon: Codicon.discard,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_EMULATION_TOOLBAR_VISIBLE.isEqualTo(true)),
		});
	}

	override run(_accessor: ServicesAccessor, browserEditor?: unknown): void {
		getBrowserEditor(browserEditor)?.getContribution(BrowserEditorEmulationSupport)?.resetAll();
	}
}
MenuRegistry.appendMenuItem(MenuId.BrowserEmulationToolbar, {
	command: {
		id: ResetBrowserEmulationAction.ID,
		title: localize('browser.emulationToolbar.reset', "Reset"),
		icon: Codicon.discard,
	},
	order: 90,
});

function parseDimension(raw: string): number | undefined {
	const value = Math.floor(Number(raw.trim()));
	return value > 0 ? Math.max(1, Math.min(9999, value)) : undefined;
}

function parseDeviceScaleFactor(raw: string): number | undefined {
	const value = Number(raw.trim());
	return value > 0 ? Math.max(0, Math.min(8, value)) : undefined;
}

registerAction2(ToggleBrowserEmulationAction);
registerAction2(PickBrowserDevicePresetAction);
registerAction2(SetBrowserUserAgentAction);
registerAction2(ToggleBrowserMobileEmulationAction);
registerAction2(ResetBrowserEmulationAction);
