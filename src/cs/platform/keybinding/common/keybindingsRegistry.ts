/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ContextKeyExpression } from 'cs/platform/contextkey/common/contextkey';
import { decodeKeybinding, type Keybinding } from 'cs/base/common/keybindings';
import {
	DisposableStore,
	combinedDisposable,
	toDisposable,
	type IDisposable,
} from 'cs/base/common/lifecycle';
import { OS, OperatingSystem } from 'cs/base/common/platform';
import {
	commandsRegistry,
	type CommandHandler,
	type CommandId,
} from 'cs/platform/commands/common/commands';

export interface IKeybindingItem {
	readonly keybinding: Keybinding | null;
	readonly command: string | null;
	readonly commandArgs?: unknown;
	readonly when: ContextKeyExpression | undefined;
	readonly weight1: number;
	readonly weight2: number;
	readonly extensionId: string | null;
	readonly isBuiltinExtension: boolean;
}

export interface IKeybindings {
	readonly primary?: number;
	readonly secondary?: readonly number[];
	readonly win?: {
		readonly primary?: number;
		readonly secondary?: readonly number[];
	};
	readonly linux?: {
		readonly primary?: number;
		readonly secondary?: readonly number[];
	};
	readonly mac?: {
		readonly primary?: number;
		readonly secondary?: readonly number[];
	};
}

export interface IKeybindingRule extends IKeybindings {
  readonly id: string;
  readonly when?: ContextKeyExpression;
  readonly weight: number;
  readonly args?: unknown;
}

export interface IExtensionKeybindingRule {
	readonly keybinding: Keybinding | null;
	readonly id: string;
	readonly args?: unknown;
	readonly weight: number;
	readonly when: ContextKeyExpression | undefined;
	readonly extensionId?: string;
	readonly isBuiltinExtension?: boolean;
}

export interface ICommandAndKeybindingRule<
	TArgs extends unknown[] = unknown[],
	TResult = unknown,
> extends IKeybindingRule {
	readonly handler: CommandHandler<TArgs, TResult>;
}

export interface IKeybindingsRegistry {
  registerKeybindingRule(rule: IKeybindingRule): IDisposable;
  setExtensionKeybindings(rules: readonly IExtensionKeybindingRule[]): void;
  registerCommandAndKeybindingRule<
		TArgs extends unknown[] = unknown[],
		TResult = unknown,
	>(desc: ICommandAndKeybindingRule<TArgs, TResult>): IDisposable;
  getDefaultKeybindings(): readonly IKeybindingItem[];
  getDefaultKeybindingsForOS(os: OperatingSystem): readonly IKeybindingItem[];
}

export const enum KeybindingWeight {
  EditorCore = 0,
  EditorContrib = 100,
  WorkbenchContrib = 200,
  SessionsContrib = 250,
  BuiltinExtension = 300,
  ExternalExtension = 400,
}

class KeybindingsRegistryImpl implements IKeybindingsRegistry {
  private readonly keybindings: IKeybindingItem[] = [];
  private readonly rules: IKeybindingRule[] = [];
  private extensionKeybindings: IKeybindingItem[] = [];
  private cachedMergedKeybindings: IKeybindingItem[] | null = null;

  registerKeybindingRule(rule: IKeybindingRule): IDisposable {
    const actualKeybinding = KeybindingsRegistryImpl.bindToCurrentPlatform(rule);
    const store = new DisposableStore();

    if (actualKeybinding.primary) {
      const keybinding = decodeKeybinding(actualKeybinding.primary, OS);
      if (keybinding) {
        store.add(this.registerDefaultKeybinding(
          keybinding,
          rule.id,
          rule.args,
          rule.weight,
          0,
          rule.when,
        ));
      }
    }

    if (actualKeybinding.secondary) {
      actualKeybinding.secondary.forEach((secondaryKeybinding, index) => {
        const keybinding = decodeKeybinding(secondaryKeybinding, OS);
        if (keybinding) {
          store.add(this.registerDefaultKeybinding(
            keybinding,
            rule.id,
            rule.args,
            rule.weight,
            -index - 1,
            rule.when,
          ));
        }
      });
    }

    this.rules.push(rule);
    store.add(toDisposable(() => {
      const index = this.rules.indexOf(rule);
      if (index >= 0) {
        this.rules.splice(index, 1);
      }
    }));

    return store;
  }

  setExtensionKeybindings(rules: readonly IExtensionKeybindingRule[]): void {
    this.extensionKeybindings = rules
      .filter(rule => Boolean(rule.keybinding))
      .map(rule => ({
        keybinding: rule.keybinding,
        command: rule.id,
        commandArgs: rule.args,
        when: rule.when,
        weight1: rule.weight,
        weight2: 0,
        extensionId: rule.extensionId ?? null,
        isBuiltinExtension: rule.isBuiltinExtension ?? false,
      }));
    this.cachedMergedKeybindings = null;
  }

  registerCommandAndKeybindingRule<
		TArgs extends unknown[] = unknown[],
		TResult = unknown,
	>(desc: ICommandAndKeybindingRule<TArgs, TResult>): IDisposable {
    return combinedDisposable(
      this.registerKeybindingRule(desc),
      commandsRegistry.registerCommand<TArgs, TResult>(desc.id as CommandId, desc.handler),
    );
  }

  getDefaultKeybindings(): readonly IKeybindingItem[] {
    if (!this.cachedMergedKeybindings) {
      this.cachedMergedKeybindings = [
        ...this.keybindings,
        ...this.extensionKeybindings,
      ].sort(compareKeybindings);
    }

    return [...this.cachedMergedKeybindings];
  }

  getDefaultKeybindingsForOS(os: OperatingSystem): readonly IKeybindingItem[] {
    const result: IKeybindingItem[] = [];
    for (const rule of this.rules) {
      const actualKeybinding = KeybindingsRegistryImpl.bindToPlatform(rule, os);
      if (actualKeybinding.primary) {
        const keybinding = decodeKeybinding(actualKeybinding.primary, os);
        if (keybinding) {
          result.push({
            keybinding,
            command: rule.id,
            commandArgs: rule.args,
            when: rule.when,
            weight1: rule.weight,
            weight2: 0,
            extensionId: null,
            isBuiltinExtension: false,
          });
        }
      }

      if (actualKeybinding.secondary) {
        actualKeybinding.secondary.forEach((secondaryKeybinding, index) => {
          const keybinding = decodeKeybinding(secondaryKeybinding, os);
          if (keybinding) {
            result.push({
              keybinding,
              command: rule.id,
              commandArgs: rule.args,
              when: rule.when,
              weight1: rule.weight,
              weight2: -index - 1,
              extensionId: null,
              isBuiltinExtension: false,
            });
          }
        });
      }
    }

    return result.sort(compareKeybindings);
  }

  private static bindToCurrentPlatform(
    keybinding: IKeybindings,
  ): Pick<IKeybindings, 'primary' | 'secondary'> {
    return this.bindToPlatform(keybinding, OS);
  }

  private static bindToPlatform(
    keybinding: IKeybindings,
    os: OperatingSystem,
  ): Pick<IKeybindings, 'primary' | 'secondary'> {
    if (os === OperatingSystem.Windows && keybinding.win) {
      return keybinding.win;
    }
    if (os === OperatingSystem.Macintosh && keybinding.mac) {
      return keybinding.mac;
    }
    if (os === OperatingSystem.Linux && keybinding.linux) {
      return keybinding.linux;
    }

    return keybinding;
  }

  private registerDefaultKeybinding(
    keybinding: Keybinding,
    command: string,
    commandArgs: unknown,
    weight1: number,
    weight2: number,
    when: ContextKeyExpression | undefined,
  ): IDisposable {
    const item: IKeybindingItem = {
      keybinding,
      command,
      commandArgs,
      when,
      weight1,
      weight2,
      extensionId: null,
      isBuiltinExtension: false,
    };
    this.keybindings.push(item);
    this.cachedMergedKeybindings = null;

    return toDisposable(() => {
      const index = this.keybindings.indexOf(item);
      if (index >= 0) {
        this.keybindings.splice(index, 1);
        this.cachedMergedKeybindings = null;
      }
    });
  }
}

export const KeybindingsRegistry: IKeybindingsRegistry =
  new KeybindingsRegistryImpl();

function compareKeybindings(
  left: IKeybindingItem,
  right: IKeybindingItem,
): number {
  if (left.weight1 !== right.weight1) {
    return left.weight1 - right.weight1;
  }

  if (left.command && right.command && left.command !== right.command) {
    return left.command < right.command ? -1 : 1;
  }

  return left.weight2 - right.weight2;
}
