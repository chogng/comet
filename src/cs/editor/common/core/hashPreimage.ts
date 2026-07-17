/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { serializeCanonicalJson } from 'cs/editor/common/core/canonicalJson';

export const manuscriptHashPreimageProfile = 'nireco-hash-preimage-1';
export const manuscriptHashPreimagePrefix = 'NIRECO\0HASH\0V1\0';

export const manuscriptHashDomains = Object.freeze({
	academicEntity: 'nireco.academic-entity.v1',
	documentContent: 'nireco.document-content.v1',
	node: 'nireco.node.v1',
	proposalChangeGroup: 'nireco.proposal-change-group.v1',
	semanticDiff: 'nireco.semantic-diff.v1',
	transaction: 'nireco.transaction.v1',
} as const);

export type ManuscriptHashDomain =
	(typeof manuscriptHashDomains)[keyof typeof manuscriptHashDomains];

export type HashPreimageResult =
	| {
		readonly type: 'ok';
		readonly canonicalJson: string;
		readonly preimage: string;
	}
	| {
		readonly type: 'error';
		readonly reason: 'canonical-json';
		readonly path: string;
	};

export function createHashPreimage(
	domain: ManuscriptHashDomain,
	payload: unknown,
): HashPreimageResult {
	const canonical = serializeCanonicalJson(payload);
	if (canonical.type === 'error') {
		return {
			type: 'error',
			reason: 'canonical-json',
			path: canonical.error.path,
		};
	}

	return {
		type: 'ok',
		canonicalJson: canonical.value,
		preimage: `${manuscriptHashPreimagePrefix}${domain}\0${canonical.value}`,
	};
}
