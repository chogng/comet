/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const manuscriptPerformanceProfileId = 'comet-manuscript-performance-1';
export const manuscriptPerformanceGeneratorVersion = '1';

export type ManuscriptPerformanceProfileName = 'S' | 'M' | 'L';

export interface IManuscriptPerformanceFixtureIdentity {
	readonly profileId: typeof manuscriptPerformanceProfileId;
	readonly fixtureId: string;
	readonly generatorVersion: typeof manuscriptPerformanceGeneratorVersion;
	readonly seed: string;
}

export interface IManuscriptAcademicCollectionShape {
	readonly referenceSnapshotCount: number;
	readonly evidenceLinkCount: number;
	readonly claimCount: number;
	readonly claimEvidenceRelationCount: number;
}

export interface IManuscriptStructuralContentShape {
	readonly sectionCount: number;
	readonly minimumParagraphCount: number;
	readonly minimumParagraphsPerSection: number;
	readonly tableCount: number;
	readonly figureCount: number;
	readonly equationCount: number;
}

export interface IManuscriptTextScale {
	readonly utf8Bytes: number;
	readonly utf16Bytes: number;
}

export interface IManuscriptMetadataScale {
	readonly authorCount: number;
	readonly keywordCount: number;
	readonly affiliationCount: number;
}

export interface IManuscriptTransactionScale {
	readonly operationCount: number;
	readonly preconditionCount: number;
}

export interface IManuscriptTouchedParentWidths {
	readonly narrow: number;
	readonly representative: number;
	readonly maximum: number;
}

export interface IManuscriptViewport {
	readonly widthCssPixels: number;
	readonly heightCssPixels: number;
}

export interface IManuscriptProjectionDensity {
	readonly visibleNodeCount: number;
	readonly overscanNodeCount: number;
	readonly projectedNodeCount: number;
	readonly projectedTextUtf16Bytes: number;
	readonly viewPartCount: number;
}

export interface IManuscriptTextDistribution {
	readonly maximumSingleTextWordPermille: number;
	readonly minimumMedianTextNodeWords: number;
	readonly minimumP95TextNodeWords: number;
	readonly maximumP95TextNodeWords: number;
}

export const manuscriptPerformanceTextDistribution:
	IManuscriptTextDistribution = Object.freeze({
		maximumSingleTextWordPermille: 10,
		minimumMedianTextNodeWords: 8,
		minimumP95TextNodeWords: 20,
		maximumP95TextNodeWords: 64,
	});

export interface IManuscriptPerformanceProfile {
	readonly name: ManuscriptPerformanceProfileName;
	readonly identity: IManuscriptPerformanceFixtureIdentity;
	readonly wordCount: number;
	readonly nodeCount: number;
	readonly entityCount: number;
	readonly relationCount: number;
	readonly citationCount: number;
	readonly structuralContent: IManuscriptStructuralContentShape;
	readonly academicCollections: IManuscriptAcademicCollectionShape;
	readonly maximumNodeDepth: number;
	readonly maximumDirectChildren: number;
	readonly maximumSubtreeNodeCount: number;
	readonly text: IManuscriptTextScale;
	readonly metadata: IManuscriptMetadataScale;
	readonly transaction: IManuscriptTransactionScale;
	readonly touchedParentWidths: IManuscriptTouchedParentWidths;
	readonly viewport: IManuscriptViewport;
	readonly projectionDensity: IManuscriptProjectionDensity;
}

export const manuscriptPerformanceProfiles: Readonly<
	Record<ManuscriptPerformanceProfileName, IManuscriptPerformanceProfile>
> = Object.freeze({
	S: Object.freeze({
		name: 'S',
		identity: Object.freeze({
			profileId: manuscriptPerformanceProfileId,
			fixtureId: `${manuscriptPerformanceProfileId}-s`,
			generatorVersion: manuscriptPerformanceGeneratorVersion,
			seed: 'comet-manuscript-s-2026-07-17',
		}),
		wordCount: 15_000,
		nodeCount: 1_500,
		entityCount: 200,
		relationCount: 80,
		citationCount: 100,
		structuralContent: Object.freeze({
			sectionCount: 8,
			minimumParagraphCount: 600,
			minimumParagraphsPerSection: 40,
			tableCount: 5,
			figureCount: 5,
			equationCount: 20,
		}),
		academicCollections: Object.freeze({
			referenceSnapshotCount: 100,
			evidenceLinkCount: 60,
			claimCount: 40,
			claimEvidenceRelationCount: 80,
		}),
		maximumNodeDepth: 16,
		maximumDirectChildren: 256,
		maximumSubtreeNodeCount: 1_024,
		text: Object.freeze({
			utf8Bytes: 180_000,
			utf16Bytes: 240_000,
		}),
		metadata: Object.freeze({
			authorCount: 3,
			keywordCount: 12,
			affiliationCount: 4,
		}),
		transaction: Object.freeze({
			operationCount: 16,
			preconditionCount: 64,
		}),
		touchedParentWidths: Object.freeze({
			narrow: 8,
			representative: 64,
			maximum: 256,
		}),
		viewport: Object.freeze({
			widthCssPixels: 1_280,
			heightCssPixels: 720,
		}),
		projectionDensity: Object.freeze({
			visibleNodeCount: 60,
			overscanNodeCount: 30,
			projectedNodeCount: 90,
			projectedTextUtf16Bytes: 24_000,
			viewPartCount: 480,
		}),
	}),
	M: Object.freeze({
		name: 'M',
		identity: Object.freeze({
			profileId: manuscriptPerformanceProfileId,
			fixtureId: `${manuscriptPerformanceProfileId}-m`,
			generatorVersion: manuscriptPerformanceGeneratorVersion,
			seed: 'comet-manuscript-m-2026-07-17',
		}),
		wordCount: 75_000,
		nodeCount: 8_000,
		entityCount: 1_000,
		relationCount: 600,
		citationCount: 500,
		structuralContent: Object.freeze({
			sectionCount: 16,
			minimumParagraphCount: 3_200,
			minimumParagraphsPerSection: 120,
			tableCount: 20,
			figureCount: 20,
			equationCount: 100,
		}),
		academicCollections: Object.freeze({
			referenceSnapshotCount: 500,
			evidenceLinkCount: 300,
			claimCount: 200,
			claimEvidenceRelationCount: 600,
		}),
		maximumNodeDepth: 32,
		maximumDirectChildren: 2_048,
		maximumSubtreeNodeCount: 6_000,
		text: Object.freeze({
			utf8Bytes: 900_000,
			utf16Bytes: 1_200_000,
		}),
		metadata: Object.freeze({
			authorCount: 8,
			keywordCount: 32,
			affiliationCount: 16,
		}),
		transaction: Object.freeze({
			operationCount: 128,
			preconditionCount: 512,
		}),
		touchedParentWidths: Object.freeze({
			narrow: 16,
			representative: 512,
			maximum: 2_048,
		}),
		viewport: Object.freeze({
			widthCssPixels: 1_440,
			heightCssPixels: 900,
		}),
		projectionDensity: Object.freeze({
			visibleNodeCount: 120,
			overscanNodeCount: 60,
			projectedNodeCount: 180,
			projectedTextUtf16Bytes: 72_000,
			viewPartCount: 960,
		}),
	}),
	L: Object.freeze({
		name: 'L',
		identity: Object.freeze({
			profileId: manuscriptPerformanceProfileId,
			fixtureId: `${manuscriptPerformanceProfileId}-l`,
			generatorVersion: manuscriptPerformanceGeneratorVersion,
			seed: 'comet-manuscript-l-2026-07-17',
		}),
		wordCount: 200_000,
		nodeCount: 25_000,
		entityCount: 3_000,
		relationCount: 2_400,
		citationCount: 1_500,
		structuralContent: Object.freeze({
			sectionCount: 32,
			minimumParagraphCount: 10_000,
			minimumParagraphsPerSection: 200,
			tableCount: 60,
			figureCount: 60,
			equationCount: 500,
		}),
		academicCollections: Object.freeze({
			referenceSnapshotCount: 1_500,
			evidenceLinkCount: 900,
			claimCount: 600,
			claimEvidenceRelationCount: 2_400,
		}),
		maximumNodeDepth: 64,
		maximumDirectChildren: 20_000,
		maximumSubtreeNodeCount: 25_000,
		text: Object.freeze({
			utf8Bytes: 2_400_000,
			utf16Bytes: 3_200_000,
		}),
		metadata: Object.freeze({
			authorCount: 16,
			keywordCount: 64,
			affiliationCount: 48,
		}),
		transaction: Object.freeze({
			operationCount: 1_024,
			preconditionCount: 4_096,
		}),
		touchedParentWidths: Object.freeze({
			narrow: 32,
			representative: 4_096,
			maximum: 20_000,
		}),
		viewport: Object.freeze({
			widthCssPixels: 1_920,
			heightCssPixels: 1_080,
		}),
		projectionDensity: Object.freeze({
			visibleNodeCount: 240,
			overscanNodeCount: 120,
			projectedNodeCount: 360,
			projectedTextUtf16Bytes: 192_000,
			viewPartCount: 1_920,
		}),
	}),
});

export interface IWideParentLookupWitness {
	readonly id: 'comet-manuscript-wide-parent-1';
	readonly directChildCount: number;
	readonly editIndices: readonly [number, number, number];
	readonly shiftedLookupIndices: readonly [number, number, number];
	readonly expectedShiftedLookupChildPayloadReads: number;
}

const wideParentDirectChildCount =
	manuscriptPerformanceProfiles.L.maximumDirectChildren;

export const wideParentLookupWitness: IWideParentLookupWitness = Object.freeze({
	id: 'comet-manuscript-wide-parent-1',
	directChildCount: wideParentDirectChildCount,
	editIndices: Object.freeze([
		0,
		Math.floor(wideParentDirectChildCount / 2),
		wideParentDirectChildCount - 1,
	] as const),
	shiftedLookupIndices: Object.freeze([
		1,
		Math.floor(wideParentDirectChildCount / 2) + 1,
		wideParentDirectChildCount - 2,
	] as const),
	expectedShiftedLookupChildPayloadReads: 0,
});

export interface IDeepPathWitness {
	readonly id: 'comet-manuscript-deep-path-1';
	readonly maximumNodeDepth: number;
	readonly nodeCount: number;
	readonly sampledDepths: readonly [number, number, number];
}

const deepPathMaximumNodeDepth = 256;

export const deepPathWitness: IDeepPathWitness = Object.freeze({
	id: 'comet-manuscript-deep-path-1',
	maximumNodeDepth: deepPathMaximumNodeDepth,
	nodeCount: deepPathMaximumNodeDepth + 1,
	sampledDepths: Object.freeze([
		0,
		Math.floor(deepPathMaximumNodeDepth / 2),
		deepPathMaximumNodeDepth,
	] as const),
});

export interface IMaximumOperationWitness {
	readonly id: 'comet-manuscript-maximum-operation-1';
	readonly operationCount: number;
	readonly preconditionCount: number;
	readonly touchedParentWidths: readonly [number, number];
	readonly expectedPendingTransitionCount: number;
}

export const maximumOperationWitness: IMaximumOperationWitness = Object.freeze({
	id: 'comet-manuscript-maximum-operation-1',
	operationCount: manuscriptPerformanceProfiles.L.transaction.operationCount,
	preconditionCount:
		manuscriptPerformanceProfiles.L.transaction.preconditionCount,
	touchedParentWidths: Object.freeze([
		manuscriptPerformanceProfiles.L.touchedParentWidths.representative,
		manuscriptPerformanceProfiles.L.touchedParentWidths.maximum,
	] as const),
	expectedPendingTransitionCount:
		manuscriptPerformanceProfiles.L.transaction.operationCount,
});

export const manuscriptPerformanceWitnesses = Object.freeze({
	wideParentLookup: wideParentLookupWitness,
	deepPath: deepPathWitness,
	maximumOperation: maximumOperationWitness,
});
