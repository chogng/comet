export function toValuesTree(
  properties: Record<string, unknown>,
  conflictReporter: (message: string) => void,
): Record<string, unknown> {
  const root: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    addToValueTree(root, key, value, conflictReporter);
  }

  return root;
}

export function addToValueTree(
  treeRoot: Record<string, unknown>,
  key: string,
  value: unknown,
  conflictReporter: (message: string) => void,
): void {
  const segments = key.split('.');
  const last = segments.pop();
  if (!last) {
    return;
  }

  let current = treeRoot;
  for (const segment of segments) {
    const entry = current[segment];
    if (entry === undefined) {
      const child: Record<string, unknown> = {};
      current[segment] = child;
      current = child;
      continue;
    }

    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      conflictReporter(`Ignoring ${key} as ${segment} is ${JSON.stringify(entry)}`);
      return;
    }

    current = entry as Record<string, unknown>;
  }

  current[last] = value;
}

export function removeFromValueTree(treeRoot: Record<string, unknown>, key: string): void {
  const segments = key.split('.');
  removeFromValueTreeSegments(treeRoot, segments);
}

function removeFromValueTreeSegments(treeRoot: Record<string, unknown>, segments: string[]) {
  const first = segments.shift();
  if (!first) {
    return;
  }

  if (segments.length === 0) {
    delete treeRoot[first];
    return;
  }

  const child = treeRoot[first];
  if (!child || typeof child !== 'object' || Array.isArray(child)) {
    return;
  }

  removeFromValueTreeSegments(child as Record<string, unknown>, segments);
  if (Object.keys(child).length === 0) {
    delete treeRoot[first];
  }
}

export function getConfigurationValue<T>(
  config: Record<string, unknown>,
  settingPath: string,
): T | undefined;
export function getConfigurationValue<T>(
  config: Record<string, unknown>,
  settingPath: string,
  defaultValue: T,
): T;
export function getConfigurationValue<T>(
  config: Record<string, unknown>,
  settingPath: string,
  defaultValue?: T,
): T | undefined {
  let current: unknown = config;
  for (const segment of settingPath.split('.')) {
    if (!current || typeof current !== 'object') {
      return defaultValue;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current === undefined ? defaultValue : (current as T);
}

export class ConfigurationModel {
  static createEmptyModel() {
    return new ConfigurationModel({}, []);
  }

  constructor(
    private readonly contentsValue: Record<string, unknown>,
    private readonly keysValue: string[],
  ) {}

  get contents() {
    return this.contentsValue;
  }

  get keys() {
    return this.keysValue;
  }

  getValue<T>(section?: string): T | undefined {
    return section
      ? getConfigurationValue<T>(this.contentsValue, section)
      : (this.contentsValue as T);
  }

  setValue(key: string, value: unknown): void {
    addToValueTree(this.contentsValue, key, value, () => {});
    if (!this.keysValue.includes(key)) {
      this.keysValue.push(key);
    }
  }

  removeValue(key: string): void {
    removeFromValueTree(this.contentsValue, key);
    const index = this.keysValue.indexOf(key);
    if (index >= 0) {
      this.keysValue.splice(index, 1);
    }
  }

  merge(...others: ConfigurationModel[]): ConfigurationModel {
    const contents = deepClone(this.contentsValue);
    const keys = new Set(this.keysValue);

    for (const other of others) {
      mergeContents(contents, other.contents);
      for (const key of other.keys) {
        keys.add(key);
      }
    }

    return new ConfigurationModel(contents, [...keys]);
  }

  toJSON() {
    return {
      contents: this.contents,
      keys: this.keys,
    };
  }
}

export function compareConfigurationModels(
  from: ConfigurationModel,
  to: ConfigurationModel,
) {
  const added = to.keys.filter((key) => !from.keys.includes(key));
  const removed = from.keys.filter((key) => !to.keys.includes(key));
  const updated = from.keys.filter(
    (key) =>
      to.keys.includes(key) &&
      !equals(from.getValue(key), to.getValue(key)),
  );

  return { added, removed, updated };
}

function mergeContents(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (
      current &&
      typeof current === 'object' &&
      !Array.isArray(current) &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      mergeContents(current as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }

    target[key] = deepClone(value);
  }
}

function deepClone<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') {
    return value;
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function equals(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
