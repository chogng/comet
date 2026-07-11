/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType, registerExternalFocusChecker } from 'cs/base/browser/dom';
import { mainWindow } from 'cs/base/browser/window';
import { StandardKeyboardEvent } from 'cs/base/browser/keyboardEvent';
import { encodeBase64, VSBuffer } from 'cs/base/common/buffer';
import { DisposableStore, MutableDisposable, toDisposable } from 'cs/base/common/lifecycle';
import { IBrowserViewKeyDownEvent } from 'cs/platform/browserView/common/browserView';
import { IKeybindingService } from 'cs/platform/keybinding/common/keybinding';
import { ILogService } from 'cs/platform/log/common/log';
import { IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	IBrowserEditorWidget,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { BrowserOverlayManager, BrowserOverlayType } from 'cs/workbench/contrib/browserView/electron-browser/overlayManager';

export class WebContentsViewRendererFeature extends BrowserEditorContribution {
	private container: HTMLElement | undefined;
	private model: IBrowserViewModel | undefined;
	private editorVisible = false;
	private overlayObscured = false;
	private readonly placeholderScreenshot = $('.browser-placeholder-screenshot');
	private readonly overlayPauseElement = $('.browser-overlay-paused');
	private readonly screenshotHandle = this._register(new MutableDisposable());
	private readonly overlayManager: BrowserOverlayManager;
	private focusTimeout: ReturnType<typeof setTimeout> | undefined;

	private readonly placeholderContent: IBrowserEditorWidget = {
		location: BrowserWidgetLocation.ContentArea,
		element: this.placeholderScreenshot,
		order: 100,
	};

	private readonly overlayPauseContent: IBrowserEditorWidget = {
		location: BrowserWidgetLocation.ContentArea,
		element: this.overlayPauseElement,
		order: 200,
	};

	constructor(
		editor: BrowserEditor,
		@ILogService private readonly logService: ILogService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IContextViewService private readonly contextViewService: IContextViewService,
	) {
		super(editor);

		this.overlayManager = this._register(new BrowserOverlayManager(window));
		const message = $('.browser-overlay-paused-message');
		const heading = $('.browser-overlay-paused-heading');
		const detail = $('.browser-overlay-paused-detail');
		heading.textContent = 'Paused due to Notification';
		detail.textContent = 'Dismiss the notification to continue using the browser.';
		message.append(heading, detail);
		this.overlayPauseElement.append(message);

		this._register(this.overlayManager.onDidChangeOverlayState(() => this.refreshOverlayObscured()));
		this.refresh();
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [this.placeholderContent, this.overlayPauseContent];
	}

	override onContainerCreated(container: HTMLElement): void {
		this.container = container;
		this._register(addDisposableListener(container, EventType.FOCUS, () => this.tryFocus()));
		this._register(addDisposableListener(container, EventType.BLUR, () => this.cancelFocusTimeout()));
		this._register(registerExternalFocusChecker(() => ({
			hasFocus: this.model?.focused ?? false,
			window: this.model?.focused ? mainWindow : undefined,
		})));
		this.refreshOverlayObscured();
	}

	override onPaneVisibilityChanged(visible: boolean): void {
		if (this.editorVisible === visible) {
			return;
		}
		this.editorVisible = visible;
		this.refresh();
	}

	override afterContainerLayout(): void {
		this.refreshOverlayObscured();
	}

	override tryFocus(): boolean {
		if (!this.editor.input?.url) {
			return false;
		}
		this.container?.focus();
		if (this.focusTimeout || !this.model) {
			return true;
		}
		this.focusTimeout = setTimeout(() => {
			this.focusTimeout = undefined;
			const doc = this.container?.ownerDocument;
			if (!doc?.hasFocus() || doc.activeElement !== this.container) {
				return;
			}
			if (this.model?.visible) {
				void this.model.focus();
			} else {
				this.editor.ensureBrowserFocus();
			}
		}, 0);
		return true;
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.model = model;
		this.setBackgroundImage(model.screenshot);
		store.add(model.onDidChangeVisibility(() => {
			this.refresh();
			void this.captureScreenshot();
		}));
		store.add(model.onDidKeyCommand(keyEvent => void this.handleKeyEvent(keyEvent)));
		store.add(model.onDidNavigate(() => this.refresh()));
		store.add(model.onDidChangeLoadingState(() => this.refresh()));
		store.add(model.onDidChangeFocus(({ focused }) => {
			if (focused) {
				this.contextViewService.hideContextView();
			}
		}));
		this.refresh();
		void this.captureScreenshot();
	}

	override onModelDetached(): void {
		if (this.model) {
			void this.model.setVisible(false);
		}
		this.model = undefined;
		this.screenshotHandle.clear();
		this.cancelFocusTimeout();
		this.setBackgroundImage(undefined);
		this.refresh();
	}

	override dispose(): void {
		this.cancelFocusTimeout();
		super.dispose();
	}

	private shouldShowPage(): boolean {
		return this.editorVisible
			&& !this.overlayObscured
			&& !!this.model?.url
			&& !this.model?.error;
	}

	private refresh(): void {
		const pauseActive = !!this.model?.url && this.editorVisible && this.overlayObscured;
		this.overlayPauseElement.classList.toggle('visible', pauseActive);

		if (!this.model) {
			this.setPlaceholderVisible(false);
			return;
		}

		const placeholderActive = !!this.model.url && !this.model.error;
		const show = this.shouldShowPage();
		if (show && this.model.visible) {
			this.setPlaceholderVisible(false);
			return;
		}

		if (show) {
			this.setPlaceholderVisible(placeholderActive);
			void this.showPage(this.model);
			return;
		}

		this.setPlaceholderVisible(placeholderActive);
		if (!this.model.visible) {
			return;
		}
		void this.captureScreenshot();
		window.requestAnimationFrame(() => {
			if (this.model && !this.shouldShowPage()) {
				void this.model.setVisible(false);
			}
		});
	}

	private async showPage(model: IBrowserViewModel): Promise<void> {
		const didLayout = await this.editor.layoutBrowserContainer();
		if (!didLayout || this.model !== model || !this.shouldShowPage()) {
			return;
		}
		await model.setVisible(true);
		if (this.model !== model || !this.shouldShowPage()) {
			return;
		}
		this.setPlaceholderVisible(false);
		const doc = this.container?.ownerDocument;
		if (doc?.hasFocus() && doc.activeElement === this.container) {
			this.tryFocus();
		}
	}

	private refreshOverlayObscured(): void {
		if (!this.container) {
			return;
		}
		const overlays = this.overlayManager.getOverlappingOverlays(this.container);
		const obscured = overlays.length > 0;
		const hasNotification = overlays.some(overlay => overlay.type === BrowserOverlayType.Notification);
		this.overlayPauseElement.classList.toggle('show-message', hasNotification);
		if (obscured !== this.overlayObscured) {
			this.overlayObscured = obscured;
			this.refresh();
		}
	}

	private async captureScreenshot(): Promise<void> {
		if (!this.model) {
			return;
		}
		this.screenshotHandle.clear();
		if (!this.model.visible) {
			return;
		}
		try {
			const screenshot = await this.model.captureScreenshot({ quality: 80 });
			this.setBackgroundImage(screenshot);
		} catch (error) {
			this.logService.error('Failed to capture browser view screenshot', error);
		}
		const handle = setTimeout(() => void this.captureScreenshot(), 1000);
		this.screenshotHandle.value = toDisposable(() => clearTimeout(handle));
	}

	private setBackgroundImage(buffer: VSBuffer | undefined): void {
		this.placeholderScreenshot.style.backgroundImage = buffer
			? `url('data:image/jpeg;base64,${encodeBase64(buffer)}')`
			: '';
	}

	private setPlaceholderVisible(visible: boolean): void {
		this.placeholderScreenshot.style.display = visible ? '' : 'none';
	}

	private async handleKeyEvent(keyEvent: IBrowserViewKeyDownEvent): Promise<void> {
		if (!this.container) {
			return;
		}
		try {
			const syntheticEvent = new KeyboardEvent('keydown', keyEvent);
			const standardEvent = new StandardKeyboardEvent(syntheticEvent);
			this.keybindingService.dispatchEvent(standardEvent, this.container);
		} catch (error) {
			this.logService.error('WebContentsViewRendererFeature: Error dispatching key event', error);
		}
	}

	private cancelFocusTimeout(): void {
		if (!this.focusTimeout) {
			return;
		}
		clearTimeout(this.focusTimeout);
		this.focusTimeout = undefined;
	}
}

BrowserEditor.registerContribution(WebContentsViewRendererFeature);
