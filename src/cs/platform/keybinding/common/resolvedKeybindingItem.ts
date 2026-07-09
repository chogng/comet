/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ResolvedKeybinding } from 'cs/base/common/keybindings';
import type { ContextKeyExpression } from 'cs/platform/contextkey/common/contextkey';

export class ResolvedKeybindingItem {
	readonly resolvedKeybinding: ResolvedKeybinding | undefined;
	readonly chords: string[];
	readonly bubble: boolean;
	readonly command: string | null;
	readonly commandArgs: unknown;
	readonly when: ContextKeyExpression | undefined;
	readonly isDefault: boolean;
	readonly extensionId: string | null;
	readonly isBuiltinExtension: boolean;

	constructor(
		resolvedKeybinding: ResolvedKeybinding | undefined,
		command: string | null,
		commandArgs: unknown,
		when: ContextKeyExpression | undefined,
		isDefault: boolean,
		extensionId: string | null,
		isBuiltinExtension: boolean,
	) {
		this.resolvedKeybinding = resolvedKeybinding;
		this.chords = resolvedKeybinding
			? toEmptyArrayIfContainsNull(resolvedKeybinding.getDispatchChords())
			: [];
		if (resolvedKeybinding && this.chords.length === 0) {
			this.chords = toEmptyArrayIfContainsNull(
				resolvedKeybinding.getSingleModifierDispatchChords(),
			);
		}
		this.bubble = command?.startsWith('^') ?? false;
		this.command = this.bubble && command ? command.slice(1) : command;
		this.commandArgs = commandArgs;
		this.when = when;
		this.isDefault = isDefault;
		this.extensionId = extensionId;
		this.isBuiltinExtension = isBuiltinExtension;
	}
}

export function toEmptyArrayIfContainsNull<T>(
	values: readonly (T | null)[],
): T[] {
	const result: T[] = [];
	for (const value of values) {
		if (!value) {
			return [];
		}
		result.push(value);
	}
	return result;
}
