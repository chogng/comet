import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';

import { createLibraryStore } from '../libraryStore.js';

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
    if (errorCode === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function withLibraryStore(
  run: (
    store: ReturnType<typeof createLibraryStore>,
    tempDir: string,
  ) => Promise<void>,
) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'library-store-delete-'));
  let store: ReturnType<typeof createLibraryStore> | undefined;
  try {
    const libraryDbFile = path.join(tempDir, 'library.sqlite');
    const libraryFilesDir = path.join(tempDir, 'library-files');
    const ragCacheDir = path.join(tempDir, 'rag-cache');
    await mkdir(libraryFilesDir, { recursive: true });
    await mkdir(ragCacheDir, { recursive: true });

    store = createLibraryStore({
      libraryDbFile,
      libraryFilesDir,
      ragCacheDir,
    });

    await run(store, tempDir);
  } finally {
    store?.dispose();
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('deleteLibraryDocument removes a linked original PDF from disk', async () => {
  await withLibraryStore(async (store, tempDir) => {
    const sourceFilePath = path.join(tempDir, 'linked-original.pdf');
    await writeFile(sourceFilePath, 'linked-original-pdf');

    const registration = await store.registerLibraryDocument({
      filePath: sourceFilePath,
      articleTitle: 'Linked original',
    });

    const deleted = await store.deleteLibraryDocument({
      documentId: registration.documentId,
    });

    assert.equal(deleted, true);
    assert.equal(await pathExists(sourceFilePath), false);

    const snapshot = await store.listLibraryDocuments();
    assert.equal(snapshot.totalCount, 0);
    assert.equal(snapshot.fileCount, 0);
  });
});

test('deleteLibraryDocument removes the managed-copy PDF and preserves the source file', async () => {
  await withLibraryStore(async (store, tempDir) => {
    const sourceFilePath = path.join(tempDir, 'managed-source.pdf');
    await writeFile(sourceFilePath, 'managed-copy-pdf');

    const registration = await store.registerLibraryDocument({
      filePath: sourceFilePath,
      articleTitle: 'Managed copy',
      storageMode: 'managed-copy',
    } as Parameters<typeof store.registerLibraryDocument>[0] & {
      storageMode: 'managed-copy';
    });

    assert.equal(await pathExists(registration.filePath), true);
    assert.notEqual(path.resolve(registration.filePath), path.resolve(sourceFilePath));

    const deleted = await store.deleteLibraryDocument({
      documentId: registration.documentId,
    });

    assert.equal(deleted, true);
    assert.equal(await pathExists(registration.filePath), false);
    assert.equal(await pathExists(sourceFilePath), true);
  });
});

test('deleteLibraryDocument ignores already-missing files and still removes the document', async () => {
  await withLibraryStore(async (store, tempDir) => {
    const sourceFilePath = path.join(tempDir, 'missing-before-delete.pdf');
    await writeFile(sourceFilePath, 'missing-before-delete');

    const registration = await store.registerLibraryDocument({
      filePath: sourceFilePath,
      articleTitle: 'Missing file',
    });

    await rm(sourceFilePath, { force: true });

    const deleted = await store.deleteLibraryDocument({
      documentId: registration.documentId,
    });

    assert.equal(deleted, true);
    const snapshot = await store.listLibraryDocuments();
    assert.equal(snapshot.totalCount, 0);
    assert.equal(snapshot.fileCount, 0);
  });
});
