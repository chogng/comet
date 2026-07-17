/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const manuscriptModelErrorCodes = Object.freeze([
	'MANUSCRIPT_MODEL_ALREADY_EXISTS',
	'MANUSCRIPT_MODEL_NOT_FOUND',
	'MANUSCRIPT_RESOURCE_UNSUPPORTED',
	'MANUSCRIPT_REVISION_NOT_FOUND',
	'MANUSCRIPT_BASE_REVISION_MISMATCH',
	'MANUSCRIPT_TRANSACTION_INVALID',
	'MANUSCRIPT_SCHEMA_INVALID',
	'MANUSCRIPT_HASH_MISMATCH',
	'MANUSCRIPT_AUTHORITY_LOST',
	'MANUSCRIPT_DURABILITY_FAILED',
	'MANUSCRIPT_RECOVERY_REQUIRED',
	'MANUSCRIPT_WRITE_SUSPENDED',
	'MANUSCRIPT_PROPOSAL_REVISION_MISMATCH',
	'MANUSCRIPT_PROPOSAL_LOCKED',
] as const);

export type ManuscriptModelErrorCode = (typeof manuscriptModelErrorCodes)[number];

export class ManuscriptModelError extends Error {
	readonly code: ManuscriptModelErrorCode;
	readonly data: Readonly<Record<string, unknown>>;

	constructor(
		code: ManuscriptModelErrorCode,
		data: Readonly<Record<string, unknown>> = {},
	) {
		super(code);
		this.name = 'ManuscriptModelError';
		this.code = code;
		this.data = Object.freeze({ ...data });
	}
}
