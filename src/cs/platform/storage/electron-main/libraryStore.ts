import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import type {
  DeleteLibraryDocumentPayload,
  IndexDownloadedPdfPayload,
  KnowledgeBaseSettings,
  LibraryDedupeReason,
  LibraryDocumentStatusPayload,
  LibraryDocumentSummary,
  LibraryDocumentsResult,
  LibraryIngestStatus,
  ReindexLibraryDocumentResult,
  UpsertLibraryDocumentMetadataPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'cs/base/common/strings';
import { createDefaultKnowledgeBaseSettings } from 'cs/workbench/services/knowledgeBase/config';
import type { StorageService } from 'cs/platform/storage/common/storage';

type LibraryStore = Pick<
  StorageService,
  | 'upsertLibraryDocumentMetadata'
  | 'deleteLibraryDocument'
  | 'registerLibraryDocument'
  | 'getLibraryDocumentStatus'
  | 'listLibraryDocuments'
  | 'reindexLibraryDocument'
> & {
  dispose(): void;
};

type StorageMode = KnowledgeBaseSettings['libraryStorageMode'];

type LibraryPaths = {
  libraryDbFile: string;
  libraryFilesDir: string;
  ragCacheDir: string;
};

type FileFingerprint = {
  fileSize: number;
  sha256: string;
};

type DocumentMatch = {
  documentId: string | null;
  fileId: string | null;
  dedupeReason: LibraryDedupeReason;
};

type DocumentRow = {
  document_id: string;
  title: string | null;
  doi: string | null;
  authors_json: string;
  journal_title: string | null;
  published_at: string | null;
  published_year: string | null;
  source_url: string | null;
  source_id: string | null;
  ingest_status: LibraryIngestStatus;
  created_at: string;
};

type FileRow = {
  file_id: string;
  document_id: string;
};

type DocumentFilePathRow = {
  file_path: string;
};

type DocumentSummaryRow = {
  document_id: string;
  title: string | null;
  doi: string | null;
  authors_json: string;
  journal_title: string | null;
  published_at: string | null;
  source_url: string | null;
  source_id: string | null;
  ingest_status: LibraryIngestStatus;
  file_count: number | null;
  latest_file_path: string | null;
  latest_downloaded_at: string | null;
  latest_job_type: string | null;
  latest_job_status: string | null;
  created_at: string;
  updated_at: string;
};

type CountRow = {
  count: number | null;
};

const registrationVersion = 'phase1-register-v1';
const defaultListLimit = 8;
const maxListLimit = 50;
const pdfMimeType = 'application/pdf';

function nowIso() {
  return new Date().toISOString();
}

function parseAuthorsJson(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .map((item) => cleanText(item))
          .filter((item): item is string => Boolean(item))
      : [];
  } catch {
    return [];
  }
}

function normalizeAuthors(input: unknown) {
  return Array.isArray(input)
    ? input
        .map((item) => cleanText(item))
        .filter((item): item is string => Boolean(item))
    : [];
}

function normalizeDoi(input: unknown) {
  const cleaned = cleanText(input).toLowerCase();
  if (!cleaned) {
    return null;
  }

  return cleaned.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '').replace(/^doi:\s*/i, '') || null;
}

function normalizeTextKey(input: unknown) {
  return cleanText(input).toLowerCase().replace(/\s+/g, ' ');
}

function extractPublishedYear(input: unknown) {
  const matched = cleanText(input).match(/^(\d{4})/);
  return matched ? matched[1] : null;
}

function normalizeStorageMode(input: unknown): StorageMode {
  return input === 'managed-copy' ? 'managed-copy' : 'linked-original';
}

function normalizeListLimit(input: unknown) {
  const parsed = Number.parseInt(String(input), 10);
  if (Number.isNaN(parsed)) {
    return defaultListLimit;
  }

  return Math.min(maxListLimit, Math.max(1, parsed));
}

function resolveHomePath(input: string, fallbackPath: string) {
  const trimmed = cleanText(input);
  if (!trimmed) {
    return fallbackPath;
  }

  if (trimmed === '~') {
    return os.homedir();
  }

  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }

  return path.resolve(trimmed);
}

function resolveManagedDirectory(
  knowledgeBaseSettings: Pick<KnowledgeBaseSettings, 'libraryDirectory'>,
  defaultManagedDirectory: string,
) {
  return resolveHomePath(knowledgeBaseSettings.libraryDirectory ?? '', defaultManagedDirectory);
}

async function computeFileFingerprint(filePath: string): Promise<FileFingerprint> {
  return await new Promise<FileFingerprint>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    let fileSize = 0;

    stream.on('data', (chunk) => {
      hash.update(chunk);
      fileSize += chunk.length;
    });
    stream.on('end', () => {
      resolve({
        fileSize,
        sha256: hash.digest('hex'),
      });
    });
    stream.on('error', reject);
  });
}

function runTransaction<T>(db: DatabaseSync, callback: () => T) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback cleanup failures.
    }
    throw error;
  }
}

async function deleteDocumentFiles(filePaths: readonly string[]) {
  for (const filePath of filePaths) {
    try {
      await fs.rm(filePath, { force: false });
    } catch (error) {
      const errorCode =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
      if (errorCode === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }
}

function resolveNextIngestStatus(currentStatus: unknown): LibraryIngestStatus {
  if (currentStatus === 'ready' || currentStatus === 'indexing' || currentStatus === 'queued') {
    return currentStatus;
  }

  return 'registered';
}

function mapDocumentSummary(row: DocumentSummaryRow): LibraryDocumentSummary {
  return {
    documentId: row.document_id,
    title: row.title,
    doi: row.doi,
    authors: parseAuthorsJson(row.authors_json),
    journalTitle: row.journal_title,
    publishedAt: row.published_at,
    sourceUrl: row.source_url,
    sourceId: row.source_id,
    ingestStatus: row.ingest_status,
    fileCount: Number(row.file_count ?? 0),
    latestFilePath: row.latest_file_path,
    latestDownloadedAt: row.latest_downloaded_at,
    latestJobType: row.latest_job_type as LibraryDocumentSummary['latestJobType'],
    latestJobStatus: row.latest_job_status as LibraryDocumentSummary['latestJobStatus'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const documentSummarySelectSql = `
  SELECT
    d.document_id,
    d.title,
    d.doi,
    d.authors_json,
    d.journal_title,
    d.published_at,
    d.source_url,
    d.source_id,
    d.ingest_status,
    d.created_at,
    d.updated_at,
    (
      SELECT COUNT(*)
      FROM document_files AS f
      WHERE f.document_id = d.document_id
    ) AS file_count,
    (
      SELECT f.file_path
      FROM document_files AS f
      WHERE f.document_id = d.document_id
      ORDER BY COALESCE(f.downloaded_at, f.created_at) DESC, f.updated_at DESC
      LIMIT 1
    ) AS latest_file_path,
    (
      SELECT COALESCE(f.downloaded_at, f.created_at)
      FROM document_files AS f
      WHERE f.document_id = d.document_id
      ORDER BY COALESCE(f.downloaded_at, f.created_at) DESC, f.updated_at DESC
      LIMIT 1
    ) AS latest_downloaded_at,
    (
      SELECT j.job_type
      FROM indexing_jobs AS j
      WHERE j.document_id = d.document_id
      ORDER BY j.created_at DESC, j.updated_at DESC
      LIMIT 1
    ) AS latest_job_type,
    (
      SELECT j.status
      FROM indexing_jobs AS j
      WHERE j.document_id = d.document_id
      ORDER BY j.created_at DESC, j.updated_at DESC
      LIMIT 1
    ) AS latest_job_status
  FROM documents AS d
`;

function ensureSchema(db: DatabaseSync) {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      document_id TEXT PRIMARY KEY,
      title TEXT,
      doi TEXT,
      doi_normalized TEXT,
      authors_json TEXT NOT NULL DEFAULT '[]',
      journal_title TEXT,
      published_at TEXT,
      published_year TEXT,
      source_url TEXT,
      source_id TEXT,
      language TEXT,
      title_key TEXT,
      first_author_key TEXT,
      ingest_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_doi_normalized
      ON documents(doi_normalized)
      WHERE doi_normalized IS NOT NULL AND doi_normalized != '';

    CREATE INDEX IF NOT EXISTS idx_documents_title_author_year
      ON documents(title_key, first_author_key, published_year);

    CREATE TABLE IF NOT EXISTS document_files (
      file_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      storage_mode TEXT NOT NULL,
      file_sha256 TEXT,
      file_size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT,
      downloaded_at TEXT,
      extractor_version TEXT,
      parse_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_files_path ON document_files(file_path);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_files_sha256
      ON document_files(file_sha256)
      WHERE file_sha256 IS NOT NULL AND file_sha256 != '';

    CREATE INDEX IF NOT EXISTS idx_document_files_document_id
      ON document_files(document_id);

    CREATE TABLE IF NOT EXISTS indexing_jobs (
      job_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      error_code TEXT,
      error_message TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
      FOREIGN KEY(file_id) REFERENCES document_files(file_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_indexing_jobs_document_id
      ON indexing_jobs(document_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_indexing_jobs_status
      ON indexing_jobs(status);
  `);
}

export function createLibraryStore(paths: LibraryPaths): LibraryStore {
  mkdirSync(path.dirname(paths.libraryDbFile), { recursive: true });

  const db = new DatabaseSync(paths.libraryDbFile);
  ensureSchema(db);

  const selectDocumentById = db.prepare(
    'SELECT * FROM documents WHERE document_id = ? LIMIT 1',
  );
  const selectDocumentByDoi = db.prepare(
    'SELECT document_id FROM documents WHERE doi_normalized = ? LIMIT 1',
  );
  const selectDocumentByTitleAuthorYear = db.prepare(
    'SELECT document_id FROM documents WHERE title_key = ? AND first_author_key = ? AND published_year = ? LIMIT 1',
  );
  const selectDocumentBySourceUrl = db.prepare(
    'SELECT document_id FROM documents WHERE source_url = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1',
  );
  const selectFileByPath = db.prepare(
    'SELECT file_id, document_id FROM document_files WHERE file_path = ? LIMIT 1',
  );
  const selectFileBySha = db.prepare(
    'SELECT file_id, document_id FROM document_files WHERE file_sha256 = ? LIMIT 1',
  );
  const selectFilePathsByDocumentId = db.prepare(`
    SELECT file_path
    FROM document_files
    WHERE document_id = ?
  `);
  const selectLatestFileForDocument = db.prepare(`
    SELECT file_id
    FROM document_files
    WHERE document_id = ?
    ORDER BY COALESCE(downloaded_at, created_at) DESC, updated_at DESC
    LIMIT 1
  `);
  const upsertDocument = db.prepare(`
    INSERT INTO documents (
      document_id,
      title,
      doi,
      doi_normalized,
      authors_json,
      journal_title,
      published_at,
      published_year,
      source_url,
      source_id,
      language,
      title_key,
      first_author_key,
      ingest_status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET
      title = excluded.title,
      doi = excluded.doi,
      doi_normalized = excluded.doi_normalized,
      authors_json = excluded.authors_json,
      journal_title = excluded.journal_title,
      published_at = excluded.published_at,
      published_year = excluded.published_year,
      source_url = excluded.source_url,
      source_id = excluded.source_id,
      title_key = excluded.title_key,
      first_author_key = excluded.first_author_key,
      ingest_status = excluded.ingest_status,
      updated_at = excluded.updated_at
  `);
  const insertFile = db.prepare(`
    INSERT INTO document_files (
      file_id,
      document_id,
      file_path,
      storage_mode,
      file_sha256,
      file_size,
      mime_type,
      downloaded_at,
      extractor_version,
      parse_status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateFile = db.prepare(`
    UPDATE document_files
    SET
      document_id = ?,
      file_path = ?,
      storage_mode = ?,
      file_sha256 = ?,
      file_size = ?,
      mime_type = ?,
      downloaded_at = ?,
      extractor_version = ?,
      parse_status = ?,
      updated_at = ?
    WHERE file_id = ?
  `);
  const insertJob = db.prepare(`
    INSERT INTO indexing_jobs (
      job_id,
      document_id,
      file_id,
      job_type,
      status,
      error_code,
      error_message,
      attempt_count,
      started_at,
      finished_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateDocumentStatus = db.prepare(`
    UPDATE documents
    SET ingest_status = ?, updated_at = ?
    WHERE document_id = ?
  `);
  const deleteDocumentById = db.prepare(`
    DELETE FROM documents
    WHERE document_id = ?
  `);
  const selectSummaryByDocumentId = db.prepare(`
    ${documentSummarySelectSql}
    WHERE d.document_id = ?
    LIMIT 1
  `);
  const listSummaryByUpdatedAt = db.prepare(`
    ${documentSummarySelectSql}
    ORDER BY d.updated_at DESC, d.created_at DESC
    LIMIT ?
  `);
  const countDocuments = db.prepare('SELECT COUNT(*) AS count FROM documents');
  const countFiles = db.prepare('SELECT COUNT(*) AS count FROM document_files');
  const countQueuedJobs = db.prepare(`
    SELECT COUNT(*) AS count
    FROM indexing_jobs
    WHERE status IN ('queued', 'running')
  `);

  function resolveDocumentMatch(
    absoluteFilePath: string,
    fingerprint: FileFingerprint,
    doiNormalized: string | null,
    titleKey: string,
    firstAuthorKey: string,
    publishedYear: string | null,
  ): DocumentMatch {
    const matchedByPath = selectFileByPath.get(absoluteFilePath) as FileRow | undefined;
    if (matchedByPath) {
      return {
        documentId: matchedByPath.document_id,
        fileId: matchedByPath.file_id,
        dedupeReason: 'file_path',
      };
    }

    const matchedByDoi = doiNormalized
      ? (selectDocumentByDoi.get(doiNormalized) as { document_id: string } | undefined)
      : undefined;
    const matchedBySha = fingerprint.sha256
      ? (selectFileBySha.get(fingerprint.sha256) as FileRow | undefined)
      : undefined;

    if (matchedByDoi) {
      return {
        documentId: matchedByDoi.document_id,
        fileId:
          matchedBySha && matchedBySha.document_id === matchedByDoi.document_id
            ? matchedBySha.file_id
            : null,
        dedupeReason: 'doi',
      };
    }

    if (matchedBySha) {
      return {
        documentId: matchedBySha.document_id,
        fileId: matchedBySha.file_id,
        dedupeReason: 'file_sha256',
      };
    }

    if (titleKey && firstAuthorKey && publishedYear) {
      const matchedByTitle = selectDocumentByTitleAuthorYear.get(
        titleKey,
        firstAuthorKey,
        publishedYear,
      ) as { document_id: string } | undefined;

      if (matchedByTitle) {
        return {
          documentId: matchedByTitle.document_id,
          fileId: null,
          dedupeReason: 'title_author_year',
        };
      }
    }

    return {
      documentId: null,
      fileId: null,
      dedupeReason: 'new',
    };
  }

  async function persistManagedCopy(
    sourceFilePath: string,
    documentId: string,
    sha256: string,
    knowledgeBaseSettings: Pick<KnowledgeBaseSettings, 'libraryDirectory'>,
  ) {
    const managedDirectory = resolveManagedDirectory(knowledgeBaseSettings, paths.libraryFilesDir);
    const fileExtension = path.extname(sourceFilePath) || '.pdf';
    const targetDirectory = path.join(managedDirectory, documentId);
    const targetFilePath = path.join(targetDirectory, `${sha256}${fileExtension}`);

    if (path.resolve(sourceFilePath) !== path.resolve(targetFilePath)) {
      await fs.mkdir(targetDirectory, { recursive: true });
      await fs.copyFile(sourceFilePath, targetFilePath);
    }

    return targetFilePath;
  }

  function resolveMetadataDocumentMatch(
    sourceUrl: string | null,
    doiNormalized: string | null,
    titleKey: string,
    firstAuthorKey: string,
    publishedYear: string | null,
  ) {
    const matchedBySourceUrl = sourceUrl
      ? (selectDocumentBySourceUrl.get(sourceUrl) as { document_id: string } | undefined)
      : undefined;
    if (matchedBySourceUrl) {
      return matchedBySourceUrl.document_id;
    }

    const matchedByDoi = doiNormalized
      ? (selectDocumentByDoi.get(doiNormalized) as { document_id: string } | undefined)
      : undefined;
    if (matchedByDoi) {
      return matchedByDoi.document_id;
    }

    if (titleKey && firstAuthorKey && publishedYear) {
      const matchedByTitle = selectDocumentByTitleAuthorYear.get(
        titleKey,
        firstAuthorKey,
        publishedYear,
      ) as { document_id: string } | undefined;
      if (matchedByTitle) {
        return matchedByTitle.document_id;
      }
    }

    return null;
  }

  return {
    dispose() {
      db.close();
    },

    async upsertLibraryDocumentMetadata(
      payload: UpsertLibraryDocumentMetadataPayload,
    ) {
      const requestedDocumentId = cleanText(payload.documentId);
      const normalizedTitle = cleanText(payload.articleTitle) || null;
      const normalizedAuthors = normalizeAuthors(payload.authors);
      const normalizedJournalTitle = cleanText(payload.journalTitle) || null;
      const normalizedPublishedAt = cleanText(payload.publishedAt) || null;
      const normalizedSourceUrl = cleanText(payload.sourceUrl) || null;
      const normalizedSourceId = cleanText(payload.sourceId) || null;
      const normalizedDoi = cleanText(payload.doi) || null;
      const doiNormalized = normalizeDoi(normalizedDoi);
      const titleKey = normalizeTextKey(normalizedTitle);
      const firstAuthorKey = normalizeTextKey(normalizedAuthors[0] ?? '');
      const publishedYear = extractPublishedYear(normalizedPublishedAt);
      const matchedDocumentId =
        requestedDocumentId ||
        resolveMetadataDocumentMatch(
          normalizedSourceUrl,
          doiNormalized,
          titleKey,
          firstAuthorKey,
          publishedYear,
        );
      const documentId = matchedDocumentId ?? randomUUID();

      runTransaction(db, () => {
        const currentTimestamp = nowIso();
        const existingDocument = matchedDocumentId
          ? (selectDocumentById.get(matchedDocumentId) as DocumentRow | undefined)
          : undefined;
        const nextDocumentTitle = normalizedTitle || existingDocument?.title || null;
        const nextAuthors =
          normalizedAuthors.length > 0
            ? normalizedAuthors
            : parseAuthorsJson(existingDocument?.authors_json);
        const nextJournalTitle =
          normalizedJournalTitle || existingDocument?.journal_title || null;
        const nextPublishedAt =
          normalizedPublishedAt || existingDocument?.published_at || null;
        const nextPublishedYear =
          extractPublishedYear(nextPublishedAt) || existingDocument?.published_year || null;
        const nextSourceUrl = normalizedSourceUrl || existingDocument?.source_url || null;
        const nextSourceId = normalizedSourceId || existingDocument?.source_id || null;
        const nextDoi = normalizedDoi || existingDocument?.doi || null;
        const nextDoiNormalized = normalizeDoi(nextDoi);
        const nextTitleKey = normalizeTextKey(nextDocumentTitle);
        const nextFirstAuthorKey = normalizeTextKey(nextAuthors[0] ?? '');
        const nextIngestStatus = resolveNextIngestStatus(existingDocument?.ingest_status);

        upsertDocument.run(
          documentId,
          nextDocumentTitle,
          nextDoi,
          nextDoiNormalized,
          JSON.stringify(nextAuthors),
          nextJournalTitle,
          nextPublishedAt,
          nextPublishedYear,
          nextSourceUrl,
          nextSourceId,
          null,
          nextTitleKey,
          nextFirstAuthorKey,
          nextIngestStatus,
          existingDocument ? existingDocument.created_at ?? currentTimestamp : currentTimestamp,
          currentTimestamp,
        );
      });

      const row = selectSummaryByDocumentId.get(documentId) as
        | DocumentSummaryRow
        | undefined;
      if (!row) {
        throw new Error(`Failed to upsert library metadata for document '${documentId}'.`);
      }

      return mapDocumentSummary(row);
    },

    async deleteLibraryDocument(payload: DeleteLibraryDocumentPayload) {
      const documentId = cleanText(payload.documentId);
      if (!documentId) {
        throw new Error('A document id is required to delete a library document.');
      }

      const existingDocument = selectDocumentById.get(documentId) as
        | DocumentRow
        | undefined;
      if (!existingDocument) {
        return false;
      }

      const fileRows = selectFilePathsByDocumentId.all(documentId) as DocumentFilePathRow[];
      await deleteDocumentFiles(fileRows.map((row) => row.file_path));

      return runTransaction(db, () => {
        deleteDocumentById.run(documentId);
        return true;
      });
    },

    async registerLibraryDocument(payload: IndexDownloadedPdfPayload) {
      const sourceFilePath = cleanText(payload.filePath);
      if (!sourceFilePath) {
        throw new Error('Library registration requires a file path.');
      }

      const absoluteSourcePath = path.resolve(sourceFilePath);
      await fs.stat(absoluteSourcePath);

      const fingerprint = await computeFileFingerprint(absoluteSourcePath);
      const normalizedTitle = cleanText(payload.articleTitle) || null;
      const normalizedAuthors = normalizeAuthors(payload.authors);
      const normalizedJournalTitle = cleanText(payload.journalTitle) || null;
      const normalizedPublishedAt = cleanText(payload.publishedAt) || null;
      const normalizedSourceUrl = cleanText(payload.sourceUrl) || null;
      const normalizedSourceId = cleanText(payload.sourceId) || null;
      const normalizedDoi = cleanText(payload.doi) || null;
      const doiNormalized = normalizeDoi(normalizedDoi);
      const titleKey = normalizeTextKey(normalizedTitle);
      const firstAuthorKey = normalizeTextKey(normalizedAuthors[0] ?? '');
      const publishedYear = extractPublishedYear(normalizedPublishedAt);
      const knowledgeBaseSettings: KnowledgeBaseSettings = {
        ...createDefaultKnowledgeBaseSettings(),
        enabled: true,
        autoIndexDownloadedPdf: true,
        libraryStorageMode: normalizeStorageMode((payload as { storageMode?: unknown }).storageMode),
        libraryDirectory: cleanText((payload as { libraryDirectory?: unknown }).libraryDirectory) || null,
        maxConcurrentIndexJobs: 1,
      };
      const match = resolveDocumentMatch(
        absoluteSourcePath,
        fingerprint,
        doiNormalized,
        titleKey,
        firstAuthorKey,
        publishedYear,
      );
      const documentId = match.documentId ?? randomUUID();
      const storageMode = knowledgeBaseSettings.libraryStorageMode;
      const registeredFilePath =
        storageMode === 'managed-copy'
          ? await persistManagedCopy(absoluteSourcePath, documentId, fingerprint.sha256, knowledgeBaseSettings)
          : absoluteSourcePath;
      const absoluteRegisteredFilePath = path.resolve(registeredFilePath);

      return runTransaction(db, () => {
        const currentTimestamp = nowIso();
        const existingDocument = match.documentId
          ? (selectDocumentById.get(match.documentId) as DocumentRow | undefined)
          : undefined;
        const nextDocumentTitle = normalizedTitle || existingDocument?.title || null;
        const nextAuthors =
          normalizedAuthors.length > 0
            ? normalizedAuthors
            : parseAuthorsJson(existingDocument?.authors_json);
        const nextJournalTitle = normalizedJournalTitle || existingDocument?.journal_title || null;
        const nextPublishedAt = normalizedPublishedAt || existingDocument?.published_at || null;
        const nextPublishedYear = extractPublishedYear(nextPublishedAt) || existingDocument?.published_year || null;
        const nextSourceUrl = normalizedSourceUrl || existingDocument?.source_url || null;
        const nextSourceId = normalizedSourceId || existingDocument?.source_id || null;
        const nextDoi = normalizedDoi || existingDocument?.doi || null;
        const nextDoiNormalized = normalizeDoi(nextDoi);
        const nextTitleKey = normalizeTextKey(nextDocumentTitle);
        const nextFirstAuthorKey = normalizeTextKey(nextAuthors[0] ?? '');
        const nextIngestStatus = resolveNextIngestStatus(existingDocument?.ingest_status);

        upsertDocument.run(
          documentId,
          nextDocumentTitle,
          nextDoi,
          nextDoiNormalized,
          JSON.stringify(nextAuthors),
          nextJournalTitle,
          nextPublishedAt,
          nextPublishedYear,
          nextSourceUrl,
          nextSourceId,
          null,
          nextTitleKey,
          nextFirstAuthorKey,
          nextIngestStatus,
          existingDocument ? existingDocument.created_at ?? currentTimestamp : currentTimestamp,
          currentTimestamp,
        );

        const matchedByManagedPath = selectFileByPath.get(absoluteRegisteredFilePath) as FileRow | undefined;
        const fileId = match.fileId ?? matchedByManagedPath?.file_id ?? randomUUID();

        if (match.fileId || matchedByManagedPath) {
          updateFile.run(
            documentId,
            absoluteRegisteredFilePath,
            storageMode,
            fingerprint.sha256,
            fingerprint.fileSize,
            pdfMimeType,
            currentTimestamp,
            registrationVersion,
            'pending',
            currentTimestamp,
            fileId,
          );
        } else {
          insertFile.run(
            fileId,
            documentId,
            absoluteRegisteredFilePath,
            storageMode,
            fingerprint.sha256,
            fingerprint.fileSize,
            pdfMimeType,
            currentTimestamp,
            registrationVersion,
            'pending',
            currentTimestamp,
            currentTimestamp,
          );
        }

        const jobId = randomUUID();
        insertJob.run(
          jobId,
          documentId,
          fileId,
          'register',
          'completed',
          null,
          null,
          1,
          currentTimestamp,
          currentTimestamp,
          currentTimestamp,
          currentTimestamp,
        );
        updateDocumentStatus.run(nextIngestStatus, currentTimestamp, documentId);

        return {
          documentId,
          fileId,
          jobId,
          dedupeReason: match.dedupeReason,
          storageMode,
          ingestStatus: nextIngestStatus,
          filePath: absoluteRegisteredFilePath,
        };
      });
    },

    async getLibraryDocumentStatus(payload: LibraryDocumentStatusPayload) {
      const documentId = cleanText(payload.documentId);
      const filePath = cleanText(payload.filePath);
      const doiNormalized = normalizeDoi(payload.doi);
      const sourceUrl = cleanText(payload.sourceUrl);

      let resolvedDocumentId = documentId || '';
      if (!resolvedDocumentId && filePath) {
        const matchedFile = selectFileByPath.get(path.resolve(filePath)) as FileRow | undefined;
        resolvedDocumentId = matchedFile?.document_id ?? '';
      }
      if (!resolvedDocumentId && doiNormalized) {
        const matchedDocument = selectDocumentByDoi.get(doiNormalized) as { document_id: string } | undefined;
        resolvedDocumentId = matchedDocument?.document_id ?? '';
      }
      if (!resolvedDocumentId && sourceUrl) {
        const matchedDocument = db.prepare(`
          SELECT document_id
          FROM documents
          WHERE source_url = ?
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        `).get(sourceUrl) as { document_id: string } | undefined;
        resolvedDocumentId = matchedDocument?.document_id ?? '';
      }

      if (!resolvedDocumentId) {
        return null;
      }

      const row = selectSummaryByDocumentId.get(resolvedDocumentId) as DocumentSummaryRow | undefined;
      return row ? mapDocumentSummary(row) : null;
    },

    async listLibraryDocuments(payload = {}) {
      const limit = normalizeListLimit(payload.limit);
      const totalCountRow = countDocuments.get() as CountRow | undefined;
      const fileCountRow = countFiles.get() as CountRow | undefined;
      const queuedJobCountRow = countQueuedJobs.get() as CountRow | undefined;
      const rows = listSummaryByUpdatedAt.all(limit) as DocumentSummaryRow[];

      return {
        items: rows.map(mapDocumentSummary),
        totalCount: Number(totalCountRow?.count ?? 0),
        fileCount: Number(fileCountRow?.count ?? 0),
        queuedJobCount: Number(queuedJobCountRow?.count ?? 0),
        libraryDbFile: paths.libraryDbFile,
        defaultManagedDirectory: paths.libraryFilesDir,
        ragCacheDir: paths.ragCacheDir,
      } satisfies LibraryDocumentsResult;
    },

    async reindexLibraryDocument(payload: { documentId?: string }) {
      const documentId = cleanText(payload.documentId);
      if (!documentId) {
        throw new Error('A document id is required to enqueue reindex.');
      }

      const latestFile = selectLatestFileForDocument.get(documentId) as { file_id: string } | undefined;
      if (!latestFile?.file_id) {
        throw new Error(`No registered file was found for document '${documentId}'.`);
      }

      const currentTimestamp = nowIso();
      const jobId = randomUUID();

      runTransaction(db, () => {
        insertJob.run(
          jobId,
          documentId,
          latestFile.file_id,
          'reindex',
          'queued',
          null,
          null,
          0,
          null,
          null,
          currentTimestamp,
          currentTimestamp,
        );
        updateDocumentStatus.run('queued', currentTimestamp, documentId);
      });

      return {
        jobId,
        documentId,
        status: 'queued',
        jobType: 'reindex',
      } satisfies ReindexLibraryDocumentResult;
    },
  };
}
