/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ContextKeyExpression } from 'cs/platform/contextkey/common/contextkey';
import { toDisposable, type IDisposable } from 'cs/base/common/lifecycle';

export interface IKeybindingRule {
  readonly id: string;
  readonly primary?: number;
  readonly secondary?: readonly number[];
  readonly when?: ContextKeyExpression;
  readonly weight?: number;
  readonly args?: unknown;
}

export interface IKeybindingsRegistry {
  registerKeybindingRule(rule: IKeybindingRule): IDisposable;
  getDefaultKeybindings(): readonly IKeybindingRule[];
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
  private readonly rules: IKeybindingRule[] = [];

  registerKeybindingRule(rule: IKeybindingRule): IDisposable {
    this.rules.push(rule);
    return toDisposable(() => {
      const index = this.rules.indexOf(rule);
      if (index >= 0) {
        this.rules.splice(index, 1);
      }
    });
  }

  getDefaultKeybindings(): readonly IKeybindingRule[] {
    return [...this.rules];
  }
}

export const KeybindingsRegistry: IKeybindingsRegistry =
  new KeybindingsRegistryImpl();
