/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LocaleMessages } from 'language/locales';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { toDisposable } from 'cs/base/common/lifecycle';

export interface EditorCreationActionDescriptor {
	readonly commandId: string;
	readonly icon: LxIconName;
	readonly order: number;
	getLabel(ui: LocaleMessages): string;
}

export interface EditorCreationAction {
	readonly commandId: string;
	readonly icon: LxIconName;
	readonly label: string;
}

const descriptors = new Map<string, EditorCreationActionDescriptor>();

export function registerEditorCreationAction(descriptor: EditorCreationActionDescriptor) {
	if (descriptors.has(descriptor.commandId)) {
		throw new Error(`Editor creation action '${descriptor.commandId}' is already registered.`);
	}
	descriptors.set(descriptor.commandId, descriptor);
	return toDisposable(() => descriptors.delete(descriptor.commandId));
}

export function getEditorCreationActions(ui: LocaleMessages): readonly EditorCreationAction[] {
	return [...descriptors.values()]
		.sort((left, right) => left.order - right.order)
		.map(descriptor => ({
			commandId: descriptor.commandId,
			icon: descriptor.icon,
			label: descriptor.getLabel(ui),
		}));
}
