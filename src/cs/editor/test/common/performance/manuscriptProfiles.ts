/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const manuscriptPerformanceProfileId = 'comet-manuscript-performance-1';

export type ManuscriptPerformanceProfileName = 'S' | 'M' | 'L';

export interface IManuscriptPerformanceProfile {
	readonly name: ManuscriptPerformanceProfileName;
	readonly wordCount: number;
	readonly nodeCount: number;
	readonly citationCount: number;
}

export const manuscriptPerformanceProfiles: Readonly<
	Record<ManuscriptPerformanceProfileName, IManuscriptPerformanceProfile>
> = Object.freeze({
	S: Object.freeze({
		name: 'S',
		wordCount: 15_000,
		nodeCount: 1_500,
		citationCount: 100,
	}),
	M: Object.freeze({
		name: 'M',
		wordCount: 75_000,
		nodeCount: 8_000,
		citationCount: 500,
	}),
	L: Object.freeze({
		name: 'L',
		wordCount: 200_000,
		nodeCount: 25_000,
		citationCount: 1_500,
	}),
});
