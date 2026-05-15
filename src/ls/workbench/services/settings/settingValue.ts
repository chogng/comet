export type SettingValue<T> = {
  defaultValue: T;
  userValue: T | null;
  value: T;
};

export function createSettingValue<T>(
  defaultValue: T,
  userValue: T | null,
  clone: (value: T) => T,
): SettingValue<T> {
  return {
    defaultValue: clone(defaultValue),
    userValue: userValue ? clone(userValue) : null,
    value: clone(userValue ?? defaultValue),
  };
}

export function areSettingValuesEqual<T>(
  previous: SettingValue<T>,
  next: SettingValue<T>,
  isEqual: (previousValue: T, nextValue: T) => boolean,
) {
  return (
    isEqual(previous.defaultValue, next.defaultValue) &&
    (
      previous.userValue === null
        ? next.userValue === null
        : next.userValue !== null && isEqual(previous.userValue, next.userValue)
    ) &&
    isEqual(previous.value, next.value)
  );
}

export function deriveUserSettingValue<T>(
  defaultValue: T,
  nextResolvedValue: T,
  clone: (value: T) => T,
  isEqual: (previousValue: T, nextValue: T) => boolean,
) {
  return isEqual(defaultValue, nextResolvedValue) ? null : clone(nextResolvedValue);
}

export function cloneSettingValue<T>(
  settingValue: SettingValue<T>,
  clone: (value: T) => T,
) {
  return createSettingValue(settingValue.defaultValue, settingValue.userValue, clone);
}
