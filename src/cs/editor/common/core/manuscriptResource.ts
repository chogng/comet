/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import { cloneCanonicalRuntimeUri } from 'cs/editor/common/core/canonicalUri';
import { isCanonicalUuidV7 } from 'cs/editor/common/core/identifiers';

export const manuscriptDraftScheme = 'comet-draft';

export type ManuscriptResourceFailure =
	| 'invalid-uri'
	| 'unsupported-scheme'
	| 'authority-not-allowed'
	| 'invalid-path'
	| 'query-not-allowed'
	| 'fragment-not-allowed'
	| 'not-canonical';

export type ManuscriptResourceResult =
	| {
		readonly type: 'valid';
		readonly resource: URI;
		readonly canonical: string;
	}
	| {
		readonly type: 'invalid';
		readonly reason: ManuscriptResourceFailure;
	};

export function parseManuscriptResource(value: string): ManuscriptResourceResult {
	let resource: URI;
	try {
		resource = URI.parse(value, true);
	} catch {
		return {
			type: 'invalid',
			reason: 'invalid-uri',
		};
	}

	const result = validateManuscriptResource(resource);
	if (result.type === 'invalid') {
		return result;
	}

	return result.canonical === value
		? result
		: {
			type: 'invalid',
			reason: 'not-canonical',
		};
}

export function validateManuscriptResource(resource: URI): ManuscriptResourceResult {
	const captured = cloneCanonicalRuntimeUri(resource);
	if (captured === undefined) {
		return {
			type: 'invalid',
			reason: 'invalid-uri',
		};
	}

	if (captured.scheme !== manuscriptDraftScheme) {
		return {
			type: 'invalid',
			reason: 'unsupported-scheme',
		};
	}

	if (captured.authority.length !== 0) {
		return {
			type: 'invalid',
			reason: 'authority-not-allowed',
		};
	}

	if (!isCanonicalUuidV7(captured.path)) {
		return {
			type: 'invalid',
			reason: 'invalid-path',
		};
	}

	if (captured.query.length !== 0) {
		return {
			type: 'invalid',
			reason: 'query-not-allowed',
		};
	}

	if (captured.fragment.length !== 0) {
		return {
			type: 'invalid',
			reason: 'fragment-not-allowed',
		};
	}

	return {
		type: 'valid',
		resource: captured,
		canonical: captured.toString(),
	};
}

export function createManuscriptDraftResource(uuidV7: string): URI {
	const resource = URI.from({
		scheme: manuscriptDraftScheme,
		path: uuidV7,
	});
	const result = validateManuscriptResource(resource);
	if (result.type === 'invalid') {
		throw new TypeError(`Invalid manuscript draft resource: ${result.reason}.`);
	}
	return result.resource;
}
