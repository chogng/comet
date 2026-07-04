/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ICommonContextMenuItem {
	label?: string;

	type?: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';

	accelerator?: string;

	enabled?: boolean;
	visible?: boolean;
	checked?: boolean;
}

export interface ISerializableContextMenuItem extends ICommonContextMenuItem {
	id: number;
	submenu?: ISerializableContextMenuItem[];
}

export interface IContextMenuItem extends ICommonContextMenuItem {
	click?: (event: IContextMenuEvent) => void;
	submenu?: IContextMenuItem[];
}

export interface IContextMenuEvent {
	shiftKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	metaKey?: boolean;
}

export interface IPopupOptions {
	x?: number;
	y?: number;
	positioningItem?: number;
}

export interface IContextMenuPopupRequest {
	contextMenuId: number;
	callbackChannel: string;
	items: ISerializableContextMenuItem[];
	options?: IPopupOptions;
}

export interface IContextMenuPopupResult {
	didCancel: boolean;
	itemId?: number;
	contextmenuEvent?: IContextMenuEvent;
}

export interface IContextMenuCloseRequest {
	contextMenuId: number;
}

export const CONTEXT_MENU_CHANNEL = 'contextmenu';
