/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import {
	disposeAll,
	type DisposableLike,
} from 'cs/base/common/lifecycle';

export type Disposable = DisposableLike;
export type WorkbenchContribution = DisposableLike;
export type WorkbenchContributionFactory = () =>
	| WorkbenchContribution
	| void;

const workbenchContributionFactories: WorkbenchContributionFactory[] = [];
const activeWorkbenchContributions: WorkbenchContribution[] = [];
type WorkbenchContributionsState = 'idle' | 'starting' | 'running' | 'stopping';
let workbenchContributionsState: WorkbenchContributionsState = 'idle';

export function registerWorkbenchContribution(
	contributionFactory: WorkbenchContributionFactory,
): void {
	workbenchContributionFactories.push(contributionFactory);

	if (workbenchContributionsState !== 'running') {
		return;
	}

	const contribution = contributionFactory();
	if (contribution) {
		activeWorkbenchContributions.push(contribution);
	}
}

export function startWorkbenchContributions(): void {
	if (workbenchContributionsState === 'starting') {
		throw new Error('Workbench contributions are already starting.');
	}
	if (workbenchContributionsState === 'stopping') {
		throw new Error('Workbench contributions cannot start while stopping.');
	}
	if (workbenchContributionsState === 'running') {
		return;
	}

	workbenchContributionsState = 'starting';

	try {
		for (let index = 0; index < workbenchContributionFactories.length; index += 1) {
			const contributionFactory = workbenchContributionFactories[index];
			const contribution = contributionFactory();
			if (contribution) {
				activeWorkbenchContributions.push(contribution);
			}
		}
		workbenchContributionsState = 'running';
	} catch (startError) {
		try {
			stopWorkbenchContributions();
		} catch (stopError) {
			throw new AggregateError(
				[startError, stopError],
				'Workbench contribution startup and cleanup both failed.',
			);
		}
		throw startError;
	}
}

export function stopWorkbenchContributions(): void {
	if (workbenchContributionsState === 'idle' || workbenchContributionsState === 'stopping') {
		return;
	}

	workbenchContributionsState = 'stopping';
	const contributions = activeWorkbenchContributions.splice(0);
	try {
		disposeAll(contributions);
	} finally {
		workbenchContributionsState = 'idle';
	}
}
