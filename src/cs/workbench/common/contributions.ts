/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { DisposableLike } from 'cs/base/common/lifecycle';

export type Disposable = DisposableLike;
export type WorkbenchContribution = DisposableLike;
export type WorkbenchContributionFactory = () =>
	| WorkbenchContribution
	| void;

const workbenchContributionFactories: WorkbenchContributionFactory[] = [];
const activeWorkbenchContributions: WorkbenchContribution[] = [];
let workbenchContributionsStarted = false;

export function registerWorkbenchContribution(
	contributionFactory: WorkbenchContributionFactory,
): void {
	workbenchContributionFactories.push(contributionFactory);

	if (!workbenchContributionsStarted) {
		return;
	}

	const contribution = contributionFactory();
	if (contribution) {
		activeWorkbenchContributions.push(contribution);
	}
}

export function startWorkbenchContributions(): void {
	if (workbenchContributionsStarted) {
		return;
	}

	workbenchContributionsStarted = true;

	for (const contributionFactory of workbenchContributionFactories) {
		const contribution = contributionFactory();
		if (contribution) {
			activeWorkbenchContributions.push(contribution);
		}
	}
}

export function stopWorkbenchContributions(): void {
	while (activeWorkbenchContributions.length > 0) {
		activeWorkbenchContributions.pop()?.dispose();
	}

	workbenchContributionsStarted = false;
}
