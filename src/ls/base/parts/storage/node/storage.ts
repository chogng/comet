import { mkdirSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { toDisposable } from 'ls/base/common/lifecycle';
import type {
  IStorageDatabase,
  IStorageItemsChangeEvent,
  IUpdateRequest,
} from 'ls/base/parts/storage/common/storage';
import type { Event } from 'ls/base/common/event';

type StorageRow = {
  key: string;
  value: string;
};

type SqliteError = Error & {
  code?: string;
};

export interface ISQLiteStorageDatabaseOptions {
  readonly logging?: ISQLiteStorageDatabaseLoggingOptions;
  readonly useWAL?: boolean;
  readonly busyTimeout?: number;
}

export interface ISQLiteStorageDatabaseLoggingOptions {
  logError?: (error: string | Error) => void;
  logTrace?: (message: string) => void;
}

function eventNone<T>(): Event<T> {
  return () => toDisposable(() => {});
}

function isSqliteBusy(error: unknown): error is SqliteError {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as SqliteError).code === 'SQLITE_BUSY'
  );
}

export class SQLiteStorageDatabase implements IStorageDatabase {
  static readonly IN_MEMORY_PATH = ':memory:';
  private static readonly MAX_HOST_PARAMETERS = 256;

  readonly onDidChangeItemsExternal = eventNone<IStorageItemsChangeEvent>();

  private readonly name: string;
  private readonly logger: SQLiteStorageDatabaseLogger;
  private database: DatabaseSync | null = null;

  constructor(
    private readonly path: string,
    private readonly options: ISQLiteStorageDatabaseOptions = {},
  ) {
    this.name = basename(path);
    this.logger = new SQLiteStorageDatabaseLogger(options.logging);
  }

  async getItems(): Promise<Map<string, string>> {
    const database = this.ensureDatabase();
    const rows = database
      .prepare('SELECT key, value FROM ItemTable')
      .all() as StorageRow[];
    const items = new Map<string, string>();
    rows.forEach((row) => {
      items.set(row.key, row.value);
    });

    this.logger.trace(`[storage ${this.name}] getItems(): ${items.size} rows`);
    return items;
  }

  async updateItems(request: IUpdateRequest): Promise<void> {
    const database = this.ensureDatabase();
    this.transaction(database, () => {
      this.insertItems(database, request.insert);
      this.deleteItems(database, request.delete);
    });
  }

  async optimize(): Promise<void> {
    const database = this.ensureDatabase();
    database.exec('PRAGMA optimize');
  }

  async close(recovery?: () => Map<string, string>): Promise<void> {
    if (!this.database) {
      return;
    }

    const database = this.database;
    this.database = null;
    try {
      database.close();
    } catch (error) {
      this.logger.error(`[storage ${this.name}] close(): ${String(error)}`);
      if (recovery && this.path !== SQLiteStorageDatabase.IN_MEMORY_PATH) {
        this.recoverToDisk(recovery());
      }
      throw error;
    }
  }

  private ensureDatabase() {
    if (!this.database) {
      this.database = this.connect();
    }

    return this.database;
  }

  private connect() {
    if (this.path !== SQLiteStorageDatabase.IN_MEMORY_PATH) {
      mkdirSync(dirname(this.path), { recursive: true });
    }

    const database = new DatabaseSync(this.path);
    if (typeof this.options.busyTimeout === 'number') {
      database.exec(`PRAGMA busy_timeout = ${Math.max(0, this.options.busyTimeout)}`);
    }
    if (this.options.useWAL && this.path !== SQLiteStorageDatabase.IN_MEMORY_PATH) {
      database.exec('PRAGMA journal_mode = WAL');
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS ItemTable (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    return database;
  }

  private insertItems(database: DatabaseSync, items: Map<string, string> | undefined) {
    if (!items?.size) {
      return;
    }

    const entries = [...items.entries()];
    for (let index = 0; index < entries.length; index += SQLiteStorageDatabase.MAX_HOST_PARAMETERS / 2) {
      const chunk = entries.slice(
        index,
        index + SQLiteStorageDatabase.MAX_HOST_PARAMETERS / 2,
      );
      const placeholders = new Array(chunk.length).fill('(?, ?)').join(', ');
      const values = chunk.flatMap(([key, value]) => [key, value]);
      database.prepare(`
        INSERT INTO ItemTable(key, value)
        VALUES ${placeholders}
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        WHERE value != excluded.value
      `).run(...values);
    }
  }

  private deleteItems(database: DatabaseSync, items: Set<string> | undefined) {
    if (!items?.size) {
      return;
    }

    const keys = [...items];
    for (let index = 0; index < keys.length; index += SQLiteStorageDatabase.MAX_HOST_PARAMETERS) {
      const chunk = keys.slice(index, index + SQLiteStorageDatabase.MAX_HOST_PARAMETERS);
      const placeholders = new Array(chunk.length).fill('?').join(', ');
      database.prepare(`DELETE FROM ItemTable WHERE key IN (${placeholders})`).run(...chunk);
    }
  }

  private transaction(database: DatabaseSync, transactions: () => void) {
    database.exec('BEGIN IMMEDIATE');
    try {
      transactions();
      database.exec('COMMIT');
    } catch (error) {
      try {
        database.exec('ROLLBACK');
      } catch (rollbackError) {
        this.logger.error(
          `[storage ${this.name}] rollback(): ${String(rollbackError)}`,
        );
      }

      if (isSqliteBusy(error)) {
        this.logger.error(`[storage ${this.name}] transaction(): database is busy`);
      }

      throw error;
    }
  }

  private recoverToDisk(items: Map<string, string>) {
    const database = new DatabaseSync(this.path);
    try {
      database.exec('DROP TABLE IF EXISTS ItemTable');
      database.exec(`
        CREATE TABLE ItemTable (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);
      this.insertItems(database, items);
    } finally {
      database.close();
    }
  }
}

class SQLiteStorageDatabaseLogger {
  readonly isTracing: boolean;

  constructor(private readonly options?: ISQLiteStorageDatabaseLoggingOptions) {
    this.isTracing =
      typeof options?.logTrace === 'function' &&
      process.env.VSCODE_TRACE_STORAGE === '1';
  }

  trace(message: string) {
    if (!this.isTracing) {
      return;
    }

    this.options?.logTrace?.(message);
  }

  error(error: string | Error) {
    this.options?.logError?.(error);
  }
}
