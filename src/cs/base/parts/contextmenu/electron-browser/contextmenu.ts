/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from 'cs/base/common/lifecycle';
import { registerElectronRendererChannel } from 'cs/base/parts/ipc/electron-browser/rendererChannelClient';
import type { ElectronAPI, ElectronIpcApi } from 'cs/base/parts/sandbox/common/electronTypes';
import {
	CONTEXT_MENU_CHANNEL,
	type IContextMenuEvent,
	type IContextMenuItem,
	type IContextMenuPopupRequest,
	type IContextMenuPopupResult,
	type IPopupOptions,
	type ISerializableContextMenuItem,
} from '../common/contextmenu';

let contextMenuIdPool = 0;

type ContextMenuCallbackRequest = {
	didCancel: boolean;
	itemId?: number;
	contextmenuEvent?: IContextMenuEvent;
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

function createMenuItem(
	item: IContextMenuItem,
	processedItems: IContextMenuItem[],
): ISerializableContextMenuItem {
	const serializableItem: ISerializableContextMenuItem = {
		id: processedItems.length,
		label: item.label,
		type: item.type,
		accelerator: item.accelerator,
		checked: item.checked,
		enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
		visible: typeof item.visible === 'boolean' ? item.visible : true,
	};

	processedItems.push(item);

	if (Array.isArray(item.submenu) && item.submenu.length > 0) {
		serializableItem.submenu = item.submenu.map(submenuItem =>
			createMenuItem(submenuItem, processedItems),
		);
	}

	return serializableItem;
}

export function popup(
	items: IContextMenuItem[],
	options?: IPopupOptions,
	onHide?: (didCancel: boolean) => void,
): number {
	const processedItems: IContextMenuItem[] = [];
	const contextMenuId = contextMenuIdPool++;
	const callbackChannel = `contextmenu:${contextMenuId}`;
	const requestItems = items.map(item => createMenuItem(item, processedItems));
	let disposed = false;
	const ipc = getElectronIpc();
	let callbackChannelRegistration: IDisposable;

	callbackChannelRegistration = registerElectronRendererChannel(
		ipc,
		callbackChannel,
		{
			async call<T = unknown>(_context: string, command: string, arg?: unknown): Promise<T> {
				if (command !== 'close') {
					throw new Error(`Unknown context menu command '${command}'.`);
				}

				if (disposed) {
					return undefined as T;
				}

				disposed = true;

				const payload = arg as ContextMenuCallbackRequest;
				const item = typeof payload.itemId === 'number'
					? processedItems[payload.itemId]
					: undefined;

				try {
					onHide?.(payload.didCancel);
				} finally {
					try {
						item?.click?.(payload.contextmenuEvent ?? {});
					} finally {
						callbackChannelRegistration.dispose();
					}
				}
				return undefined as T;
			},
			listen: () => {
				throw new Error('Context menu callbacks do not support events.');
			},
		},
	);

	void ipc.call<IContextMenuPopupResult>(
		CONTEXT_MENU_CHANNEL,
		'popup',
		{
			contextMenuId,
			callbackChannel,
			items: requestItems,
			options,
		} satisfies IContextMenuPopupRequest,
	).catch(error => {
		if (disposed) {
			return;
		}

		disposed = true;
		callbackChannelRegistration.dispose();
		onHide?.(true);
		console.error('Failed to show native context menu.', error);
	});

	return contextMenuId;
}
