import type { ILocalizedString } from 'ls/platform/action/common/action';

function localize2(value: string): ILocalizedString {
  return { value, original: value };
}

export const Categories = Object.freeze({
  View: localize2('View'),
  Help: localize2('Help'),
  Test: localize2('Test'),
  File: localize2('File'),
  Preferences: localize2('Preferences'),
  Developer: localize2('Developer'),
});
