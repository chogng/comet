import type { ContextKeyExpression } from 'ls/platform/contextkey/common/contextkey';
import { toDisposable, type IDisposable } from 'ls/base/common/lifecycle';

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
