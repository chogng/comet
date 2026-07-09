/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ContextKeyExpression,
	ContextKeyService,
} from 'cs/platform/contextkey/common/contextkey';
import type { ResolvedKeybindingItem } from 'cs/platform/keybinding/common/resolvedKeybindingItem';

export const enum ResultKind {
	NoMatchingKb,
	MoreChordsNeeded,
	KbFound,
}

export type ResolutionResult =
	| { readonly kind: ResultKind.NoMatchingKb }
	| { readonly kind: ResultKind.MoreChordsNeeded }
	| {
			readonly kind: ResultKind.KbFound;
			readonly commandId: string | null;
			readonly commandArgs: unknown;
			readonly isBubble: boolean;
		};

export const NoMatchingKb: ResolutionResult = {
	kind: ResultKind.NoMatchingKb,
};

const MoreChordsNeeded: ResolutionResult = {
	kind: ResultKind.MoreChordsNeeded,
};

function keybindingFound(
	commandId: string | null,
	commandArgs: unknown,
	isBubble: boolean,
): ResolutionResult {
	return {
		kind: ResultKind.KbFound,
		commandId,
		commandArgs,
		isBubble,
	};
}

export class KeybindingResolver {
	private readonly defaultKeybindings: readonly ResolvedKeybindingItem[];
	private readonly keybindings: readonly ResolvedKeybindingItem[];
	private readonly map = new Map<string, ResolvedKeybindingItem[]>();
	private readonly lookupMap = new Map<string, ResolvedKeybindingItem[]>();

	constructor(
		defaultKeybindings: readonly ResolvedKeybindingItem[],
		overrides: readonly ResolvedKeybindingItem[],
		private readonly log: (message: string) => void,
	) {
		this.defaultKeybindings = defaultKeybindings;
		this.keybindings = KeybindingResolver.handleRemovals([
			...defaultKeybindings,
			...overrides,
		]);

		for (const keybinding of this.keybindings) {
			if (keybinding.chords.length === 0) {
				continue;
			}

			this.addKeyPress(keybinding.chords[0], keybinding);
		}
	}

	static handleRemovals(
		rules: readonly ResolvedKeybindingItem[],
	): ResolvedKeybindingItem[] {
		const removals = new Map<string, ResolvedKeybindingItem[]>();
		for (const rule of rules) {
			if (rule.command?.startsWith('-')) {
				const command = rule.command.slice(1);
				const commandRemovals = removals.get(command) ?? [];
				commandRemovals.push(rule);
				removals.set(command, commandRemovals);
			}
		}

		if (removals.size === 0) {
			return [...rules];
		}

		return rules.filter(rule => {
			if (!rule.command || rule.command.startsWith('-') || !rule.isDefault) {
				return !rule.command?.startsWith('-');
			}

			const commandRemovals = removals.get(rule.command);
			if (!commandRemovals) {
				return true;
			}

			return !commandRemovals.some(removal =>
				this.isTargetedForRemoval(rule, removal),
			);
		});
	}

	getDefaultKeybindings(): readonly ResolvedKeybindingItem[] {
		return this.defaultKeybindings;
	}

	getKeybindings(): readonly ResolvedKeybindingItem[] {
		return this.keybindings;
	}

	lookupKeybindings(commandId: string): ResolvedKeybindingItem[] {
		const items = this.lookupMap.get(commandId);
		if (!items || items.length === 0) {
			return [];
		}

		return [...items].reverse();
	}

	lookupPrimaryKeybinding(
		commandId: string,
		context: ContextKeyService,
		enforceContextCheck = false,
	): ResolvedKeybindingItem | null {
		const items = this.lookupMap.get(commandId);
		if (!items || items.length === 0) {
			return null;
		}

		if (items.length === 1 && !enforceContextCheck) {
			return items[0];
		}

		for (let index = items.length - 1; index >= 0; index -= 1) {
			const item = items[index];
			if (context.contextMatchesRules(item.when)) {
				return item;
			}
		}

		return enforceContextCheck ? null : items[items.length - 1];
	}

	resolve(
		context: ContextKeyService,
		currentChords: readonly string[],
		keypress: string,
	): ResolutionResult {
		const pressedChords = [...currentChords, keypress];
		const candidates = this.map.get(pressedChords[0]);
		if (!candidates) {
			this.log(`No keybinding entries for ${pressedChords.join(' ')}`);
			return NoMatchingKb;
		}

		const matches = candidates.filter(candidate =>
			this.chordsMatch(candidate.chords, pressedChords),
		);
		const command = this.findCommand(context, matches);
		if (!command) {
			this.log(`No keybinding when clauses matched ${pressedChords.join(' ')}`);
			return NoMatchingKb;
		}

		if (pressedChords.length < command.chords.length) {
			return MoreChordsNeeded;
		}

		return keybindingFound(command.command, command.commandArgs, command.bubble);
	}

	private static isTargetedForRemoval(
		defaultKeybinding: ResolvedKeybindingItem,
		removal: ResolvedKeybindingItem,
	): boolean {
		if (removal.chords.length > 0) {
			for (let index = 0; index < removal.chords.length; index += 1) {
				if (removal.chords[index] !== defaultKeybinding.chords[index]) {
					return false;
				}
			}
		}

		return this.contextExpressionEquals(defaultKeybinding.when, removal.when);
	}

	private static contextExpressionEquals(
		left: ContextKeyExpression | undefined,
		right: ContextKeyExpression | undefined,
	): boolean {
		return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
	}

	private addKeyPress(
		keypress: string,
		item: ResolvedKeybindingItem,
	): void {
		const conflicts = this.map.get(keypress);
		if (!conflicts) {
			this.map.set(keypress, [item]);
			this.addToLookupMap(item);
			return;
		}

		conflicts.push(item);
		this.addToLookupMap(item);
	}

	private addToLookupMap(item: ResolvedKeybindingItem): void {
		if (!item.command) {
			return;
		}

		const items = this.lookupMap.get(item.command) ?? [];
		items.push(item);
		this.lookupMap.set(item.command, items);
	}

	private chordsMatch(
		candidateChords: readonly string[],
		pressedChords: readonly string[],
	): boolean {
		if (pressedChords.length > candidateChords.length) {
			return false;
		}

		for (let index = 0; index < pressedChords.length; index += 1) {
			if (candidateChords[index] !== pressedChords[index]) {
				return false;
			}
		}

		return true;
	}

	private findCommand(
		context: ContextKeyService,
		matches: readonly ResolvedKeybindingItem[],
	): ResolvedKeybindingItem | null {
		for (let index = matches.length - 1; index >= 0; index -= 1) {
			const keybinding = matches[index];
			if (context.contextMatchesRules(keybinding.when)) {
				return keybinding;
			}
		}

		return null;
	}
}
