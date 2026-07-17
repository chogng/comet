/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export type DurableStorageOperation =
	| 'open'
	| 'open-writer'
	| 'append-log'
	| 'sync-log'
	| 'read-log-length'
	| 'read-log-range'
	| 'truncate-log-tail'
	| 'create-temporary-object'
	| 'append-temporary-object'
	| 'sync-temporary-object'
	| 'read-temporary-object-length'
	| 'read-temporary-object-range'
	| 'list-temporary-objects'
	| 'delete-temporary-object'
	| 'install-object'
	| 'read-object-descriptor'
	| 'read-object-range'
	| 'read-manifest'
	| 'compare-and-swap-manifest';

export type DurableStorageError =
	| {
		readonly code: 'invalid-request';
		readonly operation: DurableStorageOperation;
		readonly reason:
			| 'invalid-resource'
			| 'invalid-object-key'
			| 'invalid-temporary-object-id'
			| 'invalid-generation'
			| 'invalid-bytes'
			| 'invalid-length'
			| 'invalid-range'
			| 'invalid-list-limit';
	}
	| {
		readonly code: 'resource-limit-exceeded';
		readonly operation: DurableStorageOperation;
		readonly limit:
			| 'resource-bytes'
			| 'object-key-bytes'
			| 'append-bytes'
			| 'pending-bytes'
			| 'log-bytes'
			| 'read-bytes'
			| 'temporary-object-bytes'
			| 'manifest-bytes'
			| 'temporary-object-list-entries';
		readonly maximum: number;
		readonly actual: number;
	}
	| {
		readonly code: 'unsupported';
		readonly operation: DurableStorageOperation;
		readonly feature:
			| 'ephemeral-storage'
			| 'storage-format-version'
			| 'durable-append-log'
			| 'full-sync'
			| 'writer-generation-exhausted';
	}
	| {
		readonly code: 'permission-denied' | 'out-of-space' | 'io';
		readonly operation: DurableStorageOperation;
	}
	| {
		readonly code: 'corruption';
		readonly operation: DurableStorageOperation;
		readonly subject:
			| 'backend'
			| 'schema'
			| 'writer'
			| 'log'
			| 'temporary-object'
			| 'object'
			| 'manifest';
	}
	| {
		readonly code: 'fence-lost';
		readonly operation: DurableStorageOperation;
		readonly expectedGeneration: string;
		readonly actualGeneration: string;
	}
	| {
		readonly code: 'generation-conflict';
		readonly operation: DurableStorageOperation;
		readonly expectedGeneration: string | null;
		readonly actualGeneration: string | null;
	}
	| {
		readonly code: 'length-conflict';
		readonly operation: DurableStorageOperation;
		readonly expectedLength: number;
		readonly actualLength: number;
	}
	| {
		readonly code: 'not-found';
		readonly operation: DurableStorageOperation;
		readonly subject: 'resource' | 'temporary-object' | 'object';
	}
	| {
		readonly code: 'disposed';
		readonly operation: DurableStorageOperation;
	};

export type DurableStorageResult<T> =
	| {
		readonly type: 'success';
		readonly value: T;
	}
	| {
		readonly type: 'error';
		readonly error: DurableStorageError;
	};

export interface IDurableStorageLimits {
	readonly maximumResourceBytes: number;
	readonly maximumObjectKeyBytes: number;
	readonly maximumAppendBytes: number;
	readonly maximumPendingBytes: number;
	readonly maximumLogBytes: number;
	readonly maximumReadBytes: number;
	readonly maximumTemporaryObjectBytes: number;
	readonly maximumManifestBytes: number;
	readonly maximumTemporaryObjectListEntries: number;
}

export interface IDurableStorageAuthority {
	readonly generation: string;
	readonly fenceToken: string;
}

export interface IDurableStorageRange {
	readonly offset: number;
	readonly length: number;
}

export interface IDurableStorageBytes {
	readonly bytes: Uint8Array;
}

export interface IDurableStorageAppend {
	readonly offset: number;
	readonly volatileLength: number;
}

export interface IDurableStorageDurableLength {
	readonly durableLength: number;
}

export interface IDurableStorageTemporaryObject {
	readonly id: string;
}

export interface IDurableStorageTemporaryObjectDescriptor {
	readonly id: string;
	readonly durableLength: number;
}

export interface IDurableStorageObjectDescriptor {
	readonly key: string;
	readonly generation: string;
	readonly durableLength: number;
}

export interface IDurableStorageManifest {
	readonly generation: string | null;
	readonly bytes: Uint8Array | null;
}

/**
 * Owns one fenced resource writer. Appends remain volatile until their matching sync succeeds, and release discards every pending byte.
 */
export interface IDurableStorageWriter extends IDisposable {
	readonly resource: string;
	readonly authority: IDurableStorageAuthority;

	appendLog(
		expectedLength: number,
		bytes: Uint8Array,
	): Promise<DurableStorageResult<IDurableStorageAppend>>;
	syncLog(
		expectedVolatileLength: number,
	): Promise<DurableStorageResult<IDurableStorageDurableLength>>;
	getDurableLogLength(): Promise<DurableStorageResult<IDurableStorageDurableLength>>;
	readDurableLogRange(
		range: IDurableStorageRange,
	): Promise<DurableStorageResult<IDurableStorageBytes>>;
	truncateDurableLogTail(
		expectedDurableLength: number,
		newDurableLength: number,
	): Promise<DurableStorageResult<IDurableStorageDurableLength>>;

	createTemporaryObject(): Promise<DurableStorageResult<IDurableStorageTemporaryObject>>;
	appendTemporaryObject(
		id: string,
		expectedLength: number,
		bytes: Uint8Array,
	): Promise<DurableStorageResult<IDurableStorageAppend>>;
	syncTemporaryObject(
		id: string,
		expectedVolatileLength: number,
	): Promise<DurableStorageResult<IDurableStorageDurableLength>>;
	getTemporaryObjectDurableLength(
		id: string,
	): Promise<DurableStorageResult<IDurableStorageDurableLength>>;
	readTemporaryObjectRange(
		id: string,
		range: IDurableStorageRange,
	): Promise<DurableStorageResult<IDurableStorageBytes>>;
	listTemporaryObjects(
		limit: number,
	): Promise<DurableStorageResult<readonly IDurableStorageTemporaryObjectDescriptor[]>>;
	deleteTemporaryObject(
		id: string,
		expectedDurableLength: number,
	): Promise<DurableStorageResult<void>>;
	/**
	 * Atomically promotes one durable temporary object into a new immutable object key.
	 * Existing keys are never replaced, so a failed manifest CAS cannot change the bytes
	 * referenced by the previous manifest generation.
	 */
	atomicInstallTemporaryObject(
		id: string,
		expectedDurableLength: number,
		objectKey: string,
	): Promise<DurableStorageResult<IDurableStorageObjectDescriptor>>;

	getObjectDescriptor(
		objectKey: string,
	): Promise<DurableStorageResult<IDurableStorageObjectDescriptor>>;
	readObjectRange(
		objectKey: string,
		expectedGeneration: string,
		range: IDurableStorageRange,
	): Promise<DurableStorageResult<IDurableStorageBytes>>;

	readManifest(): Promise<DurableStorageResult<IDurableStorageManifest>>;
	compareAndSwapManifest(
		expectedGeneration: string | null,
		bytes: Uint8Array,
	): Promise<DurableStorageResult<IDurableStorageManifest>>;

	release(): void;
}

/**
 * Opens exclusive resource writers over a durable byte store.
 */
export interface IDurableStorageService extends IDisposable {
	readonly _serviceBrand: undefined;
	readonly limits: IDurableStorageLimits;

	openWriter(resource: string): Promise<DurableStorageResult<IDurableStorageWriter>>;
}

export const IDurableStorageService =
	createDecorator<IDurableStorageService>('durableStorageService');
