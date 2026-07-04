import type { IJSONSchema } from 'cs/base/common/jsonSchema';
import { EventEmitter } from 'cs/base/common/event';
import type { DisposableLike } from 'cs/base/common/lifecycle';
import { toDisposable } from 'cs/base/common/lifecycle';

export const USER_SETTINGS_SCHEMA_ID = 'vscode://schemas/settings/user';

export type RegisteredJSONSchema = {
  readonly uri: string;
  readonly schema: IJSONSchema;
  readonly fileMatch?: readonly string[];
};

export type JSONSchemaRegistryChangeEvent = {
  readonly uris: ReadonlySet<string>;
};

export interface JSONSchemaRegistry {
  readonly onDidChangeSchema: (
    listener: (event: JSONSchemaRegistryChangeEvent) => void,
  ) => DisposableLike;
  registerSchema(
    uri: string,
    schema: IJSONSchema,
    fileMatch?: readonly string[],
  ): DisposableLike;
  getSchema(uri: string): RegisteredJSONSchema | undefined;
  getSchemas(): Record<string, RegisteredJSONSchema>;
}

export class JSONSchemaRegistryImpl implements JSONSchemaRegistry {
  private readonly schemas = new Map<string, RegisteredJSONSchema>();
  private readonly didChangeSchemaEmitter =
    new EventEmitter<JSONSchemaRegistryChangeEvent>();

  readonly onDidChangeSchema = this.didChangeSchemaEmitter.event;

  registerSchema(
    uri: string,
    schema: IJSONSchema,
    fileMatch?: readonly string[],
  ): DisposableLike {
    this.schemas.set(uri, {
      uri,
      schema,
      fileMatch,
    });
    this.fireSchemaChange(uri);

    return toDisposable(() => {
      const current = this.schemas.get(uri);
      if (current?.schema !== schema) {
        return;
      }

      this.schemas.delete(uri);
      this.fireSchemaChange(uri);
    });
  }

  getSchema(uri: string): RegisteredJSONSchema | undefined {
    return this.schemas.get(uri);
  }

  getSchemas(): Record<string, RegisteredJSONSchema> {
    return Object.fromEntries(this.schemas);
  }

  dispose(): void {
    const uris = [...this.schemas.keys()];
    this.schemas.clear();
    this.didChangeSchemaEmitter.fire({ uris: new Set(uris) });
    this.didChangeSchemaEmitter.dispose();
  }

  private fireSchemaChange(uri: string): void {
    this.didChangeSchemaEmitter.fire({ uris: new Set([uri]) });
  }
}

export const jsonSchemaRegistry: JSONSchemaRegistry =
  new JSONSchemaRegistryImpl();
