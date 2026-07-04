/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Menu, MenuItem, type IpcMainInvokeEvent } from 'electron';
import { electronMainChannelServer } from 'cs/base/parts/ipc/electron-main/ipcMain';
import {
	CONTEXT_MENU_CHANNEL,
	type IContextMenuCloseRequest,
	type IContextMenuEvent,
	type IContextMenuPopupRequest,
	type IContextMenuPopupResult,
	type ISerializableContextMenuItem,
} from '../common/contextmenu';

type ActiveContextMenu = {
	menu: Menu;
	senderId: number;
	callbackChannel: string;
	selection: IContextMenuPopupResult;
};

const activeContextMenus = new Map<number, ActiveContextMenu>();
let registered = false;

export function registerContextMenuListener(): void {
	if (registered) {
		return;
	}

	registered = true;
	electronMainChannelServer.registerChannel(CONTEXT_MENU_CHANNEL, {
		async call<T = unknown>(event: IpcMainInvokeEvent, command: string, arg?: unknown): Promise<T> {
			switch (command) {
				case 'popup':
					await showContextMenu(event, arg as IContextMenuPopupRequest);
					return undefined as T;
				case 'close':
					closeContextMenu(arg as IContextMenuCloseRequest);
					return undefined as T;
				default:
					throw new Error(`Unknown context menu command '${command}'.`);
			}
		},
		listen() {
			throw new Error('Context menu channel does not support events.');
		},
	});
}

async function showContextMenu(
	event: IpcMainInvokeEvent,
	request: IContextMenuPopupRequest,
): Promise<void> {
	if (activeContextMenus.has(request.contextMenuId)) {
		return;
	}

	const menu = createMenu(request.items, request.contextMenuId);
	const selection: IContextMenuPopupResult = {
		didCancel: true,
	};

	activeContextMenus.set(request.contextMenuId, {
		menu,
		senderId: event.sender.id,
		callbackChannel: request.callbackChannel,
		selection,
	});

	menu.popup({
		x: request.options?.x,
		y: request.options?.y,
		positioningItem: request.options?.positioningItem,
		callback: () => {
			const openMenu = activeContextMenus.get(request.contextMenuId);
			if (!openMenu) {
				return;
			}

			activeContextMenus.delete(request.contextMenuId);
			void electronMainChannelServer
				.getRendererChannel(openMenu.senderId, openMenu.callbackChannel)
				.call('close', openMenu.selection)
				.catch(() => {
					// Ignore stale callback channels.
				});
		},
	});
}

function closeContextMenu(request: IContextMenuCloseRequest): void {
	const openMenu = activeContextMenus.get(request.contextMenuId);
	if (!openMenu) {
		return;
	}

	openMenu.menu.closePopup();
}

function createMenu(
	items: readonly ISerializableContextMenuItem[],
	contextMenuId: number,
): Menu {
	const menu = new Menu();
	for (const item of items) {
		menu.append(createMenuItem(item, contextMenuId));
	}

	return menu;
}

function createMenuItem(
	item: ISerializableContextMenuItem,
	contextMenuId: number,
): MenuItem {
	if (item.type === 'separator') {
		return new MenuItem({
			type: item.type,
		});
	}

	if (Array.isArray(item.submenu) && item.submenu.length > 0) {
		return new MenuItem({
			label: item.label,
			accelerator: item.accelerator,
			checked: item.checked,
			enabled: item.enabled,
			visible: item.visible,
			submenu: createMenu(item.submenu, contextMenuId),
		});
	}

	const menuItem = new MenuItem({
		label: item.label,
		type: item.type === 'normal' || item.type === 'submenu'
			? undefined
			: item.type ?? (item.checked ? 'checkbox' : undefined),
		accelerator: item.accelerator,
		checked: item.checked,
		enabled: item.enabled,
		visible: item.visible,
		click: (_menuItem, _browserWindow, contextmenuEvent) => {
			const openMenu = activeContextMenus.get(contextMenuId);
			if (!openMenu) {
				return;
			}

			openMenu.selection.didCancel = false;
			openMenu.selection.itemId = item.id;
			openMenu.selection.contextmenuEvent = createContextMenuEvent(contextmenuEvent);
		},
	});

	return menuItem;
}

function createContextMenuEvent(
	contextmenuEvent: unknown,
): IContextMenuEvent | undefined {
	if (!contextmenuEvent) {
		return undefined;
	}

	const event = contextmenuEvent as {
		shiftKey?: boolean;
		ctrlKey?: boolean;
		altKey?: boolean;
		metaKey?: boolean;
	};

	return {
		shiftKey: event.shiftKey,
		ctrlKey: event.ctrlKey,
		altKey: event.altKey,
		metaKey: event.metaKey,
	};
}
