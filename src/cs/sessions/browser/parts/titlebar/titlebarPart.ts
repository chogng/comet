/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import { INativeHostService } from 'cs/platform/native/common/native';
import { getWindowChromeLayout } from 'cs/platform/window/common/window';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import { registerWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import {
	WORKBENCH_PART_IDS,
	WORKBENCH_SHELL_CLASS_NAME,
} from 'cs/workbench/browser/part';
import { ISettingsModel, type SettingsModel } from 'cs/workbench/services/settings/settingsModel';

import 'cs/sessions/browser/parts/titlebar/media/titlebarPart.css';

const WindowChromeLayout = getWindowChromeLayout();

export function resolveSessionsStatusbarVisibility(
	statusbarVisible: boolean,
	isEditorVisible: boolean,
): boolean {
	return statusbarVisible && isEditorVisible;
}

export class SessionsTitlebarPart extends Disposable {
	private readonly element = $<HTMLElementTagNameMap['section']>(
		'section.comet-titlebar.comet-titlebar-chrome',
	);
	private isDisposed = false;

	constructor(
		private readonly containerElement: HTMLElement,
		private readonly shellElement: HTMLElement,
		private readonly statusbarElement: HTMLElement,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@ISettingsModel private readonly settingsModel: SettingsModel,
		@ISessionsLayoutService private readonly layoutService: ISessionsLayoutService,
	) {
		super();
		this.containerElement.append(this.element, this.shellElement);
		this._register(toDisposable(this.settingsModel.subscribe(this.render)));
		this._register(this.layoutService.onDidChangeLayoutState(this.render, this));
		this.render();
	}

	getElement(): HTMLElement {
		return this.element;
	}

	private readonly render = (): void => {
		const settings = this.settingsModel.getSnapshot();
		const electronRuntime = this.nativeHostService.canInvoke();
		const isStatusbarVisible = resolveSessionsStatusbarVisibility(
			settings.hasLoadedSettings && settings.statusbarVisible,
			!this.layoutService.getLayoutState().isEditorCollapsed,
		);
		const hasNativeWindowControlsOverlay =
			electronRuntime && WindowChromeLayout.nativeWindowControlsOverlay;
		const hasLeadingWindowControls =
			electronRuntime && WindowChromeLayout.leadingWindowControlsWidthPx > 0;

		this.containerElement.className = [
			'comet-app-window',
			electronRuntime && settings.useMica ? 'comet-is-mica-enabled' : '',
			isStatusbarVisible ? 'comet-has-statusbar' : '',
			hasNativeWindowControlsOverlay ? 'comet-has-native-window-controls-overlay' : '',
			hasLeadingWindowControls ? 'comet-has-leading-window-controls' : '',
		].filter(Boolean).join(' ');

		if (hasNativeWindowControlsOverlay) {
			this.containerElement.style.setProperty(
				'--workbench-window-controls-width',
				`${WindowChromeLayout.trailingWindowControlsWidthPx}px`,
			);
		} else {
			this.containerElement.style.removeProperty('--workbench-window-controls-width');
		}
		this.containerElement.style.setProperty(
			'--workbench-titlebar-height',
			`${WindowChromeLayout.titlebarHeightPx}px`,
		);
		if (hasLeadingWindowControls) {
			this.containerElement.style.setProperty(
				'--workbench-leading-window-controls-width',
				`${WindowChromeLayout.leadingWindowControlsWidthPx}px`,
			);
		} else {
			this.containerElement.style.removeProperty('--workbench-leading-window-controls-width');
		}

		this.shellElement.className = WORKBENCH_SHELL_CLASS_NAME;
		this.syncStatusbarVisibility(isStatusbarVisible);
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.titlebar, this.element);
	};

	override dispose(): void {
		if (this.isDisposed) {
			return;
		}

		this.isDisposed = true;
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.titlebar, null);
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.statusbar, null);
		this.element.replaceChildren();
		super.dispose();
	}

	private syncStatusbarVisibility(visible: boolean): void {
		if (visible) {
			if (!this.statusbarElement.isConnected) {
				this.containerElement.append(this.statusbarElement);
			}
			registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.statusbar, this.statusbarElement);
			return;
		}

		if (this.statusbarElement.parentElement === this.containerElement) {
			this.containerElement.removeChild(this.statusbarElement);
		}
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.statusbar, null);
	}
}
