/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeFetchDoi } from 'cs/workbench/services/fetch/common/fetchDoi';
import { FetchErrorCode, fetchError } from 'cs/workbench/services/fetch/common/fetchErrors';

export type FetchDoiEvidenceStrength = 'strong' | 'siteArticleUrl';

export interface FetchDoiEvidence {
	readonly source: string;
	readonly value: string;
	readonly strength: FetchDoiEvidenceStrength;
}

export interface FetchDoiResolution {
	readonly doi?: string;
	readonly source?: string;
	readonly evidence: readonly FetchDoiEvidence[];
}

export function resolveFetchDoi(evidence: readonly FetchDoiEvidence[]): FetchDoiResolution {
	const normalizedEvidence = evidence
		.map(item => {
			const value = normalizeFetchDoi(item.value);
			return value ? { ...item, value } : undefined;
		})
		.filter((item): item is FetchDoiEvidence => item !== undefined);
	const strongValues = new Set(
		normalizedEvidence
			.filter(item => item.strength === 'strong')
			.map(item => item.value),
	);
	if (strongValues.size > 1) {
		throw fetchError(FetchErrorCode.MetadataConflict, {
			field: 'doi',
			evidence: normalizedEvidence,
		});
	}

	const strongValue = [...strongValues][0];
	if (strongValue) {
		const conflictingHint = normalizedEvidence.find(
			item => item.strength === 'siteArticleUrl' && item.value !== strongValue,
		);
		if (conflictingHint) {
			throw fetchError(FetchErrorCode.MetadataConflict, {
				field: 'doi',
				evidence: normalizedEvidence,
			});
		}
		return {
			doi: strongValue,
			source: normalizedEvidence.find(item => item.value === strongValue)?.source,
			evidence: normalizedEvidence,
		};
	}

	const hintValues = new Set(normalizedEvidence.map(item => item.value));
	if (hintValues.size > 1) {
		throw fetchError(FetchErrorCode.MetadataConflict, {
			field: 'doi',
			evidence: normalizedEvidence,
		});
	}
	const hint = normalizedEvidence[0];
	return {
		doi: hint?.value,
		source: hint?.source,
		evidence: normalizedEvidence,
	};
}
