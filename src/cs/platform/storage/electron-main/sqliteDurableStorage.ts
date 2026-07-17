/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Disposable } from 'cs/base/common/lifecycle';
import type {
	DurableStorageError,
	DurableStorageOperation,
	DurableStorageResult,
	IDurableStorageAuthority,
	IDurableStorageAppend,
	IDurableStorageBytes,
	IDurableStorageDurableLength,
	IDurableStorageLimits,
	IDurableStorageManifest,
	IDurableStorageObjectDescriptor,
	IDurableStorageRange,
	IDurableStorageService,
	IDurableStorageTemporaryObject,
	IDurableStorageTemporaryObjectDescriptor,
	IDurableStorageWriter,
} from 'cs/platform/storage/common/durableStorage';

const sqliteApplicationId = 0x43445331;
const sqliteSchemaVersion = 1;
const maximumWriterGeneration = (1n << 63n) - 1n;
const opaqueTokenPattern = /^[0-9a-f]{64}$/;
const writerGenerationPattern = /^(?:0|[1-9][0-9]*)$/;

export const defaultSQLiteDurableStorageLimits: IDurableStorageLimits =
	Object.freeze({
		maximumResourceBytes: 4 * 1024,
		maximumObjectKeyBytes: 4 * 1024,
		maximumAppendBytes: 16 * 1024 * 1024,
		maximumPendingBytes: 64 * 1024 * 1024,
		maximumLogBytes: 1024 * 1024 * 1024 * 1024,
		maximumReadBytes: 4 * 1024 * 1024,
		maximumTemporaryObjectBytes: 1024 * 1024 * 1024,
		maximumManifestBytes: 16 * 1024 * 1024,
		maximumTemporaryObjectListEntries: 1024,
	});

export interface ISQLiteDurableStorageOptions {
	readonly limits?: IDurableStorageLimits;
	readonly busyTimeout?: number;
	readonly maximumDatabasePages?: number;
}

type ResourceAuthorityRow = {
	writer_generation: string;
	writer_fence: string;
};

type ResourceStateRow = ResourceAuthorityRow & {
	log_length: number;
	manifest_generation: string | null;
	manifest_bytes: Uint8Array | null;
};

type DurableLengthRow = {
	durable_length: number;
};

type ChunkDescriptorRow = {
	byte_offset: number;
	byte_length: number;
};

type ChunkBytesRow = {
	byte_offset: number;
	bytes: Uint8Array;
};

type TemporaryObjectRow = {
	temporary_object_id: string;
	durable_length: number;
};

type ObjectRow = {
	object_generation: string;
	durable_length: number;
};

type PragmaNumberRow = {
	application_id?: number;
	user_version?: number;
	synchronous?: number;
};

type PragmaJournalModeRow = {
	journal_mode: string;
};

type SchemaTableRow = {
	name: string;
	sql: string | null;
};

type SqliteError = Error & {
	code?: string;
	errcode?: number;
};

type PendingBytes = {
	readonly baseLength: number;
	readonly chunks: Uint8Array[];
	byteLength: number;
};

type ChunkCollection =
	| {
		readonly kind: 'log';
		readonly resource: string;
	}
	| {
		readonly kind: 'temporary-object';
		readonly resource: string;
		readonly id: string;
	}
	| {
		readonly kind: 'object';
		readonly resource: string;
		readonly key: string;
	};

type WritableChunkCollection = Exclude<
	ChunkCollection,
	{ readonly kind: 'object' }
>;

interface ISQLiteDurableStorageWriterIdentity {
	readonly resource: string;
	readonly authority: IDurableStorageAuthority;
	readonly released: boolean;
}

interface ISQLiteDurableStorageOwner {
	readonly limits: IDurableStorageLimits;
	readonly disposed: boolean;

	runRead<T>(
		writer: ISQLiteDurableStorageWriterIdentity,
		operation: DurableStorageOperation,
		callback: (database: DatabaseSync) => T,
	): DurableStorageResult<T>;
	runWrite<T>(
		writer: ISQLiteDurableStorageWriterIdentity,
		operation: DurableStorageOperation,
		callback: (database: DatabaseSync) => T,
	): DurableStorageResult<T>;
	releaseWriter(writer: SQLiteDurableStorageWriter): void;
}

class DurableStorageFailure extends Error {
	constructor(readonly storageError: DurableStorageError) {
		super(storageError.code);
	}
}

function succeed<T>(value: T): DurableStorageResult<T> {
	return { type: 'success', value };
}

function fail<T>(error: DurableStorageError): DurableStorageResult<T> {
	return { type: 'error', error };
}

function throwStorageError(error: DurableStorageError): never {
	throw new DurableStorageFailure(error);
}

function randomOpaqueToken(): string {
	return randomBytes(32).toString('hex');
}

function isWellFormedString(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) {
				return false;
			}
			index++;
		} else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			return false;
		}
	}
	return true;
}

function validateOpaqueString(
	operation: DurableStorageOperation,
	value: string,
	kind: 'resource' | 'object-key',
	maximumBytes: number,
): DurableStorageResult<void> {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.includes('\0') ||
		!isWellFormedString(value)
	) {
		return fail({
			code: 'invalid-request',
			operation,
			reason: kind === 'resource' ? 'invalid-resource' : 'invalid-object-key',
		});
	}
	const byteLength = Buffer.byteLength(value, 'utf8');
	if (byteLength > maximumBytes) {
		return fail({
			code: 'resource-limit-exceeded',
			operation,
			limit: kind === 'resource' ? 'resource-bytes' : 'object-key-bytes',
			maximum: maximumBytes,
			actual: byteLength,
		});
	}
	return succeed(undefined);
}

function validateTemporaryObjectId(
	operation: DurableStorageOperation,
	id: string,
): DurableStorageResult<void> {
	if (typeof id !== 'string' || !opaqueTokenPattern.test(id)) {
		return fail({
			code: 'invalid-request',
			operation,
			reason: 'invalid-temporary-object-id',
		});
	}
	return succeed(undefined);
}

function validateGeneration(
	operation: DurableStorageOperation,
	generation: string | null,
): DurableStorageResult<void> {
	if (generation !== null && !opaqueTokenPattern.test(generation)) {
		return fail({
			code: 'invalid-request',
			operation,
			reason: 'invalid-generation',
		});
	}
	return succeed(undefined);
}

function validateRequiredGeneration(
	operation: DurableStorageOperation,
	generation: unknown,
): DurableStorageResult<void> {
	if (typeof generation !== 'string' || !opaqueTokenPattern.test(generation)) {
		return fail({
			code: 'invalid-request',
			operation,
			reason: 'invalid-generation',
		});
	}
	return succeed(undefined);
}

function validateLength(
	operation: DurableStorageOperation,
	length: number,
): DurableStorageResult<void> {
	if (!Number.isSafeInteger(length) || length < 0) {
		return fail({
			code: 'invalid-request',
			operation,
			reason: 'invalid-length',
		});
	}
	return succeed(undefined);
}

function validateRange(
	operation: DurableStorageOperation,
	range: IDurableStorageRange,
	maximumReadBytes: number,
): DurableStorageResult<void> {
	if (
		typeof range !== 'object' ||
		range === null ||
		!Number.isSafeInteger(range.offset) ||
		range.offset < 0 ||
		!Number.isSafeInteger(range.length) ||
		range.length < 0 ||
		!Number.isSafeInteger(range.offset + range.length)
	) {
		return fail({
			code: 'invalid-request',
			operation,
			reason: 'invalid-range',
		});
	}
	if (range.length > maximumReadBytes) {
		return fail({
			code: 'resource-limit-exceeded',
			operation,
			limit: 'read-bytes',
			maximum: maximumReadBytes,
			actual: range.length,
		});
	}
	return succeed(undefined);
}

function copyInputBytes(
	operation: DurableStorageOperation,
	value: Uint8Array,
	maximumBytes: number,
	limit: 'append-bytes' | 'manifest-bytes',
): DurableStorageResult<Uint8Array> {
	try {
		if (
			!(value instanceof Uint8Array) ||
			value.buffer instanceof SharedArrayBuffer
		) {
			return fail({
				code: 'invalid-request',
				operation,
				reason: 'invalid-bytes',
			});
		}
		if (value.byteLength > maximumBytes) {
			return fail({
				code: 'resource-limit-exceeded',
				operation,
				limit,
				maximum: maximumBytes,
				actual: value.byteLength,
			});
		}
		return succeed(Uint8Array.from(value));
	} catch {
		return fail({
			code: 'invalid-request',
			operation,
			reason: 'invalid-bytes',
		});
	}
}

function validateLimits(limits: IDurableStorageLimits): boolean {
	return Object.values(limits).every(
		value => Number.isSafeInteger(value) && value > 0,
	);
}

function mapStorageError(
	operation: DurableStorageOperation,
	error: unknown,
): DurableStorageError {
	if (error instanceof DurableStorageFailure) {
		return error.storageError;
	}
	if (error instanceof Error) {
		const sqliteError = error as SqliteError;
		const baseSqliteCode =
			typeof sqliteError.errcode === 'number'
				? sqliteError.errcode & 0xff
				: undefined;
		if (
			sqliteError.code === 'EACCES' ||
			sqliteError.code === 'EPERM' ||
			sqliteError.code === 'EROFS' ||
			baseSqliteCode === 3 ||
			baseSqliteCode === 8
		) {
			return { code: 'permission-denied', operation };
		}
		if (
			sqliteError.code === 'ENOSPC' ||
			sqliteError.code === 'EDQUOT' ||
			baseSqliteCode === 13
		) {
			return { code: 'out-of-space', operation };
		}
		if (
			baseSqliteCode === 11 ||
			baseSqliteCode === 26
		) {
			return { code: 'corruption', operation, subject: 'backend' };
		}
	}
	return { code: 'io', operation };
}

function rollback(database: DatabaseSync): void {
	try {
		database.exec('ROLLBACK');
	} catch {
		return;
	}
}

function runDatabaseTransaction<T>(
	database: DatabaseSync,
	mode: 'read' | 'write',
	callback: () => T,
): T {
	database.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN');
	try {
		const result = callback();
		database.exec('COMMIT');
		return result;
	} catch (error) {
		rollback(database);
		throw error;
	}
}

function readPragmaNumber(
	database: DatabaseSync,
	pragma: 'application_id' | 'user_version' | 'synchronous',
): number {
	const row = database.prepare(`PRAGMA ${pragma}`).get() as
		| PragmaNumberRow
		| undefined;
	const value = row?.[pragma];
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
		throwStorageError({
			code: 'corruption',
			operation: 'open',
			subject: 'schema',
		});
	}
	return value;
}

const schemaSql = `
	CREATE TABLE DurableResource (
		resource TEXT PRIMARY KEY,
		writer_generation TEXT NOT NULL,
		writer_fence TEXT NOT NULL,
		log_length INTEGER NOT NULL CHECK(log_length >= 0),
		manifest_generation TEXT,
		manifest_bytes BLOB,
		CHECK(
			(manifest_generation IS NULL AND manifest_bytes IS NULL) OR
			(manifest_generation IS NOT NULL AND manifest_bytes IS NOT NULL)
		)
	) STRICT;

	CREATE TABLE DurableLogChunk (
		resource TEXT NOT NULL,
		byte_offset INTEGER NOT NULL CHECK(byte_offset >= 0),
		bytes BLOB NOT NULL CHECK(length(bytes) > 0),
		PRIMARY KEY(resource, byte_offset),
		FOREIGN KEY(resource) REFERENCES DurableResource(resource) ON DELETE CASCADE
	) STRICT;

	CREATE TABLE DurableTemporaryObject (
		resource TEXT NOT NULL,
		temporary_object_id TEXT NOT NULL,
		durable_length INTEGER NOT NULL CHECK(durable_length >= 0),
		PRIMARY KEY(resource, temporary_object_id),
		FOREIGN KEY(resource) REFERENCES DurableResource(resource) ON DELETE CASCADE
	) STRICT;

	CREATE TABLE DurableTemporaryObjectChunk (
		resource TEXT NOT NULL,
		temporary_object_id TEXT NOT NULL,
		byte_offset INTEGER NOT NULL CHECK(byte_offset >= 0),
		bytes BLOB NOT NULL CHECK(length(bytes) > 0),
		PRIMARY KEY(resource, temporary_object_id, byte_offset),
		FOREIGN KEY(resource, temporary_object_id)
			REFERENCES DurableTemporaryObject(resource, temporary_object_id)
			ON DELETE CASCADE
	) STRICT;

	CREATE TABLE DurableObject (
		resource TEXT NOT NULL,
		object_key TEXT NOT NULL,
		object_generation TEXT NOT NULL,
		durable_length INTEGER NOT NULL CHECK(durable_length >= 0),
		PRIMARY KEY(resource, object_key),
		FOREIGN KEY(resource) REFERENCES DurableResource(resource) ON DELETE CASCADE
	) STRICT;

	CREATE TABLE DurableObjectChunk (
		resource TEXT NOT NULL,
		object_key TEXT NOT NULL,
		byte_offset INTEGER NOT NULL CHECK(byte_offset >= 0),
		bytes BLOB NOT NULL CHECK(length(bytes) > 0),
		PRIMARY KEY(resource, object_key, byte_offset),
		FOREIGN KEY(resource, object_key)
			REFERENCES DurableObject(resource, object_key)
			ON DELETE CASCADE
	) STRICT;
`;

function normalizeSchemaDefinition(value: string): string {
	return value
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/;$/, '');
}

function readExpectedSchemaDefinitions(
	value: string,
): ReadonlyMap<string, string> {
	const definitions = new Map<string, string>();
	const pattern =
		/CREATE TABLE\s+([A-Za-z][A-Za-z0-9_]*)\s*\([\s\S]*?\n\t\) STRICT;/g;
	for (const match of value.matchAll(pattern)) {
		const name = match[1];
		const definition = match[0];
		if (name === undefined || definition === undefined) {
			continue;
		}
		definitions.set(name, normalizeSchemaDefinition(definition));
	}
	return definitions;
}

const expectedSchemaDefinitions = readExpectedSchemaDefinitions(schemaSql);
const expectedSchemaTables = Object.freeze(
	[...expectedSchemaDefinitions.keys()].sort(),
);

function initializeOrValidateSchema(database: DatabaseSync): void {
	const applicationId = readPragmaNumber(database, 'application_id');
	const userVersion = readPragmaNumber(database, 'user_version');
	const tableRows = (
		database
			.prepare(
				`SELECT name, sql
				 FROM sqlite_schema
				 WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
				 ORDER BY name`,
			)
			.all() as SchemaTableRow[]
	);
	const tables = tableRows.map(row => row.name);

	if (applicationId === 0 && userVersion === 0 && tables.length === 0) {
		runDatabaseTransaction(database, 'write', () => {
			database.exec(schemaSql);
			database.exec(`PRAGMA application_id = ${sqliteApplicationId}`);
			database.exec(`PRAGMA user_version = ${sqliteSchemaVersion}`);
		});
		return;
	}

	if (
		applicationId !== sqliteApplicationId ||
		userVersion !== sqliteSchemaVersion
	) {
		throwStorageError({
			code: 'unsupported',
			operation: 'open',
			feature: 'storage-format-version',
		});
	}

	if (
		expectedSchemaDefinitions.size !== 6 ||
		tables.length !== expectedSchemaTables.length ||
		tables.some((table, index) => table !== expectedSchemaTables[index]) ||
		tableRows.some(row =>
			typeof row.sql !== 'string' ||
			expectedSchemaDefinitions.get(row.name) !==
				normalizeSchemaDefinition(row.sql)
		)
	) {
		throwStorageError({
			code: 'corruption',
			operation: 'open',
			subject: 'schema',
		});
	}
}

function openDatabase(
	databasePath: string,
	options: ISQLiteDurableStorageOptions,
): DatabaseSync {
	mkdirSync(dirname(databasePath), { recursive: true });
	const database = new DatabaseSync(databasePath, {
		timeout: options.busyTimeout ?? 5000,
		enableForeignKeyConstraints: true,
		enableDoubleQuotedStringLiterals: false,
		allowExtension: false,
	});
	try {
		const journalMode = database
			.prepare('PRAGMA journal_mode = WAL')
			.get() as PragmaJournalModeRow | undefined;
		if (journalMode?.journal_mode.toLowerCase() !== 'wal') {
			throwStorageError({
				code: 'unsupported',
				operation: 'open',
				feature: 'durable-append-log',
			});
		}
		database.exec('PRAGMA synchronous = FULL');
		if (readPragmaNumber(database, 'synchronous') !== 2) {
			throwStorageError({
				code: 'unsupported',
				operation: 'open',
				feature: 'full-sync',
			});
		}
		database.exec('PRAGMA foreign_keys = ON');
		initializeOrValidateSchema(database);
		if (options.maximumDatabasePages !== undefined) {
			database
				.prepare(
					`PRAGMA max_page_count = ${options.maximumDatabasePages}`,
				)
				.get();
		}
		return database;
	} catch (error) {
		database.close();
		throw error;
	}
}

function collectionSubject(
	collection: ChunkCollection,
): 'log' | 'temporary-object' | 'object' {
	return collection.kind;
}

function readChunkDescriptors(
	database: DatabaseSync,
	collection: ChunkCollection,
): ChunkDescriptorRow[] {
	switch (collection.kind) {
		case 'log':
			return database
				.prepare(
					`SELECT byte_offset, length(bytes) AS byte_length
					 FROM DurableLogChunk
					 WHERE resource = ?
					 ORDER BY byte_offset`,
				)
				.all(collection.resource) as ChunkDescriptorRow[];
		case 'temporary-object':
			return database
				.prepare(
					`SELECT byte_offset, length(bytes) AS byte_length
					 FROM DurableTemporaryObjectChunk
					 WHERE resource = ? AND temporary_object_id = ?
					 ORDER BY byte_offset`,
				)
				.all(collection.resource, collection.id) as ChunkDescriptorRow[];
		case 'object':
			return database
				.prepare(
					`SELECT byte_offset, length(bytes) AS byte_length
					 FROM DurableObjectChunk
					 WHERE resource = ? AND object_key = ?
					 ORDER BY byte_offset`,
				)
				.all(collection.resource, collection.key) as ChunkDescriptorRow[];
	}
}

function validateChunkCollection(
	database: DatabaseSync,
	operation: DurableStorageOperation,
	collection: ChunkCollection,
	declaredLength: number,
): void {
	if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
		throwStorageError({
			code: 'corruption',
			operation,
			subject: collectionSubject(collection),
		});
	}
	let expectedOffset = 0;
	for (const row of readChunkDescriptors(database, collection)) {
		if (
			!Number.isSafeInteger(row.byte_offset) ||
			row.byte_offset !== expectedOffset ||
			!Number.isSafeInteger(row.byte_length) ||
			row.byte_length <= 0 ||
			!Number.isSafeInteger(expectedOffset + row.byte_length)
		) {
			throwStorageError({
				code: 'corruption',
				operation,
				subject: collectionSubject(collection),
			});
		}
		expectedOffset += row.byte_length;
	}
	if (expectedOffset !== declaredLength) {
		throwStorageError({
			code: 'corruption',
			operation,
			subject: collectionSubject(collection),
		});
	}
}

function readChunkBytes(
	database: DatabaseSync,
	collection: ChunkCollection,
	range: IDurableStorageRange,
): ChunkBytesRow[] {
	const end = range.offset + range.length;
	switch (collection.kind) {
		case 'log':
			return database
				.prepare(
					`SELECT byte_offset, bytes
					 FROM DurableLogChunk
					 WHERE resource = ?
					   AND byte_offset < ?
					   AND byte_offset + length(bytes) > ?
					 ORDER BY byte_offset`,
				)
				.all(collection.resource, end, range.offset) as ChunkBytesRow[];
		case 'temporary-object':
			return database
				.prepare(
					`SELECT byte_offset, bytes
					 FROM DurableTemporaryObjectChunk
					 WHERE resource = ? AND temporary_object_id = ?
					   AND byte_offset < ?
					   AND byte_offset + length(bytes) > ?
					 ORDER BY byte_offset`,
				)
				.all(
					collection.resource,
					collection.id,
					end,
					range.offset,
				) as ChunkBytesRow[];
		case 'object':
			return database
				.prepare(
					`SELECT byte_offset, bytes
					 FROM DurableObjectChunk
					 WHERE resource = ? AND object_key = ?
					   AND byte_offset < ?
					   AND byte_offset + length(bytes) > ?
					 ORDER BY byte_offset`,
				)
				.all(
					collection.resource,
					collection.key,
					end,
					range.offset,
				) as ChunkBytesRow[];
	}
}

function readCollectionRange(
	database: DatabaseSync,
	operation: DurableStorageOperation,
	collection: ChunkCollection,
	declaredLength: number,
	range: IDurableStorageRange,
): IDurableStorageBytes {
	validateChunkCollection(
		database,
		operation,
		collection,
		declaredLength,
	);
	const requestedEnd = range.offset + range.length;
	if (requestedEnd > declaredLength) {
		throwStorageError({
			code: 'length-conflict',
			operation,
			expectedLength: requestedEnd,
			actualLength: declaredLength,
		});
	}
	if (range.length === 0) {
		return { bytes: new Uint8Array() };
	}

	const bytes = new Uint8Array(range.length);
	let copiedLength = 0;
	for (const row of readChunkBytes(database, collection, range)) {
		if (!(row.bytes instanceof Uint8Array)) {
			throwStorageError({
				code: 'corruption',
				operation,
				subject: collectionSubject(collection),
			});
		}
		const sourceStart = Math.max(0, range.offset - row.byte_offset);
		const sourceEnd = Math.min(
			row.bytes.byteLength,
			requestedEnd - row.byte_offset,
		);
		const destinationStart =
			Math.max(row.byte_offset, range.offset) - range.offset;
		bytes.set(row.bytes.subarray(sourceStart, sourceEnd), destinationStart);
		copiedLength += sourceEnd - sourceStart;
	}
	if (copiedLength !== range.length) {
		throwStorageError({
			code: 'corruption',
			operation,
			subject: collectionSubject(collection),
		});
	}
	return { bytes };
}

function insertPendingChunks(
	database: DatabaseSync,
	collection: WritableChunkCollection,
	pending: PendingBytes,
): number {
	let byteOffset = pending.baseLength;
	switch (collection.kind) {
		case 'log': {
			const insert = database.prepare(
				`INSERT INTO DurableLogChunk(resource, byte_offset, bytes)
				 VALUES (?, ?, ?)`,
			);
			for (const bytes of pending.chunks) {
				insert.run(collection.resource, byteOffset, bytes);
				byteOffset += bytes.byteLength;
			}
			break;
		}
		case 'temporary-object': {
			const insert = database.prepare(
				`INSERT INTO DurableTemporaryObjectChunk(
					resource,
					temporary_object_id,
					byte_offset,
					bytes
				 ) VALUES (?, ?, ?, ?)`,
			);
			for (const bytes of pending.chunks) {
				insert.run(
					collection.resource,
					collection.id,
					byteOffset,
					bytes,
				);
				byteOffset += bytes.byteLength;
			}
			break;
		}
	}
	return byteOffset;
}

function readTemporaryObjectLength(
	database: DatabaseSync,
	operation: DurableStorageOperation,
	resource: string,
	id: string,
): number {
	const row = database
		.prepare(
			`SELECT durable_length
			 FROM DurableTemporaryObject
			 WHERE resource = ? AND temporary_object_id = ?`,
		)
		.get(resource, id) as DurableLengthRow | undefined;
	if (!row) {
		throwStorageError({
			code: 'not-found',
			operation,
			subject: 'temporary-object',
		});
	}
	if (
		!Number.isSafeInteger(row.durable_length) ||
		row.durable_length < 0
	) {
		throwStorageError({
			code: 'corruption',
			operation,
			subject: 'temporary-object',
		});
	}
	return row.durable_length;
}

function readObject(
	database: DatabaseSync,
	operation: DurableStorageOperation,
	resource: string,
	key: string,
	expectedGeneration: string,
): ObjectRow {
	const row = database
		.prepare(
			`SELECT object_generation, durable_length
			 FROM DurableObject
			 WHERE resource = ? AND object_key = ?`,
		)
		.get(resource, key) as ObjectRow | undefined;
	if (!row) {
		throwStorageError({
			code: 'not-found',
			operation,
			subject: 'object',
		});
	}
	if (
		!opaqueTokenPattern.test(row.object_generation) ||
		!Number.isSafeInteger(row.durable_length) ||
		row.durable_length < 0
	) {
		throwStorageError({
			code: 'corruption',
			operation,
			subject: 'object',
		});
	}
	if (row.object_generation !== expectedGeneration) {
		throwStorageError({
			code: 'generation-conflict',
			operation,
			expectedGeneration,
			actualGeneration: row.object_generation,
		});
	}
	return row;
}

class SQLiteDurableStorage
	extends Disposable
	implements IDurableStorageService, ISQLiteDurableStorageOwner
{
	readonly _serviceBrand: undefined = undefined;
	readonly limits: IDurableStorageLimits;
	private readonly liveWriters = new Map<
		string,
		SQLiteDurableStorageWriter
	>();
	private closed = false;

	constructor(
		private readonly database: DatabaseSync,
		limits: IDurableStorageLimits,
	) {
		super();
		this.limits = Object.freeze({ ...limits });
	}

	get disposed(): boolean {
		return this.closed;
	}

	async openWriter(
		resource: string,
	): Promise<DurableStorageResult<IDurableStorageWriter>> {
		const operation = 'open-writer';
		const validation = validateOpaqueString(
			operation,
			resource,
			'resource',
			this.limits.maximumResourceBytes,
		);
		if (validation.type === 'error') {
			return validation;
		}
		if (this.closed) {
			return fail({ code: 'disposed', operation });
		}
		const liveWriter = this.liveWriters.get(resource);
		if (liveWriter) {
			return fail({
				code: 'generation-conflict',
				operation,
				expectedGeneration: null,
				actualGeneration: liveWriter.authority.generation,
			});
		}

		const authorityResult = this.runUnfencedWrite(
			operation,
			database => {
				const current = database
					.prepare(
						`SELECT writer_generation, writer_fence
						 FROM DurableResource
						 WHERE resource = ?`,
					)
					.get(resource) as ResourceAuthorityRow | undefined;
				const generation = current
					? this.nextWriterGeneration(operation, current)
					: '1';
				const fenceToken = randomOpaqueToken();
				if (current) {
					database
						.prepare(
							`UPDATE DurableResource
							 SET writer_generation = ?, writer_fence = ?
							 WHERE resource = ?`,
						)
						.run(generation, fenceToken, resource);
				} else {
					database
						.prepare(
							`INSERT INTO DurableResource(
								resource,
								writer_generation,
								writer_fence,
								log_length,
								manifest_generation,
								manifest_bytes
							 ) VALUES (?, ?, ?, 0, NULL, NULL)`,
						)
						.run(resource, generation, fenceToken);
				}
				return { generation, fenceToken };
			},
		);
		if (authorityResult.type === 'error') {
			return authorityResult;
		}

		const writer = new SQLiteDurableStorageWriter(
			this,
			resource,
			Object.freeze(authorityResult.value),
		);
		this.liveWriters.set(resource, writer);
		return succeed(writer);
	}

	runRead<T>(
		writer: ISQLiteDurableStorageWriterIdentity,
		operation: DurableStorageOperation,
		callback: (database: DatabaseSync) => T,
	): DurableStorageResult<T> {
		if (this.closed || writer.released) {
			return fail({ code: 'disposed', operation });
		}
		try {
			return succeed(
				runDatabaseTransaction(this.database, 'read', () => {
					this.assertFence(this.database, writer, operation);
					return callback(this.database);
				}),
			);
		} catch (error) {
			return fail(mapStorageError(operation, error));
		}
	}

	runWrite<T>(
		writer: ISQLiteDurableStorageWriterIdentity,
		operation: DurableStorageOperation,
		callback: (database: DatabaseSync) => T,
	): DurableStorageResult<T> {
		if (this.closed || writer.released) {
			return fail({ code: 'disposed', operation });
		}
		try {
			return succeed(
				runDatabaseTransaction(this.database, 'write', () => {
					this.assertFence(this.database, writer, operation);
					return callback(this.database);
				}),
			);
		} catch (error) {
			return fail(mapStorageError(operation, error));
		}
	}

	releaseWriter(writer: SQLiteDurableStorageWriter): void {
		if (this.liveWriters.get(writer.resource) === writer) {
			this.liveWriters.delete(writer.resource);
		}
	}

	override dispose(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		for (const writer of [...this.liveWriters.values()]) {
			writer.release();
		}
		try {
			this.database.close();
		} finally {
			super.dispose();
		}
	}

	private runUnfencedWrite<T>(
		operation: DurableStorageOperation,
		callback: (database: DatabaseSync) => T,
	): DurableStorageResult<T> {
		try {
			return succeed(
				runDatabaseTransaction(this.database, 'write', () =>
					callback(this.database),
				),
			);
		} catch (error) {
			return fail(mapStorageError(operation, error));
		}
	}

	private nextWriterGeneration(
		operation: DurableStorageOperation,
		current: ResourceAuthorityRow,
	): string {
		if (
			!writerGenerationPattern.test(current.writer_generation) ||
			!opaqueTokenPattern.test(current.writer_fence)
		) {
			throwStorageError({
				code: 'corruption',
				operation,
				subject: 'writer',
			});
		}
		const generation = BigInt(current.writer_generation);
		if (generation >= maximumWriterGeneration) {
			throwStorageError({
				code: 'unsupported',
				operation,
				feature: 'writer-generation-exhausted',
			});
		}
		return (generation + 1n).toString(10);
	}

	private assertFence(
		database: DatabaseSync,
		writer: ISQLiteDurableStorageWriterIdentity,
		operation: DurableStorageOperation,
	): void {
		const current = database
			.prepare(
				`SELECT writer_generation, writer_fence
				 FROM DurableResource
				 WHERE resource = ?`,
			)
			.get(writer.resource) as ResourceAuthorityRow | undefined;
		if (
			!current ||
			!writerGenerationPattern.test(current.writer_generation) ||
			!opaqueTokenPattern.test(current.writer_fence)
		) {
			throwStorageError({
				code: 'corruption',
				operation,
				subject: 'writer',
			});
		}
		if (
			current.writer_generation !== writer.authority.generation ||
			current.writer_fence !== writer.authority.fenceToken
		) {
			throwStorageError({
				code: 'fence-lost',
				operation,
				expectedGeneration: writer.authority.generation,
				actualGeneration: current.writer_generation,
			});
		}
	}
}

class SQLiteDurableStorageWriter
	extends Disposable
	implements IDurableStorageWriter, ISQLiteDurableStorageWriterIdentity
{
	private pendingLog: PendingBytes | undefined;
	private readonly pendingTemporaryObjects = new Map<string, PendingBytes>();
	private pendingByteLength = 0;
	private releasedValue = false;

	constructor(
		private readonly owner: ISQLiteDurableStorageOwner,
		readonly resource: string,
		readonly authority: IDurableStorageAuthority,
	) {
		super();
	}

	get released(): boolean {
		return this.releasedValue;
	}

	async appendLog(
		expectedLength: number,
		bytes: Uint8Array,
	): Promise<DurableStorageResult<IDurableStorageAppend>> {
		const operation = 'append-log';
		const lengthValidation = validateLength(operation, expectedLength);
		if (lengthValidation.type === 'error') {
			return lengthValidation;
		}
		const bytesResult = copyInputBytes(
			operation,
			bytes,
			this.owner.limits.maximumAppendBytes,
			'append-bytes',
		);
		if (bytesResult.type === 'error') {
			return bytesResult;
		}
		const durableLengthResult = this.owner.runRead(
			this,
			operation,
			database => this.readLogLength(database, operation),
		);
		if (durableLengthResult.type === 'error') {
			return durableLengthResult;
		}

		const durableLength = durableLengthResult.value;
		const pending = this.pendingLog;
		if (pending && pending.baseLength !== durableLength) {
			return fail({
				code: 'corruption',
				operation,
				subject: 'log',
			});
		}
		const pendingLength = pending?.byteLength ?? 0;
		const volatileLength = durableLength + pendingLength;
		if (expectedLength !== volatileLength) {
			return fail({
				code: 'length-conflict',
				operation,
				expectedLength,
				actualLength: volatileLength,
			});
		}
		const newLength = volatileLength + bytesResult.value.byteLength;
		if (
			!Number.isSafeInteger(newLength) ||
			newLength > this.owner.limits.maximumLogBytes
		) {
			return fail({
				code: 'resource-limit-exceeded',
				operation,
				limit: 'log-bytes',
				maximum: this.owner.limits.maximumLogBytes,
				actual: newLength,
			});
		}
		const pendingLimitResult = this.validatePendingLimit(
			operation,
			bytesResult.value.byteLength,
		);
		if (pendingLimitResult.type === 'error') {
			return pendingLimitResult;
		}
		if (bytesResult.value.byteLength > 0) {
			const target =
				this.pendingLog ??
				{
					baseLength: durableLength,
					chunks: [],
					byteLength: 0,
				};
			target.chunks.push(bytesResult.value);
			target.byteLength += bytesResult.value.byteLength;
			this.pendingByteLength += bytesResult.value.byteLength;
			this.pendingLog = target;
		}
		return succeed({
			offset: volatileLength,
			volatileLength: newLength,
		});
	}

	async syncLog(
		expectedVolatileLength: number,
	): Promise<DurableStorageResult<IDurableStorageDurableLength>> {
		const operation = 'sync-log';
		const validation = validateLength(operation, expectedVolatileLength);
		if (validation.type === 'error') {
			return validation;
		}
		const pending = this.pendingLog;
		const result = this.owner.runWrite(this, operation, database => {
			const durableLength = this.readLogLength(database, operation);
			validateChunkCollection(
				database,
				operation,
				{ kind: 'log', resource: this.resource },
				durableLength,
			);
			if (pending && pending.baseLength !== durableLength) {
				throwStorageError({
					code: 'length-conflict',
					operation,
					expectedLength: pending.baseLength,
					actualLength: durableLength,
				});
			}
			const volatileLength = durableLength + (pending?.byteLength ?? 0);
			if (expectedVolatileLength !== volatileLength) {
				throwStorageError({
					code: 'length-conflict',
					operation,
					expectedLength: expectedVolatileLength,
					actualLength: volatileLength,
				});
			}
			if (pending) {
				const persistedLength = insertPendingChunks(
					database,
					{ kind: 'log', resource: this.resource },
					pending,
				);
				if (persistedLength !== volatileLength) {
					throwStorageError({
						code: 'corruption',
						operation,
						subject: 'log',
					});
				}
				database
					.prepare(
						`UPDATE DurableResource
						 SET log_length = ?
						 WHERE resource = ?`,
					)
					.run(volatileLength, this.resource);
			}
			return { durableLength: volatileLength };
		});
		if (result.type === 'success' && pending) {
			this.pendingByteLength -= pending.byteLength;
			this.pendingLog = undefined;
		}
		return result;
	}

	async getDurableLogLength(): Promise<
		DurableStorageResult<IDurableStorageDurableLength>
	> {
		const operation = 'read-log-length';
		return this.owner.runRead(this, operation, database => {
			const durableLength = this.readLogLength(database, operation);
			validateChunkCollection(
				database,
				operation,
				{ kind: 'log', resource: this.resource },
				durableLength,
			);
			return { durableLength };
		});
	}

	async readDurableLogRange(
		range: IDurableStorageRange,
	): Promise<DurableStorageResult<IDurableStorageBytes>> {
		const operation = 'read-log-range';
		const validation = validateRange(
			operation,
			range,
			this.owner.limits.maximumReadBytes,
		);
		if (validation.type === 'error') {
			return validation;
		}
		return this.owner.runRead(this, operation, database => {
			const durableLength = this.readLogLength(database, operation);
			return readCollectionRange(
				database,
				operation,
				{ kind: 'log', resource: this.resource },
				durableLength,
				range,
			);
		});
	}

	async truncateDurableLogTail(
		expectedDurableLength: number,
		newDurableLength: number,
	): Promise<DurableStorageResult<IDurableStorageDurableLength>> {
		const operation = 'truncate-log-tail';
		const expectedValidation = validateLength(
			operation,
			expectedDurableLength,
		);
		if (expectedValidation.type === 'error') {
			return expectedValidation;
		}
		const newValidation = validateLength(operation, newDurableLength);
		if (
			newValidation.type === 'error' ||
			newDurableLength > expectedDurableLength
		) {
			return newValidation.type === 'error'
				? newValidation
				: fail({
						code: 'invalid-request',
						operation,
						reason: 'invalid-length',
					});
		}
		if (this.pendingLog) {
			return fail({
				code: 'length-conflict',
				operation,
				expectedLength: expectedDurableLength,
				actualLength:
					this.pendingLog.baseLength + this.pendingLog.byteLength,
			});
		}

		return this.owner.runWrite(this, operation, database => {
			const durableLength = this.readLogLength(database, operation);
			if (expectedDurableLength !== durableLength) {
				throwStorageError({
					code: 'length-conflict',
					operation,
					expectedLength: expectedDurableLength,
					actualLength: durableLength,
				});
			}
			const collection: ChunkCollection = {
				kind: 'log',
				resource: this.resource,
			};
			validateChunkCollection(
				database,
				operation,
				collection,
				durableLength,
			);
			if (newDurableLength < durableLength) {
				this.truncateLogChunks(database, newDurableLength);
				database
					.prepare(
						`UPDATE DurableResource
						 SET log_length = ?
						 WHERE resource = ?`,
					)
					.run(newDurableLength, this.resource);
			}
			return { durableLength: newDurableLength };
		});
	}

	async createTemporaryObject(): Promise<
		DurableStorageResult<IDurableStorageTemporaryObject>
	> {
		const operation = 'create-temporary-object';
		return this.owner.runWrite(this, operation, database => {
			const id = randomOpaqueToken();
			database
				.prepare(
					`INSERT INTO DurableTemporaryObject(
						resource,
						temporary_object_id,
						durable_length
					 ) VALUES (?, ?, 0)`,
				)
				.run(this.resource, id);
			return { id };
		});
	}

	async appendTemporaryObject(
		id: string,
		expectedLength: number,
		bytes: Uint8Array,
	): Promise<DurableStorageResult<IDurableStorageAppend>> {
		const operation = 'append-temporary-object';
		const idValidation = validateTemporaryObjectId(operation, id);
		if (idValidation.type === 'error') {
			return idValidation;
		}
		const lengthValidation = validateLength(operation, expectedLength);
		if (lengthValidation.type === 'error') {
			return lengthValidation;
		}
		const bytesResult = copyInputBytes(
			operation,
			bytes,
			this.owner.limits.maximumAppendBytes,
			'append-bytes',
		);
		if (bytesResult.type === 'error') {
			return bytesResult;
		}
		const durableLengthResult = this.owner.runRead(
			this,
			operation,
			database =>
				readTemporaryObjectLength(
					database,
					operation,
					this.resource,
					id,
				),
		);
		if (durableLengthResult.type === 'error') {
			return durableLengthResult;
		}

		const durableLength = durableLengthResult.value;
		const pending = this.pendingTemporaryObjects.get(id);
		if (pending && pending.baseLength !== durableLength) {
			return fail({
				code: 'corruption',
				operation,
				subject: 'temporary-object',
			});
		}
		const volatileLength = durableLength + (pending?.byteLength ?? 0);
		if (expectedLength !== volatileLength) {
			return fail({
				code: 'length-conflict',
				operation,
				expectedLength,
				actualLength: volatileLength,
			});
		}
		const newLength = volatileLength + bytesResult.value.byteLength;
		if (
			!Number.isSafeInteger(newLength) ||
			newLength > this.owner.limits.maximumTemporaryObjectBytes
		) {
			return fail({
				code: 'resource-limit-exceeded',
				operation,
				limit: 'temporary-object-bytes',
				maximum: this.owner.limits.maximumTemporaryObjectBytes,
				actual: newLength,
			});
		}
		const pendingLimitResult = this.validatePendingLimit(
			operation,
			bytesResult.value.byteLength,
		);
		if (pendingLimitResult.type === 'error') {
			return pendingLimitResult;
		}
		if (bytesResult.value.byteLength > 0) {
			const target =
				pending ??
				{
					baseLength: durableLength,
					chunks: [],
					byteLength: 0,
				};
			target.chunks.push(bytesResult.value);
			target.byteLength += bytesResult.value.byteLength;
			this.pendingByteLength += bytesResult.value.byteLength;
			this.pendingTemporaryObjects.set(id, target);
		}
		return succeed({
			offset: volatileLength,
			volatileLength: newLength,
		});
	}

	async syncTemporaryObject(
		id: string,
		expectedVolatileLength: number,
	): Promise<DurableStorageResult<IDurableStorageDurableLength>> {
		const operation = 'sync-temporary-object';
		const idValidation = validateTemporaryObjectId(operation, id);
		if (idValidation.type === 'error') {
			return idValidation;
		}
		const lengthValidation = validateLength(
			operation,
			expectedVolatileLength,
		);
		if (lengthValidation.type === 'error') {
			return lengthValidation;
		}
		const pending = this.pendingTemporaryObjects.get(id);
		const result = this.owner.runWrite(this, operation, database => {
			const durableLength = readTemporaryObjectLength(
				database,
				operation,
				this.resource,
				id,
			);
			validateChunkCollection(
				database,
				operation,
				{ kind: 'temporary-object', resource: this.resource, id },
				durableLength,
			);
			if (pending && pending.baseLength !== durableLength) {
				throwStorageError({
					code: 'length-conflict',
					operation,
					expectedLength: pending.baseLength,
					actualLength: durableLength,
				});
			}
			const volatileLength = durableLength + (pending?.byteLength ?? 0);
			if (expectedVolatileLength !== volatileLength) {
				throwStorageError({
					code: 'length-conflict',
					operation,
					expectedLength: expectedVolatileLength,
					actualLength: volatileLength,
				});
			}
			if (pending) {
				const persistedLength = insertPendingChunks(
					database,
					{
						kind: 'temporary-object',
						resource: this.resource,
						id,
					},
					pending,
				);
				if (persistedLength !== volatileLength) {
					throwStorageError({
						code: 'corruption',
						operation,
						subject: 'temporary-object',
					});
				}
				database
					.prepare(
						`UPDATE DurableTemporaryObject
						 SET durable_length = ?
						 WHERE resource = ? AND temporary_object_id = ?`,
					)
					.run(volatileLength, this.resource, id);
			}
			return { durableLength: volatileLength };
		});
		if (result.type === 'success' && pending) {
			this.pendingByteLength -= pending.byteLength;
			this.pendingTemporaryObjects.delete(id);
		}
		return result;
	}

	async getTemporaryObjectDurableLength(
		id: string,
	): Promise<DurableStorageResult<IDurableStorageDurableLength>> {
		const operation = 'read-temporary-object-length';
		const validation = validateTemporaryObjectId(operation, id);
		if (validation.type === 'error') {
			return validation;
		}
		return this.owner.runRead(this, operation, database => {
			const durableLength = readTemporaryObjectLength(
				database,
				operation,
				this.resource,
				id,
			);
			validateChunkCollection(
				database,
				operation,
				{ kind: 'temporary-object', resource: this.resource, id },
				durableLength,
			);
			return { durableLength };
		});
	}

	async readTemporaryObjectRange(
		id: string,
		range: IDurableStorageRange,
	): Promise<DurableStorageResult<IDurableStorageBytes>> {
		const operation = 'read-temporary-object-range';
		const idValidation = validateTemporaryObjectId(operation, id);
		if (idValidation.type === 'error') {
			return idValidation;
		}
		const rangeValidation = validateRange(
			operation,
			range,
			this.owner.limits.maximumReadBytes,
		);
		if (rangeValidation.type === 'error') {
			return rangeValidation;
		}
		return this.owner.runRead(this, operation, database => {
			const durableLength = readTemporaryObjectLength(
				database,
				operation,
				this.resource,
				id,
			);
			return readCollectionRange(
				database,
				operation,
				{ kind: 'temporary-object', resource: this.resource, id },
				durableLength,
				range,
			);
		});
	}

	async listTemporaryObjects(
		limit: number,
	): Promise<
		DurableStorageResult<
			readonly IDurableStorageTemporaryObjectDescriptor[]
		>
	> {
		const operation = 'list-temporary-objects';
		if (!Number.isSafeInteger(limit) || limit <= 0) {
			return fail({
				code: 'invalid-request',
				operation,
				reason: 'invalid-list-limit',
			});
		}
		if (limit > this.owner.limits.maximumTemporaryObjectListEntries) {
			return fail({
				code: 'resource-limit-exceeded',
				operation,
				limit: 'temporary-object-list-entries',
				maximum:
					this.owner.limits.maximumTemporaryObjectListEntries,
				actual: limit,
			});
		}
		return this.owner.runRead(this, operation, database => {
			const rows = database
				.prepare(
					`SELECT temporary_object_id, durable_length
					 FROM DurableTemporaryObject
					 WHERE resource = ?
					 ORDER BY temporary_object_id
					 LIMIT ?`,
				)
				.all(this.resource, limit) as TemporaryObjectRow[];
			return Object.freeze(
				rows.map(row => {
					if (
						!opaqueTokenPattern.test(row.temporary_object_id) ||
						!Number.isSafeInteger(row.durable_length) ||
						row.durable_length < 0
					) {
						throwStorageError({
							code: 'corruption',
							operation,
							subject: 'temporary-object',
						});
					}
					validateChunkCollection(
						database,
						operation,
						{
							kind: 'temporary-object',
							resource: this.resource,
							id: row.temporary_object_id,
						},
						row.durable_length,
					);
					return Object.freeze({
						id: row.temporary_object_id,
						durableLength: row.durable_length,
					});
				}),
			);
		});
	}

	async deleteTemporaryObject(
		id: string,
		expectedDurableLength: number,
	): Promise<DurableStorageResult<void>> {
		const operation = 'delete-temporary-object';
		const idValidation = validateTemporaryObjectId(operation, id);
		if (idValidation.type === 'error') {
			return idValidation;
		}
		const lengthValidation = validateLength(
			operation,
			expectedDurableLength,
		);
		if (lengthValidation.type === 'error') {
			return lengthValidation;
		}
		const result = this.owner.runWrite(this, operation, database => {
			const durableLength = readTemporaryObjectLength(
				database,
				operation,
				this.resource,
				id,
			);
			if (expectedDurableLength !== durableLength) {
				throwStorageError({
					code: 'length-conflict',
					operation,
					expectedLength: expectedDurableLength,
					actualLength: durableLength,
				});
			}
			validateChunkCollection(
				database,
				operation,
				{ kind: 'temporary-object', resource: this.resource, id },
				durableLength,
			);
			database
				.prepare(
					`DELETE FROM DurableTemporaryObject
					 WHERE resource = ? AND temporary_object_id = ?`,
				)
				.run(this.resource, id);
		});
		if (result.type === 'success') {
			const pending = this.pendingTemporaryObjects.get(id);
			if (pending) {
				this.pendingByteLength -= pending.byteLength;
				this.pendingTemporaryObjects.delete(id);
			}
		}
		return result;
	}

	async atomicInstallTemporaryObject(
		id: string,
		expectedDurableLength: number,
		objectKey: string,
	): Promise<DurableStorageResult<IDurableStorageObjectDescriptor>> {
		const operation = 'install-object';
		const idValidation = validateTemporaryObjectId(operation, id);
		if (idValidation.type === 'error') {
			return idValidation;
		}
		const lengthValidation = validateLength(
			operation,
			expectedDurableLength,
		);
		if (lengthValidation.type === 'error') {
			return lengthValidation;
		}
		const keyValidation = validateOpaqueString(
			operation,
			objectKey,
			'object-key',
			this.owner.limits.maximumObjectKeyBytes,
		);
		if (keyValidation.type === 'error') {
			return keyValidation;
		}
		const pending = this.pendingTemporaryObjects.get(id);
		if (pending) {
			return fail({
				code: 'length-conflict',
				operation,
				expectedLength: expectedDurableLength,
				actualLength: pending.baseLength + pending.byteLength,
			});
		}
		return this.owner.runWrite(this, operation, database => {
			const durableLength = readTemporaryObjectLength(
				database,
				operation,
				this.resource,
				id,
			);
			if (expectedDurableLength !== durableLength) {
				throwStorageError({
					code: 'length-conflict',
					operation,
					expectedLength: expectedDurableLength,
					actualLength: durableLength,
				});
			}
			validateChunkCollection(
				database,
				operation,
				{ kind: 'temporary-object', resource: this.resource, id },
				durableLength,
			);
			const currentObject = database
				.prepare(
					`SELECT object_generation, durable_length
					 FROM DurableObject
					 WHERE resource = ? AND object_key = ?`,
				)
				.get(this.resource, objectKey) as ObjectRow | undefined;
			if (currentObject) {
				if (
					!opaqueTokenPattern.test(currentObject.object_generation)
					|| !Number.isSafeInteger(currentObject.durable_length)
					|| currentObject.durable_length < 0
				) {
					throwStorageError({
						code: 'corruption',
						operation,
						subject: 'object',
					});
				}
				validateChunkCollection(
					database,
					operation,
					{ kind: 'object', resource: this.resource, key: objectKey },
					currentObject.durable_length,
				);
				throwStorageError({
					code: 'generation-conflict',
					operation,
					expectedGeneration: null,
					actualGeneration: currentObject.object_generation,
				});
			}
			const generation = randomOpaqueToken();
			database
				.prepare(
					`INSERT INTO DurableObject(
						resource,
						object_key,
						object_generation,
						durable_length
					 ) VALUES (?, ?, ?, ?)`,
				)
				.run(
					this.resource,
					objectKey,
					generation,
					durableLength,
				);
			database
				.prepare(
					`INSERT INTO DurableObjectChunk(
						resource,
						object_key,
						byte_offset,
						bytes
					 )
					 SELECT resource, ?, byte_offset, bytes
					 FROM DurableTemporaryObjectChunk
					 WHERE resource = ? AND temporary_object_id = ?
					 ORDER BY byte_offset`,
				)
				.run(objectKey, this.resource, id);
			database
				.prepare(
					`DELETE FROM DurableTemporaryObject
					 WHERE resource = ? AND temporary_object_id = ?`,
				)
				.run(this.resource, id);
			return Object.freeze({
				key: objectKey,
				generation,
				durableLength,
			});
		});
	}

	async getObjectDescriptor(
		objectKey: string,
	): Promise<DurableStorageResult<IDurableStorageObjectDescriptor>> {
		const operation = 'read-object-descriptor';
		const validation = validateOpaqueString(
			operation,
			objectKey,
			'object-key',
			this.owner.limits.maximumObjectKeyBytes,
		);
		if (validation.type === 'error') {
			return validation;
		}
		return this.owner.runRead(this, operation, database => {
			const object = database
				.prepare(
					`SELECT object_generation, durable_length
					 FROM DurableObject
					 WHERE resource = ? AND object_key = ?`,
				)
				.get(this.resource, objectKey) as ObjectRow | undefined;
			if (!object) {
				throwStorageError({
					code: 'not-found',
					operation,
					subject: 'object',
				});
			}
			if (
				!opaqueTokenPattern.test(object.object_generation) ||
				!Number.isSafeInteger(object.durable_length) ||
				object.durable_length < 0
			) {
				throwStorageError({
					code: 'corruption',
					operation,
					subject: 'object',
				});
			}
			validateChunkCollection(
				database,
				operation,
				{ kind: 'object', resource: this.resource, key: objectKey },
				object.durable_length,
			);
			return Object.freeze({
				key: objectKey,
				generation: object.object_generation,
				durableLength: object.durable_length,
			});
		});
	}

	async readObjectRange(
		objectKey: string,
		expectedGeneration: string,
		range: IDurableStorageRange,
	): Promise<DurableStorageResult<IDurableStorageBytes>> {
		const operation = 'read-object-range';
		const keyValidation = validateOpaqueString(
			operation,
			objectKey,
			'object-key',
			this.owner.limits.maximumObjectKeyBytes,
		);
		if (keyValidation.type === 'error') {
			return keyValidation;
		}
		const generationValidation = validateRequiredGeneration(
			operation,
			expectedGeneration,
		);
		if (generationValidation.type === 'error') {
			return generationValidation;
		}
		const rangeValidation = validateRange(
			operation,
			range,
			this.owner.limits.maximumReadBytes,
		);
		if (rangeValidation.type === 'error') {
			return rangeValidation;
		}
		return this.owner.runRead(this, operation, database => {
			const object = readObject(
				database,
				operation,
				this.resource,
				objectKey,
				expectedGeneration,
			);
			return readCollectionRange(
				database,
				operation,
				{ kind: 'object', resource: this.resource, key: objectKey },
				object.durable_length,
				range,
			);
		});
	}

	async readManifest(): Promise<
		DurableStorageResult<IDurableStorageManifest>
	> {
		const operation = 'read-manifest';
		return this.owner.runRead(this, operation, database => {
			const resource = this.readResourceState(database, operation);
			const { manifest_generation: generation, manifest_bytes: bytes } =
				resource;
			if (generation === null && bytes === null) {
				return { generation: null, bytes: null };
			}
			if (
				generation === null ||
				bytes === null ||
				!opaqueTokenPattern.test(generation) ||
				!(bytes instanceof Uint8Array) ||
				bytes.byteLength > this.owner.limits.maximumManifestBytes
			) {
				throwStorageError({
					code: 'corruption',
					operation,
					subject: 'manifest',
				});
			}
			return {
				generation,
				bytes: Uint8Array.from(bytes),
			};
		});
	}

	async compareAndSwapManifest(
		expectedGeneration: string | null,
		bytes: Uint8Array,
	): Promise<DurableStorageResult<IDurableStorageManifest>> {
		const operation = 'compare-and-swap-manifest';
		const generationValidation = validateGeneration(
			operation,
			expectedGeneration,
		);
		if (generationValidation.type === 'error') {
			return generationValidation;
		}
		const bytesResult = copyInputBytes(
			operation,
			bytes,
			this.owner.limits.maximumManifestBytes,
			'manifest-bytes',
		);
		if (bytesResult.type === 'error') {
			return bytesResult;
		}
		const result = this.owner.runWrite(this, operation, database => {
			const resource = this.readResourceState(database, operation);
			const actualGeneration = resource.manifest_generation;
			const actualBytes = resource.manifest_bytes;
			if (
				(actualGeneration === null) !== (actualBytes === null) ||
				(actualGeneration !== null &&
					(!opaqueTokenPattern.test(actualGeneration) ||
						!(actualBytes instanceof Uint8Array) ||
						actualBytes.byteLength >
							this.owner.limits.maximumManifestBytes))
			) {
				throwStorageError({
					code: 'corruption',
					operation,
					subject: 'manifest',
				});
			}
			if (expectedGeneration !== actualGeneration) {
				throwStorageError({
					code: 'generation-conflict',
					operation,
					expectedGeneration,
					actualGeneration,
				});
			}
			let generation: string;
			do {
				generation = randomOpaqueToken();
			} while (generation === actualGeneration);
			database
				.prepare(
					`UPDATE DurableResource
					 SET manifest_generation = ?, manifest_bytes = ?
					 WHERE resource = ?`,
				)
				.run(generation, bytesResult.value, this.resource);
			return {
				generation,
				bytes: Uint8Array.from(bytesResult.value),
			};
		});
		return result;
	}

	release(): void {
		if (this.releasedValue) {
			return;
		}
		this.releasedValue = true;
		this.pendingLog = undefined;
		this.pendingTemporaryObjects.clear();
		this.pendingByteLength = 0;
		this.owner.releaseWriter(this);
		super.dispose();
	}

	override dispose(): void {
		this.release();
	}

	private validatePendingLimit(
		operation: DurableStorageOperation,
		additionalBytes: number,
	): DurableStorageResult<void> {
		const actual = this.pendingByteLength + additionalBytes;
		if (
			!Number.isSafeInteger(actual) ||
			actual > this.owner.limits.maximumPendingBytes
		) {
			return fail({
				code: 'resource-limit-exceeded',
				operation,
				limit: 'pending-bytes',
				maximum: this.owner.limits.maximumPendingBytes,
				actual,
			});
		}
		return succeed(undefined);
	}

	private readResourceState(
		database: DatabaseSync,
		operation: DurableStorageOperation,
	): ResourceStateRow {
		const row = database
			.prepare(
				`SELECT
					writer_generation,
					writer_fence,
					log_length,
					manifest_generation,
					manifest_bytes
				 FROM DurableResource
				 WHERE resource = ?`,
			)
			.get(this.resource) as ResourceStateRow | undefined;
		if (
			!row ||
			!Number.isSafeInteger(row.log_length) ||
			row.log_length < 0 ||
			row.log_length > this.owner.limits.maximumLogBytes
		) {
			throwStorageError({
				code: 'corruption',
				operation,
				subject: 'log',
			});
		}
		return row;
	}

	private readLogLength(
		database: DatabaseSync,
		operation: DurableStorageOperation,
	): number {
		return this.readResourceState(database, operation).log_length;
	}

	private truncateLogChunks(
		database: DatabaseSync,
		newDurableLength: number,
	): void {
		if (newDurableLength === 0) {
			database
				.prepare(
					`DELETE FROM DurableLogChunk
					 WHERE resource = ?`,
				)
				.run(this.resource);
			return;
		}
		const crossingChunk = database
			.prepare(
				`SELECT byte_offset, bytes
				 FROM DurableLogChunk
				 WHERE resource = ?
				   AND byte_offset < ?
				   AND byte_offset + length(bytes) > ?
				 LIMIT 1`,
			)
			.get(
				this.resource,
				newDurableLength,
				newDurableLength,
			) as ChunkBytesRow | undefined;
		database
			.prepare(
				`DELETE FROM DurableLogChunk
				 WHERE resource = ? AND byte_offset >= ?`,
			)
			.run(this.resource, newDurableLength);
		if (crossingChunk) {
			const keptLength = newDurableLength - crossingChunk.byte_offset;
			database
				.prepare(
					`UPDATE DurableLogChunk
					 SET bytes = ?
					 WHERE resource = ? AND byte_offset = ?`,
				)
				.run(
					Uint8Array.from(
						crossingChunk.bytes.subarray(0, keptLength),
					),
					this.resource,
					crossingChunk.byte_offset,
				);
		}
	}
}

/**
 * Opens a file-backed SQLite durable byte store with WAL and full synchronous commits.
 */
export async function openSQLiteDurableStorage(
	databasePath: string,
	options: ISQLiteDurableStorageOptions = {},
): Promise<DurableStorageResult<IDurableStorageService>> {
	if (
		typeof databasePath !== 'string' ||
		databasePath.length === 0 ||
		databasePath === ':memory:' ||
		databasePath.startsWith('file::memory:') ||
		/[?&]mode=memory(?:&|$)/.test(databasePath)
	) {
		return fail({
			code: 'unsupported',
			operation: 'open',
			feature: 'ephemeral-storage',
		});
	}
	const limits = options.limits ?? defaultSQLiteDurableStorageLimits;
	if (!validateLimits(limits)) {
		return fail({
			code: 'invalid-request',
			operation: 'open',
			reason: 'invalid-length',
		});
	}
	if (
		options.busyTimeout !== undefined &&
		(!Number.isSafeInteger(options.busyTimeout) || options.busyTimeout < 0)
	) {
		return fail({
			code: 'invalid-request',
			operation: 'open',
			reason: 'invalid-length',
		});
	}
	if (
		options.maximumDatabasePages !== undefined &&
		(!Number.isSafeInteger(options.maximumDatabasePages) ||
			options.maximumDatabasePages <= 0)
	) {
		return fail({
			code: 'invalid-request',
			operation: 'open',
			reason: 'invalid-length',
		});
	}
	try {
		const database = openDatabase(databasePath, options);
		return succeed(new SQLiteDurableStorage(database, limits));
	} catch (error) {
		return fail(mapStorageError('open', error));
	}
}
