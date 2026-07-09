/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addStandardDisposableListener } from 'cs/base/browser/dom';
import { KeyCode } from 'cs/base/common/keyCodes';
import type { IDisposable } from 'cs/base/common/lifecycle';
import {
	DisposableStore,
	toDisposable,
} from 'cs/base/common/lifecycle';
import { KeyCodeChord } from 'cs/base/common/keybindings';
import type {
	Keybinding,
	ResolvedKeybinding,
} from 'cs/base/common/keybindings';
import { KeybindingParser } from 'cs/base/common/keybindingParser';
import { OS } from 'cs/base/common/platform';
import { EventEmitter } from 'cs/base/common/event';
import { KeyCodeResolvedKeybinding } from 'cs/platform/keybinding/common/baseResolvedKeybinding';
import {
	IKeybindingService,
	type IKeyboardEvent,
	type KeybindingsSchemaContribution,
} from 'cs/platform/keybinding/common/keybinding';
import {
	KeybindingResolver,
	type ResolutionResult,
	NoMatchingKb,
	ResultKind,
} from 'cs/platform/keybinding/common/keybindingResolver';
import {
  InstantiationType,
  registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import {
  KeybindingsRegistry,
  type IKeybindingRule,
  type IKeybindingItem,
} from 'cs/platform/keybinding/common/keybindingsRegistry';
import { contextKeyService, type ContextKeyService } from 'cs/platform/contextkey/common/contextkey';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { ResolvedKeybindingItem } from 'cs/platform/keybinding/common/resolvedKeybindingItem';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

export class BrowserWorkbenchKeybindingService
  implements IKeybindingService
{
  declare readonly _serviceBrand: undefined;
	private readonly store = new DisposableStore();
	private readonly onDidUpdateKeybindingsEmitter = new EventEmitter<void>();
	private readonly schemaContributions = new Set<KeybindingsSchemaContribution>();
	private currentChords: string[] = [];
	private currentlyDispatchingCommandId: string | null = null;
	private logging = false;

	readonly onDidUpdateKeybindings = this.onDidUpdateKeybindingsEmitter.event;

	get inChordMode(): boolean {
		return this.currentChords.length > 0;
	}

	constructor(
		@IWorkbenchCommandService private readonly commandService: IWorkbenchCommandService,
	) {
		this.store.add(addStandardDisposableListener(
			window.document,
			'keydown',
			event => {
				if (this.dispatchEvent(event, event.target)) {
					event.preventDefault();
					event.stopPropagation();
				}
			},
			true,
		));
	}

  registerKeybindingRule(rule: IKeybindingRule) {
    return KeybindingsRegistry.registerKeybindingRule(rule);
  }

  getDefaultKeybindings() {
    return this.getResolver().getDefaultKeybindings();
  }

	getKeybindings(): readonly ResolvedKeybindingItem[] {
		return this.getResolver().getKeybindings();
	}

	getDefaultKeybindingsContent(): string {
		return '';
	}

	customKeybindingsCount(): number {
		return 0;
	}

	resolveKeybinding(keybinding: Keybinding): ResolvedKeybinding[] {
		const keyCodeChords: KeyCodeChord[] = [];
		for (const chord of keybinding.chords) {
			if (!(chord instanceof KeyCodeChord)) {
				return [];
			}
			keyCodeChords.push(chord);
		}

		return [
			new KeyCodeResolvedKeybinding(
				keyCodeChords,
				OS,
			),
		];
	}

	resolveKeyboardEvent(keyboardEvent: IKeyboardEvent): ResolvedKeybinding {
		return new KeyCodeResolvedKeybinding(
			[keyboardEvent.toKeyCodeChord()],
			OS,
		);
	}

	resolveUserBinding(userBinding: string): ResolvedKeybinding[] {
		const keybinding = KeybindingParser.parseKeybinding(userBinding);
		if (!keybinding) {
			return [];
		}

		return this.resolveKeybinding(keybinding);
	}

	dispatchEvent(event: IKeyboardEvent, target: EventTarget | null): boolean {
		return this.dispatchResolvedKeybinding(
			this.resolveKeyboardEvent(event),
			target,
			true,
		);
	}

	softDispatch(
		event: IKeyboardEvent,
		_target: EventTarget | null,
	): ResolutionResult {
		const keybinding = this.resolveKeyboardEvent(event);
		const [keypress] = keybinding.getDispatchChords();
		if (!keypress) {
			return NoMatchingKb;
		}

		return this.getResolver().resolve(
			contextKeyService,
			this.currentChords,
			keypress,
		);
	}

	enableKeybindingHoldMode(commandId: string): Promise<void> | undefined {
		if (this.currentlyDispatchingCommandId !== commandId) {
			return undefined;
		}

		return new Promise(resolve => {
			const disposable = addStandardDisposableListener(
				window.document,
				'keyup',
				() => {
					disposable.dispose();
					resolve();
				},
				true,
			);
		});
	}

	dispatchByUserSettingsLabel(
		userSettingsLabel: string,
		target: EventTarget | null,
	): void {
		const keybindings = this.resolveUserBinding(userSettingsLabel);
		if (keybindings.length === 0) {
			return;
		}

		this.dispatchResolvedKeybinding(keybindings[0], target, false);
	}

	lookupKeybindings(commandId: string): ResolvedKeybinding[] {
		return this.getResolver()
			.lookupKeybindings(commandId)
			.map(item => item.resolvedKeybinding)
			.filter((keybinding): keybinding is ResolvedKeybinding =>
				Boolean(keybinding),
			);
	}

	lookupKeybinding(
		commandId: string,
		context: ContextKeyService = contextKeyService,
		enforceContextCheck = false,
	): ResolvedKeybinding | undefined {
		return this.getResolver()
			.lookupPrimaryKeybinding(commandId, context, enforceContextCheck)
			?.resolvedKeybinding;
	}

	mightProducePrintableCharacter(event: IKeyboardEvent): boolean {
		if (event.ctrlKey || event.metaKey) {
			return false;
		}

		return (
			(event.keyCode >= KeyCode.KeyA && event.keyCode <= KeyCode.KeyZ) ||
			(event.keyCode >= KeyCode.Digit0 && event.keyCode <= KeyCode.Digit9)
		);
	}

	registerSchemaContribution(
		contribution: KeybindingsSchemaContribution,
	): IDisposable {
		this.schemaContributions.add(contribution);
		this.onDidUpdateKeybindingsEmitter.fire();
		return toDisposable(() => {
			this.schemaContributions.delete(contribution);
			this.onDidUpdateKeybindingsEmitter.fire();
		});
	}

	toggleLogging(): boolean {
		this.logging = !this.logging;
		return this.logging;
	}

	appendKeybinding(
		label: string,
		commandId: string | undefined | null,
		context?: ContextKeyService,
		enforceContextCheck?: boolean,
	): string {
		if (!commandId) {
			return label;
		}

		const keybindingLabel = this.lookupKeybinding(
			commandId,
			context,
			enforceContextCheck,
		)?.getLabel();
		return keybindingLabel ? `${label} (${keybindingLabel})` : label;
	}

	_dumpDebugInfo(): string {
		return this.getKeybindings()
			.map(item => `${item.command ?? ''}: ${item.chords.join(' ')}`)
			.join('\n');
	}

	_dumpDebugInfoJSON(): string {
		return JSON.stringify(this.getKeybindings(), null, 2);
	}

	dispose(): void {
		this.store.dispose();
		this.onDidUpdateKeybindingsEmitter.dispose();
	}

	private dispatchResolvedKeybinding(
		keybinding: ResolvedKeybinding,
		_target: EventTarget | null,
		updateChordState: boolean,
	): boolean {
		if (keybinding.hasMultipleChords()) {
			return false;
		}

		const [keypress] = keybinding.getDispatchChords();
		if (!keypress) {
			return false;
		}

		const resolveResult = this.getResolver().resolve(
			contextKeyService,
			this.currentChords,
			keypress,
		);

		switch (resolveResult.kind) {
			case ResultKind.NoMatchingKb:
				if (this.inChordMode && updateChordState) {
					this.currentChords = [];
					return true;
				}
				return false;
			case ResultKind.MoreChordsNeeded:
				if (updateChordState) {
					this.currentChords = [...this.currentChords, keypress];
				}
				return true;
			case ResultKind.KbFound:
				if (updateChordState) {
					this.currentChords = [];
				}
				if (resolveResult.commandId) {
					this.currentlyDispatchingCommandId = resolveResult.commandId;
					try {
						if (typeof resolveResult.commandArgs === 'undefined') {
							this.commandService.executeCommand(resolveResult.commandId);
						} else {
							this.commandService.executeCommand(
								resolveResult.commandId,
								resolveResult.commandArgs,
							);
						}
					} finally {
						this.currentlyDispatchingCommandId = null;
					}
				}
				return !resolveResult.isBubble;
		}
	}

	private getResolver(): KeybindingResolver {
		return new KeybindingResolver(
			this.resolveKeybindingItems(KeybindingsRegistry.getDefaultKeybindings()),
			[],
			message => {
				if (this.logging) {
					console.info(`[KeybindingService]: ${message}`);
				}
			},
		);
	}

	private resolveKeybindingItems(
		items: readonly IKeybindingItem[],
	): ResolvedKeybindingItem[] {
		return items.map(item => new ResolvedKeybindingItem(
			item.keybinding
				? this.resolveKeybinding(item.keybinding)[0]
				: undefined,
			item.command,
			item.commandArgs,
			item.when,
			true,
			item.extensionId,
			item.isBuiltinExtension,
		));
	}
}

registerSingleton(
  IKeybindingService,
  BrowserWorkbenchKeybindingService,
  InstantiationType.Delayed,
);

registerWorkbenchContribution(() => {
	getWorkbenchInstantiationService().createInstance(WorkbenchKeybindingContribution);
});

export class WorkbenchKeybindingContribution {
	constructor(
		@IKeybindingService _keybindingService: IKeybindingService,
	) {}
}

export { KeybindingsRegistry };
export type { IKeybindingRule };
