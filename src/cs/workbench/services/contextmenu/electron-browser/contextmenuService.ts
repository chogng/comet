/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ContextMenuAction,
	ContextMenuDelegate,
	ContextMenuService as BaseContextMenuService,
} from 'cs/base/browser/contextmenu';
import { getZoomFactor } from 'cs/base/browser/browser';
import * as DOM from 'cs/base/browser/dom';
import { isMacintosh, isWindows } from 'cs/base/common/platform';
import type {
	ElectronAPI,
	ElectronIpcApi,
} from 'cs/base/parts/sandbox/common/electronTypes';
import {
	CONTEXT_MENU_CHANNEL,
	type IContextMenuCloseRequest,
	type IContextMenuItem,
	type IPopupOptions,
} from 'cs/base/parts/contextmenu/common/contextmenu';
import { popup } from 'cs/base/parts/contextmenu/electron-browser/contextmenu';

export type WorkbenchContextMenuDelegate = ContextMenuDelegate;
export type WorkbenchContextMenuService = BaseContextMenuService & {
	dispose: () => void;
};

function getElectronIpc(): ElectronIpcApi {
	const globalWindow = globalThis as typeof globalThis & {
		electronAPI?: ElectronAPI;
	};
	const ipc = globalWindow.electronAPI?.ipc;
	if (!ipc) {
		throw new Error('Native context menu bridge is unavailable.');
	}

	return ipc;
}

function createNativeMenuItems(
	actions: readonly ContextMenuAction[],
	onSelect: (value: string) => void,
): IContextMenuItem[] {
	return actions.map(action => {
		const hasSubmenu = Array.isArray(action.submenu) && action.submenu.length > 0;
		const submenu = hasSubmenu ? action.submenu : undefined;
		const item: IContextMenuItem = {
			label: action.label,
			type: hasSubmenu
				? undefined
				: action.checked
					? 'checkbox'
					: undefined,
			checked: action.checked,
			enabled: action.disabled !== true,
			visible: true,
			submenu: submenu ? createNativeMenuItems(submenu, onSelect) : undefined,
			click: hasSubmenu
				? undefined
				: () => onSelect(action.value),
		};

		return item;
	});
}

function resolvePopupOptions(
	delegate: ContextMenuDelegate,
	actions: readonly ContextMenuAction[],
): IPopupOptions {
	const anchor = delegate.getAnchor();
	let x: number;
	let y: number;
	let zoom = getZoomFactor(DOM.isHTMLElement(anchor)
		? DOM.getWindow(anchor)
		: DOM.getActiveWindow());

	if (DOM.isHTMLElement(anchor)) {
		const clientRect = anchor.getBoundingClientRect();
		const elementPosition = {
			left: clientRect.left,
			top: clientRect.top,
			width: clientRect.width,
			height: clientRect.height,
		};
		const win = DOM.getWindow(anchor);
		const viewportWidth = win.innerWidth;
		const viewportHeight = win.innerHeight;
		const isClipped =
			clientRect.left < 0
			|| clientRect.top < 0
			|| clientRect.right > viewportWidth
			|| clientRect.bottom > viewportHeight;
		const anchorAlignment = delegate.anchorAlignment
			?? (delegate.alignment === 'end' ? 'right' : 'left');

		zoom *= DOM.getDomNodeZoomLevel(anchor);

		if (isClipped) {
			x = Math.min(Math.max(clientRect.right, 0), viewportWidth);
			y = Math.min(Math.max(clientRect.bottom, 0), viewportHeight);
		} else if (delegate.anchorAxisAlignment === 'horizontal') {
			x = anchorAlignment === 'left'
				? elementPosition.left
				: elementPosition.left + elementPosition.width;
			y = elementPosition.top;

			if (!isMacintosh) {
				const availableHeightForMenu = win.screen.height - y;
				if (availableHeightForMenu < actions.length * (isWindows ? 45 : 32)) {
					y += elementPosition.height;
				}
			}
		} else {
			x = anchorAlignment === 'left'
				? elementPosition.left
				: elementPosition.left + elementPosition.width;
			y = elementPosition.top + elementPosition.height;
		}

		if (isMacintosh) {
			y += 4 / zoom;
		}

		return {
			x: Math.floor(x * zoom),
			y: Math.floor(y * zoom),
		};
	}

	return {
		x: Math.floor(anchor.x * zoom),
		y: Math.floor(anchor.y * zoom),
	};
}

class NativeWorkbenchContextMenuService implements WorkbenchContextMenuService {
	declare readonly _serviceBrand: undefined;

	private activeContextMenuId: number | null = null;
	private disposed = false;

	showContextMenu(delegate: ContextMenuDelegate) {
		if (this.disposed) {
			return;
		}

		const actions = delegate.getActions();
		if (actions.length === 0) {
			return;
		}

		if (this.activeContextMenuId !== null) {
			this.hideContextMenu();
		}

		const shouldRestoreFocusOnHide = delegate.restoreFocusOnHide ?? true;
		const focusToRestore =
			shouldRestoreFocusOnHide && DOM.isHTMLElement(document.activeElement)
				? document.activeElement
				: null;

		let contextMenuId = -1;
		contextMenuId = popup(
			createNativeMenuItems(actions, value => {
				delegate.onSelect?.(value);
			}),
			resolvePopupOptions(delegate, actions),
			didCancel => {
				if (this.disposed || this.activeContextMenuId !== contextMenuId) {
					return;
				}

				this.activeContextMenuId = null;
				try {
					delegate.onHide?.(didCancel);
					DOM.ModifierKeyEmitter.getInstance().resetKeyStatus();
				} finally {
					if (shouldRestoreFocusOnHide) {
						focusToRestore?.focus();
					}
				}
			},
		);

		this.activeContextMenuId = contextMenuId;
	}

	hideContextMenu = () => {
		if (this.activeContextMenuId === null) {
			return;
		}

		const contextMenuId = this.activeContextMenuId;
		void getElectronIpc().call<void>(
			CONTEXT_MENU_CHANNEL,
			'close',
			{
				contextMenuId,
			} satisfies IContextMenuCloseRequest,
		).catch(error => {
			console.error('Failed to hide native context menu.', error);
		});
	};

	isVisible = () => this.activeContextMenuId !== null;

	dispose = () => {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.hideContextMenu();
		this.activeContextMenuId = null;
	};
}

export function createContextMenuService(): WorkbenchContextMenuService {
	return new NativeWorkbenchContextMenuService();
}
