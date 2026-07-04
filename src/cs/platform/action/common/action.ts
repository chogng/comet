import type { ContextKeyExpression } from 'cs/platform/contextkey/common/contextkey';
import { Categories } from 'cs/platform/action/common/actionCommonCategories';

export interface ILocalizedString {
  readonly value: string;
  readonly original: string;
}

export function isLocalizedString(value: unknown): value is ILocalizedString {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ILocalizedString).value === 'string' &&
    typeof (value as ILocalizedString).original === 'string'
  );
}

export interface ICommandActionTitle extends ILocalizedString {
  readonly mnemonicTitle?: string;
}

export type Icon =
  | string
  | { readonly id: string }
  | { readonly dark?: string; readonly light?: string };

export interface ICommandActionToggleInfo {
  readonly condition: ContextKeyExpression;
  readonly icon?: Icon;
  readonly tooltip?: string | ILocalizedString;
  readonly title?: string | ICommandActionTitle;
  readonly mnemonicTitle?: string;
}

export function isICommandActionToggleInfo(
  value: ContextKeyExpression | ICommandActionToggleInfo | undefined,
): value is ICommandActionToggleInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'condition' in value
  );
}

export interface ICommandActionSource {
  readonly id: string;
  readonly title: string;
}

export interface ICommandMetadata {
  readonly description?: string | ILocalizedString;
  readonly args?: readonly unknown[];
  readonly returns?: string | ILocalizedString;
}

export interface ICommandAction {
  readonly id: string;
  readonly title: string | ICommandActionTitle;
  readonly shortTitle?: string | ICommandActionTitle;
  readonly metadata?: ICommandMetadata;
  readonly category?: keyof typeof Categories | ILocalizedString | string;
  readonly tooltip?: string | ILocalizedString;
  readonly icon?: Icon;
  readonly source?: ICommandActionSource;
  readonly precondition?: ContextKeyExpression;
  readonly toggled?: ContextKeyExpression | ICommandActionToggleInfo;
}

export type ISerializableCommandAction = ICommandAction;
