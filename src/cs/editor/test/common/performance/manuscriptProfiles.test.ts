/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { defaultDocumentIndexLimits } from 'cs/editor/common/model/documentIndex';
import {
	maximumTransactionOperations,
	maximumTransactionPreconditions,
} from 'cs/editor/common/model/transaction';
import {
	deepPathWitness,
	manuscriptPerformanceGeneratorVersion,
	manuscriptPerformanceProfileId,
	manuscriptPerformanceProfiles,
	manuscriptPerformanceTextDistribution,
	manuscriptPerformanceWitnesses,
	maximumOperationWitness,
	wideParentLookupWitness,
	type IManuscriptPerformanceProfile,
} from 'cs/editor/test/common/performance/manuscriptProfiles';

suite('Manuscript performance profiles', () => {
	test('keeps one deeply immutable S/M/L authority', () => {
		assert.match(
			manuscriptPerformanceProfileId,
			/^comet-manuscript-performance-\d+$/u,
		);
		assert.match(manuscriptPerformanceGeneratorVersion, /^\d+$/u);
		assertDeeplyFrozen(manuscriptPerformanceProfiles);
		assertDeeplyFrozen(manuscriptPerformanceTextDistribution);
		assertPositiveSafeIntegerLeaves(manuscriptPerformanceTextDistribution);
		assert.ok(
			manuscriptPerformanceTextDistribution.minimumMedianTextNodeWords
				< manuscriptPerformanceTextDistribution.minimumP95TextNodeWords,
		);
		assert.ok(
			manuscriptPerformanceTextDistribution.minimumP95TextNodeWords
				< manuscriptPerformanceTextDistribution.maximumP95TextNodeWords,
		);

		const profiles = Object.values(manuscriptPerformanceProfiles);
		assert.deepEqual(
			profiles.map(profile => profile.name),
			Object.keys(manuscriptPerformanceProfiles),
		);
		assert.equal(
			new Set(profiles.map(profile => profile.identity.fixtureId)).size,
			profiles.length,
		);
		assert.equal(
			new Set(profiles.map(profile => profile.identity.seed)).size,
			profiles.length,
		);

		for (const profile of profiles) {
			assert.equal(profile.identity.profileId, manuscriptPerformanceProfileId);
			assert.equal(
				profile.identity.generatorVersion,
				manuscriptPerformanceGeneratorVersion,
			);
			assert.match(
				profile.identity.fixtureId,
				new RegExp(`-${profile.name.toLowerCase()}$`, 'u'),
			);
			assertValidProfileShape(profile);
		}

		for (let index = 1; index < profiles.length; index += 1) {
			const previous = profiles[index - 1];
			const current = profiles[index];
			assert.ok(previous !== undefined);
			assert.ok(current !== undefined);
			assertStrictlyIncreasingNumericShape(previous, current);
		}
	});

	test('owns legal wide-parent, deep-path, and maximum-operation witnesses', () => {
		assertDeeplyFrozen(manuscriptPerformanceWitnesses);
		assert.equal(
			new Set(
				Object.values(manuscriptPerformanceWitnesses).map(
					witness => witness.id,
				),
			).size,
			Object.keys(manuscriptPerformanceWitnesses).length,
		);

		assert.equal(
			wideParentLookupWitness.directChildCount,
			manuscriptPerformanceProfiles.L.maximumDirectChildren,
		);
		assert.equal(
			Math.min(...wideParentLookupWitness.editIndices),
			wideParentLookupWitness.editIndices[0],
		);
		assert.equal(
			Math.max(...wideParentLookupWitness.editIndices),
			wideParentLookupWitness.directChildCount - 1,
		);
		assert.equal(
			wideParentLookupWitness.editIndices[1],
			Math.floor(wideParentLookupWitness.directChildCount / 2),
		);
		for (const lookupIndex of wideParentLookupWitness.shiftedLookupIndices) {
			assert.ok(lookupIndex >= Math.min(...wideParentLookupWitness.editIndices));
			assert.ok(lookupIndex < wideParentLookupWitness.directChildCount);
		}

		assert.equal(
			deepPathWitness.maximumNodeDepth,
			defaultDocumentIndexLimits.maximumDepth,
		);
		assert.equal(
			deepPathWitness.nodeCount,
			deepPathWitness.maximumNodeDepth + 1,
		);
		assert.equal(
			Math.min(...deepPathWitness.sampledDepths),
			deepPathWitness.sampledDepths[0],
		);
		assert.equal(
			Math.max(...deepPathWitness.sampledDepths),
			deepPathWitness.maximumNodeDepth,
		);

		assert.equal(
			maximumOperationWitness.operationCount,
			maximumTransactionOperations,
		);
		assert.equal(
			maximumOperationWitness.preconditionCount,
			maximumTransactionPreconditions,
		);
		assert.equal(
			maximumOperationWitness.expectedPendingTransitionCount,
			maximumOperationWitness.operationCount,
		);
		assert.deepEqual(
			maximumOperationWitness.touchedParentWidths,
			[
				manuscriptPerformanceProfiles.L.touchedParentWidths.representative,
				manuscriptPerformanceProfiles.L.touchedParentWidths.maximum,
			],
		);
	});
});

function assertValidProfileShape(profile: IManuscriptPerformanceProfile): void {
	assertPositiveSafeIntegerLeaves(profile);

	assert.equal(
		profile.entityCount,
		profile.academicCollections.referenceSnapshotCount
			+ profile.academicCollections.evidenceLinkCount
			+ profile.academicCollections.claimCount,
	);
	assert.equal(
		profile.relationCount,
		profile.academicCollections.claimEvidenceRelationCount,
	);
	assert.equal(
		profile.citationCount,
		profile.academicCollections.referenceSnapshotCount,
	);
	assert.ok(
		profile.academicCollections.claimEvidenceRelationCount
			<= profile.academicCollections.claimCount
				* profile.academicCollections.evidenceLinkCount,
	);

	assert.ok(profile.maximumNodeDepth < profile.maximumSubtreeNodeCount);
	assert.ok(profile.maximumDirectChildren < profile.maximumSubtreeNodeCount);
	assert.ok(profile.maximumSubtreeNodeCount <= profile.nodeCount);
	assert.ok(profile.nodeCount <= defaultDocumentIndexLimits.maximumNodes);
	assert.ok(profile.maximumNodeDepth <= defaultDocumentIndexLimits.maximumDepth);
	assert.ok(
		profile.structuralContent.minimumParagraphCount
			>= profile.structuralContent.sectionCount
				* profile.structuralContent.minimumParagraphsPerSection,
	);
	assert.ok(
		profile.citationCount
			+ profile.structuralContent.tableCount
			+ profile.structuralContent.figureCount
			+ profile.structuralContent.equationCount
			< profile.nodeCount,
	);

	assert.equal(profile.text.utf16Bytes % Uint16Array.BYTES_PER_ELEMENT, 0);
	assert.ok(profile.metadata.affiliationCount >= profile.metadata.authorCount);
	assert.ok(profile.transaction.operationCount <= maximumTransactionOperations);
	assert.ok(
		profile.transaction.preconditionCount <= maximumTransactionPreconditions,
	);
	assert.ok(
		profile.transaction.preconditionCount >= profile.transaction.operationCount,
	);

	assert.ok(
		profile.touchedParentWidths.narrow
			< profile.touchedParentWidths.representative,
	);
	assert.ok(
		profile.touchedParentWidths.representative
			< profile.touchedParentWidths.maximum,
	);
	assert.equal(
		profile.touchedParentWidths.maximum,
		profile.maximumDirectChildren,
	);

	assert.equal(
		profile.projectionDensity.projectedNodeCount,
		profile.projectionDensity.visibleNodeCount
			+ profile.projectionDensity.overscanNodeCount,
	);
	assert.ok(profile.projectionDensity.projectedNodeCount < profile.nodeCount);
	assert.ok(
		profile.projectionDensity.viewPartCount
			>= profile.projectionDensity.projectedNodeCount,
	);
	assert.ok(
		profile.projectionDensity.projectedTextUtf16Bytes
			< profile.text.utf16Bytes,
	);
}

function assertPositiveSafeIntegerLeaves(value: object, path = 'profile'): void {
	for (const [key, field] of Object.entries(value)) {
		const fieldPath = `${path}.${key}`;
		if (typeof field === 'number') {
			assert.equal(Number.isSafeInteger(field), true, fieldPath);
			assert.ok(field > 0, fieldPath);
		} else if (field !== null && typeof field === 'object') {
			assertPositiveSafeIntegerLeaves(field, fieldPath);
		}
	}
}

function assertStrictlyIncreasingNumericShape(
	previous: object,
	current: object,
	path = 'profile',
): void {
	for (const [key, previousField] of Object.entries(previous)) {
		const currentField = Object.getOwnPropertyDescriptor(current, key)?.value;
		const fieldPath = `${path}.${key}`;
		if (typeof previousField === 'number') {
			assert.equal(typeof currentField, 'number', fieldPath);
			assert.ok(currentField > previousField, fieldPath);
		} else if (previousField !== null && typeof previousField === 'object') {
			assert.ok(currentField !== null && typeof currentField === 'object', fieldPath);
			assertStrictlyIncreasingNumericShape(previousField, currentField, fieldPath);
		}
	}
}

function assertDeeplyFrozen(value: object): void {
	assert.equal(Object.isFrozen(value), true);
	for (const field of Object.values(value)) {
		if (field !== null && typeof field === 'object') {
			assertDeeplyFrozen(field);
		}
	}
}
