export type EditorViewStateKey = {
  groupId: string;
  paneId: string;
  resourceKey: string;
};

export type SerializedEditorViewStateEntry = {
  key: EditorViewStateKey;
  state: unknown;
};

function isEditorViewStateKey(value: unknown): value is EditorViewStateKey {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<EditorViewStateKey>;
  return (
    typeof candidate.groupId === 'string' &&
    typeof candidate.paneId === 'string' &&
    typeof candidate.resourceKey === 'string'
  );
}

function serializeEditorViewStateKey(key: EditorViewStateKey) {
  return JSON.stringify(key);
}

export class EditorViewStateStore {
  private readonly viewStateByKey = new Map<string, unknown>();

  constructor(entries: readonly SerializedEditorViewStateEntry[] = []) {
    this.replaceAll(entries);
  }

  get<TViewState>(key: EditorViewStateKey) {
    return this.viewStateByKey.get(serializeEditorViewStateKey(key)) as
      | TViewState
      | undefined;
  }

  set<TViewState>(key: EditorViewStateKey, state: TViewState) {
    this.viewStateByKey.set(serializeEditorViewStateKey(key), state);
  }

  delete(key: EditorViewStateKey) {
    this.viewStateByKey.delete(serializeEditorViewStateKey(key));
  }

  clear() {
    this.viewStateByKey.clear();
  }

  entries(): SerializedEditorViewStateEntry[] {
    return [...this.viewStateByKey.entries()].map(([serializedKey, state]) => ({
      key: JSON.parse(serializedKey) as EditorViewStateKey,
      state,
    }));
  }

  replaceAll(entries: readonly SerializedEditorViewStateEntry[]) {
    this.clear();
    for (const entry of entries) {
      this.set(entry.key, entry.state);
    }
  }
}

export function normalizeSerializedEditorViewStateEntries(
  value: unknown,
): SerializedEditorViewStateEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const candidate = entry as Partial<SerializedEditorViewStateEntry>;
    if (!isEditorViewStateKey(candidate.key)) {
      return [];
    }

    return [
      {
        key: candidate.key,
        state: candidate.state,
      } satisfies SerializedEditorViewStateEntry,
    ];
  });
}

export function createEditorViewStateStore(
  entries: readonly SerializedEditorViewStateEntry[] = [],
) {
  return new EditorViewStateStore(entries);
}
