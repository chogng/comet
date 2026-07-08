/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ErrorNoTelemetry } from '../common/errors.js';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function toErrorMessage(error: unknown, verbose = false): string {
  if (error instanceof Error) {
    return verbose && error.stack ? error.stack : error.message;
  }

  return String(error);
}

function mark(name: string) {
  globalThis.performance?.mark?.(name);
}

class MissingStoresError extends Error {
  constructor(readonly db: IDBDatabase) {
    super('Missing stores');
  }
}

export class DBClosedError extends Error {
  readonly code = 'DBClosed';

  constructor(dbName: string) {
    super(`IndexedDB database '${dbName}' is closed.`);
  }
}

export class IndexedDB {
  static async create(
    name: string,
    version: number | undefined,
    stores: string[],
  ): Promise<IndexedDB> {
    const database = await IndexedDB.openDatabase(name, version, stores);
    return new IndexedDB(database, name);
  }

  private static async openDatabase(
    name: string,
    version: number | undefined,
    stores: string[],
  ): Promise<IDBDatabase> {
    mark(`code/willOpenDatabase/${name}`);
    try {
      return await IndexedDB.doOpenDatabase(name, version, stores);
    } catch (error) {
      if (error instanceof MissingStoresError) {
        console.info('Attempting to recreate the IndexedDB once.', name);

        try {
          await IndexedDB.deleteDatabase(error.db);
        } catch (deleteError) {
          console.error('Error while deleting the IndexedDB', getErrorMessage(deleteError));
          throw deleteError;
        }

        return await IndexedDB.doOpenDatabase(name, version, stores);
      }

      throw error;
    } finally {
      mark(`code/didOpenDatabase/${name}`);
    }
  }

  private static doOpenDatabase(
    name: string,
    version: number | undefined,
    stores: string[],
  ): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        for (const store of stores) {
          if (!db.objectStoreNames.contains(store)) {
            console.error(
              `Error while opening IndexedDB. Could not find '${store}' object store`,
            );
            reject(new MissingStoresError(db));
            return;
          }
        }
        resolve(db);
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of stores) {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store);
          }
        }
      };
    });
  }

  private static deleteDatabase(database: IDBDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
      database.close();

      const deleteRequest = indexedDB.deleteDatabase(database.name);
      deleteRequest.onerror = () => reject(deleteRequest.error);
      deleteRequest.onsuccess = () => resolve();
    });
  }

  private database: IDBDatabase | null = null;
  private readonly pendingTransactions: IDBTransaction[] = [];

  constructor(database: IDBDatabase, private readonly name: string) {
    this.database = database;
  }

  hasPendingTransactions(): boolean {
    return this.pendingTransactions.length > 0;
  }

  close(): void {
    if (this.pendingTransactions.length) {
      this.pendingTransactions
        .splice(0, this.pendingTransactions.length)
        .forEach((transaction) => transaction.abort());
    }
    this.database?.close();
    this.database = null;
  }

  runInTransaction<T>(
    store: string,
    transactionMode: IDBTransactionMode,
    dbRequestFn: (store: IDBObjectStore) => IDBRequest<T>[],
  ): Promise<T[]>;
  runInTransaction<T>(
    store: string,
    transactionMode: IDBTransactionMode,
    dbRequestFn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T>;
  async runInTransaction<T>(
    store: string,
    transactionMode: IDBTransactionMode,
    dbRequestFn: (store: IDBObjectStore) => IDBRequest<T> | IDBRequest<T>[],
  ): Promise<T | T[]> {
    if (!this.database) {
      throw new DBClosedError(this.name);
    }

    const transaction = this.database.transaction(store, transactionMode);
    this.pendingTransactions.push(transaction);
    return new Promise<T | T[]>((resolve, reject) => {
      const request = dbRequestFn(transaction.objectStore(store));
      transaction.oncomplete = () => {
        if (Array.isArray(request)) {
          resolve(request.map((nextRequest) => nextRequest.result));
        } else {
          resolve(request.result);
        }
      };
      transaction.onerror = () => {
        reject(
          transaction.error
            ? ErrorNoTelemetry.fromError(transaction.error)
            : new ErrorNoTelemetry('unknown error'),
        );
      };
      transaction.onabort = () => {
        reject(
          transaction.error
            ? ErrorNoTelemetry.fromError(transaction.error)
            : new ErrorNoTelemetry('unknown error'),
        );
      };
    }).finally(() => {
      this.pendingTransactions.splice(this.pendingTransactions.indexOf(transaction), 1);
    });
  }

  async getKeyValues<V>(
    store: string,
    isValid: (value: unknown) => value is V,
  ): Promise<Map<string, V>> {
    if (!this.database) {
      throw new DBClosedError(this.name);
    }

    const transaction = this.database.transaction(store, 'readonly');
    this.pendingTransactions.push(transaction);
    return new Promise<Map<string, V>>((resolve) => {
      const items = new Map<string, V>();
      const objectStore = transaction.objectStore(store);
      const cursor = objectStore.openCursor();
      if (!cursor) {
        resolve(items);
        return;
      }

      cursor.onsuccess = () => {
        if (cursor.result) {
          if (isValid(cursor.result.value)) {
            items.set(cursor.result.key.toString(), cursor.result.value);
          }
          cursor.result.continue();
        } else {
          resolve(items);
        }
      };

      const onError = (error: Error | null) => {
        console.error(`IndexedDB getKeyValues(): ${toErrorMessage(error, true)}`);
        resolve(items);
      };
      cursor.onerror = () => onError(cursor.error);
      transaction.onerror = () => onError(transaction.error);
    }).finally(() => {
      this.pendingTransactions.splice(this.pendingTransactions.indexOf(transaction), 1);
    });
  }
}
